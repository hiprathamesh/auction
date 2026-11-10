const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const {
  wait,
  nextEvent,
  nextRoom,
  startServer,
  createRoom,
  joinRoom,
} = require("./helpers/server");

test("a public user ID is insufficient to reclaim the host seat", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const attacker = await server.connect();
  const rejected = nextEvent(attacker, "app:error");
  attacker.emit("room:rejoin", { code: seat.roomCode, userId: seat.userId });
  assert.match((await rejected).message, /session|credential|invalid/i);
  assert.ok(seat.reconnectToken, "a private reconnect token must be issued");
});

test("optional origin restrictions reject untrusted browser origins", async (t) => {
  const server = await startServer(t, {
    ALLOWED_ORIGINS: "https://game.example.com",
  });
  const url = `${server.url}/socket.io/?EIO=4&transport=polling`;
  const blocked = await fetch(url, {
    headers: { Origin: "https://other.example.com" },
  });
  assert.equal(blocked.status, 403);
  const allowed = await fetch(url, {
    headers: { Origin: "https://game.example.com" },
  });
  assert.equal(allowed.status, 200);
});

test("room updates do not disclose private session or recovery credentials", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const peer = await server.connect();
  await joinRoom(peer, seat.roomCode);
  await wait(100);
  const snapshot = JSON.stringify(peer.testRoom);
  assert.ok(!snapshot.includes(seat.reconnectToken));
  assert.ok(!snapshot.includes(seat.hostRecoveryToken));
  assert.ok(!snapshot.includes("credentialHash"));
  assert.ok(!snapshot.includes("hostRecoveryHash"));
});

test("null socket payloads do not crash the server", async (t) => {
  const server = await startServer(t);
  const client = await server.connect();
  client.emit("room:create", null);
  client.emit("host:kickUser", { userId: { toString: null } });
  client.emit("auction:bid", {
    lotId: "x",
    actionId: "test-action",
    expectedBid: 1,
    multiplier: { valueOf: null },
  });
  await wait(250);
  assert.equal(server.child.exitCode, null, server.stderr());
  assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
});

test("idle auction countdown does not repeatedly send room snapshots", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const peer = await server.connect();
  await joinRoom(peer, seat.roomCode);
  let update = nextRoom(host, (room) => room.users.every((user) => user.ready));
  host.emit("lobby:ready", true);
  peer.emit("lobby:ready", true);
  await update;
  update = nextRoom(host, (room) => Boolean(room.currentLot));
  host.emit("host:startAuction");
  const lot = (await update).currentLot;
  let snapshots = 0;
  let patches = 0;
  host.on("room:update", () => {
    snapshots += 1;
  });
  host.on("room:patch", () => {
    patches += 1;
  });
  await wait(1100);
  assert.equal(snapshots, 0);
  assert.equal(patches, 0);
  assert.ok(lot.timerRemainingMs > 0);
});

test("duplicate bid action IDs are idempotent and changed prices are rejected", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const peer = await server.connect();
  await joinRoom(peer, seat.roomCode);
  let update = nextRoom(host, (room) => room.users.every((user) => user.ready));
  host.emit("lobby:ready", true);
  peer.emit("lobby:ready", true);
  await update;
  update = nextRoom(host, (room) => Boolean(room.currentLot));
  host.emit("host:startAuction");
  const lot = (await update).currentLot;
  const bid = {
    lotId: lot.id,
    multiplier: 1,
    expectedBid: lot.basePrice,
    actionId: "duplicate-bid-test",
  };
  const submit = () =>
    new Promise((resolve) => host.emit("auction:bid", bid, resolve));
  assert.equal((await submit()).ok, true);
  assert.equal((await submit()).ok, true);
  const rejected = nextEvent(peer, "app:error");
  peer.emit("auction:bid", { ...bid, actionId: "stale-price-test" });
  assert.match((await rejected).message, /price changed/i);
});

