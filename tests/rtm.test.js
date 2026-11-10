const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const game = require("../server/game");
const database = require("../data/players.json");
const { createCheckpointStore } = require("../server/checkpoints");
const { startServer, nextEvent, nextRoom, wait } = require("./helpers/server");

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
