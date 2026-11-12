const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createIdentityStore } = require("../server/identity");
const {
  startServer,
  nextEvent,
  nextRoom,
  createRoom,
  joinRoom,
} = require("./helpers/server");

test("an identity keeps a hashed PIN and revocable browser session across restarts", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-identity-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "identities.sqlite");
  let store = createIdentityStore(file);
  assert.equal(store.identify("BadId", "1234").status, 400);
  assert.equal(store.identify("abc1", "12ab").status, 400);
  const registered = store.identify("captain7", "1234");
  assert.equal(registered.id, "captain7");
  assert.equal(store.session(`arena_session=${registered.token}`), "captain7");
  assert.equal(store.identify("captain7", "0000").status, 401);
  store.close();
  const raw = fs.readFileSync(file);
  assert.equal(raw.includes(Buffer.from("1234")), false);
  assert.equal(raw.includes(Buffer.from(registered.token)), false);
  store = createIdentityStore(file);
  assert.equal(
    store.session(`other=1; arena_session=${registered.token}; x=2`),
    "captain7",
  );
  store.logout(`arena_session=${registered.token}`);
  assert.equal(store.session(`arena_session=${registered.token}`), null);
  const loggedInAgain = store.identify("captain7", "1234");
  assert.equal(loggedInAgain.id, "captain7");
  store.close();
});

test("five incorrect PIN attempts temporarily lock the identity", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-pin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createIdentityStore(path.join(directory, "identities.sqlite"));
  store.identify("player99", "4567");
  for (let i = 0; i < 5; i++)
    assert.equal(store.identify("player99", "1111").status, 401);
  assert.equal(store.identify("player99", "4567").status, 429);
  store.close();
});

test("restricted rooms require a verified identity for new and saved seats", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-access-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = await startServer(t, {
    SEASONS_DB_PATH: path.join(directory, "seasons.sqlite"),
  });
  const identify = async (id) => {
    const response = await fetch(server.url + "/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pin: "1234" }),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  async function rejected(socket, event, payload) {
    const error = nextEvent(socket, "app:error");
    socket.emit(event, payload);
    return error;
  }
  try {
    const guest = await server.connect();
    await createRoom(guest);
    assert.match(
      (await rejected(guest, "host:settings", { identifiedOnly: true }))
        .message,
      /Identify yourself as the host/,
    );

    const hostCookie = await identify("roomhost");
    const host = await server.connect(hostCookie);
    const owner = await createRoom(host);
    const code = owner.roomCode;
    const guestSeat = await joinRoom(guest, code);
    assert.match(
      (await rejected(host, "host:settings", { identifiedOnly: true })).message,
      /Remove guest seats/,
    );
    const removed = nextRoom(host, (room) => room.users.length === 1);
    host.emit("host:kickUser", { userId: guestSeat.userId });
    await removed;
    const restricted = nextRoom(host, (room) => room.settings.identifiedOnly);
    host.emit("host:settings", { identifiedOnly: true });
    await restricted;

    const join = { code, name: "Guest", teamId: "RCB" };
    const recovery = { code, recoveryToken: owner.hostRecoveryToken };
    assert.equal(
      (await rejected(guest, "room:join", join)).code,
      "ROOM_IDENTITY_REQUIRED",
    );
    assert.equal(
      (await rejected(guest, "room:recoverHost", recovery)).code,
      "ROOM_IDENTITY_REQUIRED",
    );

    const friendCookie = await identify("roomfriend");
    const friend = await server.connect(friendCookie);
    const seat = await joinRoom(friend, code);
    const rejoin = {
      code,
      userId: seat.userId,
      reconnectToken: seat.reconnectToken,
    };
    assert.equal(
      (await rejected(guest, "room:rejoin", rejoin)).code,
      "ROOM_IDENTITY_REQUIRED",
    );
    const wrongIdentity = await server.connect(hostCookie);
    assert.equal(
      (await rejected(wrongIdentity, "room:rejoin", rejoin)).code,
      "ROOM_IDENTITY_REQUIRED",
    );
    const returning = await server.connect(friendCookie);
    const rejoined = nextEvent(returning, "room:joined");
    returning.emit("room:rejoin", rejoin);
    assert.equal((await rejoined).userId, seat.userId);

    const ready = nextRoom(host, (room) =>
      room.users.every((user) => user.ready),
    );
    returning.emit("lobby:ready", true);
    host.emit("lobby:ready", true);
    await ready;
    const started = nextRoom(host, (room) => room.phase === "auction");
    host.emit("host:startAuction");
    await started;
    assert.equal(
      (await rejected(guest, "room:join", join)).code,
      "ROOM_IDENTITY_REQUIRED",
    );

    await fetch(server.url + "/api/identity", {
      method: "DELETE",
      headers: { Cookie: friendCookie },
    });
    const identityError = nextEvent(returning, "app:error");
    const response = await returning.timeout(2000).emitWithAck("auction:bid", {
      lotId: host.testRoom.currentLot.id,
      actionId: "signed-out-bid",
      expectedBid: host.testRoom.currentLot.basePrice,
    });
    const error = await identityError;
    assert.equal(error.code, "ROOM_IDENTITY_REQUIRED");
    assert.deepEqual(response, { ok: false, message: error.message });
  } finally {
    server.child.kill();
    await new Promise((resolve) => server.child.once("exit", resolve));
  }
});