test("a temporarily disconnected eligible bidder retains the remaining bid window", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const peer = await server.connect();
  const friend = await joinRoom(peer, seat.roomCode);
  let update = nextRoom(host, (room) => room.users.every((user) => user.ready));
  host.emit("lobby:ready", true);
  peer.emit("lobby:ready", true);
  await update;
  update = nextRoom(host, (room) => Boolean(room.currentLot));
  host.emit("host:startAuction");
  const lot = (await update).currentLot;
  const offline = nextRoom(
    host,
    (room) => !room.users.find((user) => user.id === friend.userId).connected,
  );
  peer.disconnect();
  await offline;
  update = nextRoom(
    host,
    (room) => room.currentLot?.currentBidderId === seat.userId,
  );
  host.emit("auction:bid", {
    lotId: lot.id,
    multiplier: 1,
    expectedBid: lot.basePrice,
    actionId: "offline-friend-bid",
  });
  const current = await update;
  assert.equal(current.currentLot.id, lot.id);
  const reconnect = await server.connect();
  const joined = nextEvent(reconnect, "room:joined");
  const snapshot = nextEvent(reconnect, "room:update");
  reconnect.emit("room:rejoin", {
    code: seat.roomCode,
    userId: friend.userId,
    reconnectToken: friend.reconnectToken,
  });
  await joined;
  assert.equal((await snapshot).currentLot.id, lot.id);
});

test("one socket leaving a room no longer receives its updates", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const original = await createRoom(host);
  const peer = await server.connect();
  await joinRoom(peer, original.roomCode);
  const second = await createRoom(host, "Other Host", "RCB");
  assert.notEqual(second.roomCode, original.roomCode);
  const received = [];
  host.testRoomEvents.on("state", (room) => received.push(room.code));
  peer.emit("lobby:ready", true);
  await wait(200);
  assert.ok(!received.includes(original.roomCode));
});

test("a valid reconnect credential replaces the older connection without marking the seat offline", async (t) => {
  const server = await startServer(t);
  const first = await server.connect();
  const seat = await createRoom(first);
  const peer = await server.connect();
  await joinRoom(peer, seat.roomCode);
  const second = await server.connect();
  const joined = nextEvent(second, "room:joined");
  second.emit("room:rejoin", {
    code: seat.roomCode,
    userId: seat.userId,
    reconnectToken: seat.reconnectToken,
  });
  assert.equal((await joined).userId, seat.userId);
  await wait(150);
  const snapshot = nextEvent(second, "room:update");
  second.emit("room:sync");
  const room = await snapshot;
  assert.equal(
    room.users.find((user) => user.id === seat.userId).connected,
    true,
  );
  assert.equal(first.connected, false);
});

test("host recovery uses a private one-time recovery code and rotates seat credentials", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  assert.ok(seat.hostRecoveryToken);
  const attacker = await server.connect();
  const rejected = nextEvent(attacker, "app:error");
  attacker.emit("room:recoverHost", {
    code: seat.roomCode,
    recoveryToken: "not-the-secret",
  });
  assert.match((await rejected).message, /recovery/i);
  const replacement = await server.connect();
  const joined = nextEvent(replacement, "room:joined");
  replacement.emit("room:recoverHost", {
    code: seat.roomCode,
    recoveryToken: seat.hostRecoveryToken,
  });
  const recovered = await joined;
  assert.equal(recovered.userId, seat.userId);
  assert.notEqual(recovered.reconnectToken, seat.reconnectToken);
  assert.notEqual(recovered.hostRecoveryToken, seat.hostRecoveryToken);
  const oldTokenRejected = nextEvent(attacker, "app:error");
  attacker.emit("room:rejoin", {
    code: seat.roomCode,
    userId: seat.userId,
    reconnectToken: seat.reconnectToken,
  });
  assert.match((await oldTokenRejected).message, /session|credential/i);
});

