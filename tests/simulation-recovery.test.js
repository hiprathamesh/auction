const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const game = require("../server/game");
const { makeDoubleRoundRobin } = require("../server/cricket");
const { createCheckpointStore } = require("../server/checkpoints");
const database = require("../data/players.json");
const { startServer, nextEvent, nextRoom } = require("./helpers/server");

test(
  "a live match resumes from a checkpoint without counting results twice",
  { timeout: 10000 },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "auction-live-test-"),
    );
    t.after(() => {
      assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const token = "A".repeat(43);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const franchise = game.FRANCHISES[0];
    const room = game.createRoom(
      "ABCDE",
      {
        id: "host",
        name: "Host",
        teamId: franchise.id,
        teamName: franchise.name,
        teamShort: franchise.short,
        teamColor: franchise.color,
        credentialHash: hash,
      },
      database,
    );
    const other = game.FRANCHISES[1];
    game.addUser(room, {
      id: "friend",
      name: "Friend",
      teamId: other.id,
      teamName: other.name,
      teamShort: other.short,
      teamColor: other.color,
      credentialHash: hash,
    });
    let pool = [...database.players].sort((a, b) => b.ovr - a.ovr);
    for (const user of room.users) {
      user.squad = game.findBestLegalXI(pool);
      pool = pool.filter(
        (player) => !user.squad.some((selected) => selected.id === player.id),
      );
      user.lineup = user.squad.map((player) => player.id);
      user.bowlerIds = [...user.squad]
        .sort((a, b) => b.bowling - a.bowling)
        .slice(0, 5)
        .map((player) => player.id);
    }
    room.phase = "league";
    room.fixtures = makeDoubleRoundRobin(room.users);
    game.startLiveMatch(
      { to: () => ({ emit: () => {} }) },
      room,
      room.fixtures[0],
    );
    const firstId = room.currentMatch.id;
    const firstTossWinner = room.currentMatch.toss.winnerId;
    assert.equal(
      game.chooseMatchToss(
        { to: () => ({ emit: () => {} }) },
        room,
        firstTossWinner,
        firstId,
        "bowl",
      ),
      undefined,
    );
    const firstSeed = room.liveResult.simulationSeed;
    assert.equal(
      createCheckpointStore({ enabled: true, directory }).save(room),
      true,
    );
    game.cleanupTimers(room);
    const server = await startServer(t, {
      ROOM_CHECKPOINTS: "1",
      ROOM_DATA_DIR: directory,
    });
    const host = await server.connect();
    const joined = nextEvent(host, "room:joined");
    const snapshot = nextEvent(host, "room:update");
    host.emit("room:rejoin", {
      code: room.code,
      userId: "host",
      reconnectToken: token,
    });
    await joined;
    const restored = await snapshot;
    assert.equal(restored.simulationPaused, true);
    assert.equal(restored.currentMatch.id, firstId);
    assert.equal(restored.currentMatch.toss.decision, "bowl");
    assert.notEqual(
      restored.currentMatch.liveScore.battingTeamId,
      firstTossWinner,
    );
    let update = nextRoom(host, (state) => !state.simulationPaused);
    host.emit("host:resumeSimulation");
    await update;
    update = nextRoom(
      host,
      (state) => state.currentMatch?.toss && state.currentMatch.id !== firstId,
    );
    host.emit("host:skipMatch");
    const second = await update;
    assert.equal(second.matchCount, 1);
    assert.equal(second.matchResults[0].simulationSeed, firstSeed);
    const secondToss = nextRoom(
      host,
      (state) => state.currentMatch?.live,
      5000,
    );
    assert.equal((await secondToss).currentMatch.toss.automatic, true);
    update = nextRoom(host, (state) => state.phase === "complete");
    host.emit("host:skipMatch");
    const complete = await update;
    assert.equal(complete.matchCount, 2);
  },
);
