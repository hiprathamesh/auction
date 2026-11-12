const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const game = require("../server/game");
const database = require("../data/players.json");
const { createCheckpointStore } = require("../server/checkpoints");
const { createSeasonStore } = require("../server/seasons");
const {
  startServer,
  nextEvent,
  nextRoom,
  joinRoom,
  wait,
} = require("./helpers/server");

test("private RTM activation is visible only to its holder", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-rtm-test-"));
  t.after(() => {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const token = "A".repeat(43);
  const token2 = "B".repeat(43);
  const hash = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const user = (index, credential) => {
    const franchise = game.FRANCHISES[index];
    return {
      id: `user-${index}`,
      name: `User ${index}`,
      teamId: franchise.id,
      teamName: franchise.name,
      teamShort: franchise.short,
      teamColor: franchise.color,
      credentialHash: hash(credential),
    };
  };
  const room = game.createRoom("ABCDE", user(0, token), database);
  game.addUser(room, user(1, token2));
  room.settings.rtmEnabled = true;
  room.settings.rtmPublicStatus = false;
  room.phase = "auction";
  room.auctionPaused = true;
  room.auctionRemainingMs = 10000;
  const player = database.players.find(
    (candidate) => candidate.rtmTeamId === "CSK" && !candidate.legend,
  );
  room.currentLot = {
    id: "rtm-lot",
    player,
    set: player.set,
    basePrice: player.basePrice,
    currentBid: player.basePrice,
    currentBidderId: null,
    outUserIds: [],
    lotNumber: 1,
    totalLots: 1,
    rtmHolderUserId: "user-0",
    rtmOptInUserId: null,
  };
  createCheckpointStore({ enabled: true, directory }).save(room);
  const server = await startServer(t, {
    ROOM_CHECKPOINTS: "1",
    ROOM_DATA_DIR: directory,
  });
  const host = await server.connect();
  let joined = nextEvent(host, "room:joined");
  host.emit("room:rejoin", {
    code: room.code,
    userId: "user-0",
    reconnectToken: token,
  });
  await joined;
  const peer = await server.connect();
  joined = nextEvent(peer, "room:joined");
  const initial = nextEvent(peer, "room:update");
  peer.emit("room:rejoin", {
    code: room.code,
    userId: "user-1",
    reconnectToken: token2,
  });
  await joined;
  await initial;
  await wait(50);
  const version = peer.testRoom.version;
  const personal = nextEvent(
    host,
    "room:privateState",
    (state) => state.rtmIsOn,
  );
  const shared = nextRoom(
    peer,
    (state) => state.version > version && Boolean(state.currentLot),
  );
  host.emit("auction:rtmToggle", { lotId: "rtm-lot", enabled: true });
  assert.equal((await personal).isRtmHolder, true);
  assert.equal((await shared).currentLot.rtmIsOn, false);
});

test("new RTM-only auctions give no right when the latest squad does not supply a current manager", (t) => {
  const player = database.players.find(
    (candidate) => candidate.rtmTeamId === "CSK",
  );
  const players = { setOrder: [player.set], players: [player] };
  const io = { to: () => ({ emit: () => {} }) };
  const manager = (id, teamId) => ({
    id,
    identityId: id,
    name: id,
    teamId,
  });
  for (const source of [
    null,
    { id: 2, players: {} },
    {
      id: 2,
      players: { [player.id]: { identityId: "absent", retained: false } },
    },
  ]) {
    const room = game.createRoom("ABCDE", manager("manager1", "CSK"), players);
    t.after(() => game.cleanupTimers(room));
    game.addUser(room, manager("manager2", "MI"));
    room.settings.rtmEnabled = true;
    room.settings.includeLegends = true;
    for (const user of room.users) user.ready = true;
    assert.equal(game.startAuction(io, room, players, () => source).ok, true);
    assert.equal(room.currentLot.rtmHolderUserId, null);
  }
});

test("retention and RTM use the latest recorded squads across franchise changes", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "auction-season-rights-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "seasons.sqlite");
  const pool = database.players.filter(
    (player) => player.set === "SP2" && !player.legend,
  );
  const [repeat, ...available] = pool;
  assert.equal(available.length, 3);
  const expired = database.players.find(
    (player) => player.set !== "SP2" && !player.legend,
  );
  const hostTeam =
    game.FRANCHISES.find((team) => team.id === repeat.rtmTeamId) ||
    game.FRANCHISES[0];
  const friendTeam = game.FRANCHISES.find((team) => team.id !== hostTeam.id);
  const store = createSeasonStore(file);
  const team = (identityId, franchise, squad) => ({
    id: identityId,
    name: identityId,
    identityId,
    teamName: franchise.name,
    teamId: franchise.id,
    squad,
  });
  const save = (key, completedAt, teams) =>
    store.save(key, { completedAt, teams, matches: [], champion: teams[0] });
  save("older", 1, [team("seasonhost", hostTeam, [repeat, expired])]);
  const previousTeams = [
    team("returning", hostTeam, [{ ...repeat, retained: true }, ...available]),
  ];
  const latest = save("previous", 2, previousTeams);
  const roster = store.latestRoster();
  assert.equal(roster.id, latest.id);
  assert.equal(roster.players[expired.id], undefined);
  assert.deepEqual(roster.players[repeat.id], {
    identityId: "returning",
    retained: true,
  });
  assert.equal(store.playerSeasons(repeat.id)[0].retained, true);
  assert.equal(store.playerSeasons(repeat.id)[0].price, null);
  store.close();

  const token = "C".repeat(43);
  const room = game.createRoom(
    "ABCDE",
    {
      ...team("seasonhost", hostTeam, []),
      teamShort: hostTeam.short,
      teamColor: hostTeam.color,
      credentialHash: crypto.createHash("sha256").update(token).digest("hex"),
    },
    database,
  );
  room.setOrder = ["SP2"];
  createCheckpointStore({ enabled: true, directory }).save(room);
  const server = await startServer(t, {
    ROOM_CHECKPOINTS: "1",
    ROOM_DATA_DIR: directory,
    SEASONS_DB_PATH: file,
  });
  const signIn = async (id) => {
    const response = await fetch(server.url + "/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pin: "1234" }),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  try {
    const host = await server.connect(await signIn("seasonhost"));
    const joined = nextEvent(host, "room:joined");
    host.emit("room:rejoin", {
      code: room.code,
      userId: room.hostId,
      reconnectToken: token,
    });
    await joined;
    const friend = await server.connect(await signIn("returning"));
    const friendSeat = await joinRoom(
      friend,
      room.code,
      "Friend",
      friendTeam.id,
    );
    const hostView = nextEvent(
      host,
      "room:privateState",
      (state) => state.retention,
    );
    const friendView = nextEvent(
      friend,
      "room:privateState",
      (state) => state.retention,
    );
    host.emit("host:settings", { rtmEnabled: true, retentionEnabled: true });
    assert.deepEqual((await hostView).retention.candidates, []);
    assert.deepEqual(
      (await friendView).retention.candidates.map((player) => player.id).sort(),
      available.map((player) => player.id).sort(),
    );
    assert.equal(host.testRoom.previousSeasonId, latest.id);
    assert.equal(Object.hasOwn(host.testRoom, "previousSeason"), false);
    assert.equal(
      host.testRoom.users.some((user) =>
        Object.hasOwn(user, "retentionPlayerIds"),
      ),
      false,
    );

    const rejectedRepeat = nextEvent(friend, "app:error");
    friend.emit("lobby:retain", { playerId: repeat.id, selected: true });
    assert.match((await rejectedRepeat).message, /cannot retain/);
    const firstPick = nextEvent(friend, "room:privateState", (state) =>
      state.retention?.selected.includes(available[0].id),
    );
    friend.emit("lobby:retain", { playerId: available[0].id, selected: true });
    await firstPick;
    const overLimit = nextEvent(friend, "app:error");
    friend.emit("lobby:retain", { playerId: available[1].id, selected: true });
    assert.match((await overLimit).message, /up to 1 player/);

    const limit = nextRoom(
      host,
      (state) => state.settings.retentionLimit === 3,
    );
    host.emit("host:settings", { retentionLimit: 3 });
    await limit;
    const picks = nextEvent(
      friend,
      "room:privateState",
      (state) => state.retention?.selected.length === 3,
    );
    for (const player of available.slice(1))
      friend.emit("lobby:retain", { playerId: player.id, selected: true });
    await picks;
    const ready = nextRoom(host, (state) =>
      state.users.every((user) => user.ready),
    );
    host.emit("lobby:ready", true);
    friend.emit("lobby:ready", true);
    await ready;
    const newer = save("newer", 3, previousTeams);
    store.close();
    const updated = nextRoom(
      host,
      (state) => state.previousSeasonId === newer.id,
    );
    host.emit("host:startAuction");
    const updatedLobby = await updated;
    assert.equal(updatedLobby.phase, "lobby");
    assert.ok(updatedLobby.users.every((user) => !user.ready));
    const reviewed = nextRoom(host, (state) =>
      state.users.every((user) => user.ready),
    );
    host.emit("lobby:ready", true);
    friend.emit("lobby:ready", true);
    await reviewed;
    const started = nextRoom(
      host,
      (state) => state.phase === "auction" && state.currentLot,
    );
    host.emit("host:startAuction");
    const auction = await started;
    const lot = auction.currentLot;
    assert.equal(lot.player.id, repeat.id);
    assert.equal(lot.rtmHolderUserId, friendSeat.userId);
    assert.equal(auction.totalLots, 1);
    const squad = auction.users.find((user) => user.id === friendSeat.userId);
    assert.equal(squad.purse, auction.settings.startingPurse);
    assert.equal(squad.squadCount, 3);
    assert.ok(
      squad.squad.every(
        (player) => player.retained && player.purchasePrice === 0,
      ),
    );

    const wrongHolder = nextEvent(host, "app:error");
    host.emit("auction:rtmToggle", { lotId: lot.id, enabled: true });
    assert.match((await wrongHolder).message, /do not hold/);
    const armed = nextRoom(host, (state) => state.currentLot?.rtmIsOn);
    friend.emit("auction:rtmToggle", { lotId: lot.id, enabled: true });
    await armed;
    const bid = await host.timeout(2000).emitWithAck("auction:bid", {
      lotId: lot.id,
      expectedBid: lot.basePrice,
      actionId: "rtm-match-bid",
    });
    assert.equal(bid.ok, true);
    const settled = nextRoom(host, (state) => state.phase === "auctionResults");
    host.emit("host:endAuction");
    const result = await settled;
    assert.equal(result.sold[0].userId, friendSeat.userId);
    assert.equal(result.lotHistory[0].result, "RTM");
    const buyer = result.users.find((user) => user.id === friendSeat.userId);
    assert.equal(buyer.purse, result.settings.startingPurse - lot.basePrice);
    assert.equal(buyer.rtmUsesUsed, 1);
    assert.equal(
      buyer.squad.find((player) => player.id === repeat.id).retained,
      undefined,
    );

    const removed = nextRoom(host, (state) => state.users.length === 1);
    host.emit("host:kickUser", { userId: friendSeat.userId });
    const afterRemoval = await removed;
    assert.equal(afterRemoval.lotsRemaining, 3);
    assert.equal(afterRemoval.unsold[0].playerId, repeat.id);
    const reopened = nextRoom(host, (state) => state.currentLot);
    host.emit("host:continueAuction");
    const reopenedLot = (await reopened).currentLot;
    assert.ok(available.some((player) => player.id === reopenedLot.player.id));
    assert.equal(reopenedLot.player.retained, undefined);
    assert.equal(reopenedLot.rtmHolderUserId, null);
  } finally {
    server.child.kill();
    await new Promise((resolve) => server.child.once("exit", resolve));
  }
});