test("host transfer grants control only to the selected connected player", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const peer = await server.connect();
  const friend = await joinRoom(peer, seat.roomCode);
  const token = nextEvent(peer, "host:recoveryToken");
  const changed = nextRoom(peer, (room) => room.hostId === friend.userId);
  host.emit("host:transfer", { userId: friend.userId });
  assert.ok((await token).hostRecoveryToken);
  await changed;
  const forbidden = nextEvent(host, "app:error");
  host.emit("host:settings", { startingPurse: 200 });
  assert.match((await forbidden).message, /host/i);
  const settings = nextRoom(
    peer,
    (room) => room.settings.startingPurse === 200,
  );
  peer.emit("host:settings", { startingPurse: 200 });
  await settings;
});

test("pause and resume between lots does not discard a player; stale bids are rejected", async (t) => {
  const server = await startServer(t);
  const host = await server.connect();
  const seat = await createRoom(host);
  const peer = await server.connect();
  await joinRoom(peer, seat.roomCode);
  let update = nextRoom(host, (room) => room.users.every((user) => user.ready));
  host.emit("lobby:ready", true);
  peer.emit("lobby:ready", true);
  await update;
  update = nextRoom(host, (room) => Boolean(room.currentLot));
  host.emit("host:startAuction");
  const first = (await update).currentLot;
  update = nextRoom(host, (room) => room.currentLot?.outUserIds.length === 1);
  peer.emit("auction:out", { lotId: first.id });
  await update;
  update = nextRoom(host, (room) => !room.currentLot && room.sold.length === 1);
  host.emit("auction:bid", {
    lotId: first.id,
    multiplier: 1,
    expectedBid: first.basePrice,
    actionId: "test-first-bid",
  });
  await update;
  update = nextRoom(host, (room) => room.auctionPaused);
  host.emit("host:pauseAuction");
  await update;
  update = nextRoom(host, (room) => Boolean(room.currentLot));
  host.emit("host:resumeAuction");
  const next = (await update).currentLot;
  await wait(1500);
  update = nextEvent(host, "room:update");
  host.emit("room:sync");
  const after = await update;
  assert.equal(after.currentLot.id, next.id);
  assert.ok(next.id && next.id !== first.id);
  const rejected = nextEvent(peer, "app:error");
  peer.emit("auction:bid", {
    lotId: first.id,
    multiplier: 1,
    expectedBid: first.basePrice,
    actionId: "test-stale-bid",
  });
  assert.match((await rejected).message, /lot|player|changed/i);
});

test("an optional checkpoint restores an auction paused with its private seat credentials", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "auction-checkpoint-test-"),
  );
  t.after(() => {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const env = { ROOM_CHECKPOINTS: "1", ROOM_DATA_DIR: directory };
  const firstServer = await startServer(t, env);
  const host = await firstServer.connect();
  const seat = await createRoom(host);
  const peer = await firstServer.connect();
  await joinRoom(peer, seat.roomCode);
  let update = nextRoom(host, (room) => room.users.every((user) => user.ready));
  host.emit("lobby:ready", true);
  peer.emit("lobby:ready", true);
  await update;
  update = nextRoom(host, (room) => Boolean(room.currentLot));
  host.emit("host:startAuction");
  const before = await update;
  const exited = once(firstServer.child, "exit");
  firstServer.child.kill();
  await exited;
  const restarted = await startServer(t, env);
  const recoveredHost = await restarted.connect();
  const joined = nextEvent(recoveredHost, "room:joined");
  const restored = nextEvent(recoveredHost, "room:update");
  recoveredHost.emit("room:rejoin", {
    code: seat.roomCode,
    userId: seat.userId,
    reconnectToken: seat.reconnectToken,
  });
  await joined;
  const room = await restored;
  assert.equal(room.phase, "auction");
  assert.equal(room.auctionPaused, true);
  assert.equal(room.currentLot.id, before.currentLot.id);
  assert.ok(!JSON.stringify(room).includes(seat.reconnectToken));
});
