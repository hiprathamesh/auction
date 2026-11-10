const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const game = require("../server/game");
const { createCheckpointStore } = require("../server/checkpoints");
const database = require("../data/players.json");
const { startServer, nextEvent, nextRoom } = require("./helpers/server");

test(
  "trades, removal, lineups, skipped matches and playoffs stay consistent",
  { timeout: 35000 },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "auction-season-test-"),
    );
    t.after(() => {
      assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const hash = (token) =>
      crypto.createHash("sha256").update(token).digest("hex");
    const tokens = Array.from({ length: 5 }, (_, index) =>
      String.fromCharCode(65 + index).repeat(43),
    );
    const user = (index) => {
      const franchise = game.FRANCHISES[index];
      return {
        id: `user-${index}`,
        name: `Manager ${index}`,
        teamId: franchise.id,
        teamName: franchise.name,
        teamShort: franchise.short,
        teamColor: franchise.color,
        credentialHash: hash(tokens[index]),
      };
    };
    const room = game.createRoom("ABCDE", user(0), database);
    for (let index = 1; index < 5; index += 1)
      assert.ok(game.addUser(room, user(index)).user);
    let pool = [...database.players].sort((a, b) => b.ovr - a.ovr);
    for (const manager of room.users) {
      const selected = game.findBestLegalXI(pool);
      assert.ok(selected);
      pool = pool.filter(
        (player) => !selected.some((candidate) => candidate.id === player.id),
      );
      manager.squad = selected.map((player) => ({
        ...player,
        purchasePrice: player.basePrice,
      }));
      for (const player of selected)
        room.sold.push({
          player,
          price: player.basePrice,
          userId: manager.id,
          teamName: manager.teamName,
          lotNumber: room.sold.length + 1,
        });
    }
    room.phase = "auctionResults";
    room.settings.tradesEnabled = true;
    createCheckpointStore({ enabled: true, directory }).save(room);
    const server = await startServer(t, {
      ROOM_CHECKPOINTS: "1",
      ROOM_DATA_DIR: directory,
    });
    const sockets = [];
    for (let index = 0; index < 5; index += 1) {
      const socket = await server.connect();
      const joined = nextEvent(socket, "room:joined");
      socket.emit("room:rejoin", {
        code: room.code,
        userId: `user-${index}`,
        reconnectToken: tokens[index],
      });
      await joined;
      sockets.push(socket);
    }
    const [host, friend] = sockets;
    const own = room.users[0].squad.find((player) =>
      room.users[1].squad.some(
        (other) =>
          other.overseas === player.overseas && other.legend === player.legend,
      ),
    );
    const theirs = room.users[1].squad.find(
      (player) =>
        player.overseas === own.overseas && player.legend === own.legend,
    );
    let changed = nextRoom(friend, (state) => state.tradeOffers.length === 1);
    host.emit("trade:propose", {
      toUserId: "user-1",
      myPlayerId: own.id,
      theirPlayerId: theirs.id,
    });
    const offer = (await changed).tradeOffers[0];
    changed = nextRoom(host, (state) =>
      state.users[0].squad.some((player) => player.id === theirs.id),
    );
    friend.emit("trade:respond", { offerId: offer.id, accept: true });
    await changed;
    changed = nextRoom(host, (state) => state.users.length === 4);
    host.emit("host:kickUser", { userId: "user-1" });
    const afterRemoval = await changed;
    assert.ok(afterRemoval.unsold.some((player) => player.playerId === own.id));
    assert.ok(
      !afterRemoval.unsold.some((player) => player.playerId === theirs.id),
    );
    changed = nextRoom(host, (state) => state.phase === "lineup");
    host.emit("host:startLineups");
    await changed;
    changed = nextRoom(host, (state) =>
      state.users.every((manager) => manager.xiReady),
    );
    for (const socket of [sockets[0], sockets[2], sockets[3], sockets[4]])
      socket.emit("lineup:ready", true);
    await changed;
    async function skipUntil(endPhase) {
      let state = host.testRoom;
      while (state.phase !== endPhase) {
        assert.ok(
          state.currentMatch?.live,
          `expected a live match before ${endPhase}`,
        );
        const matchId = state.currentMatch.id;
        const next = nextRoom(
          host,
          (snapshot) =>
            snapshot.phase === endPhase ||
            (snapshot.currentMatch?.live &&
              snapshot.currentMatch.id !== matchId),
          4000,
        );
        host.emit("host:skipMatch");
        state = await next;
      }
      return state;
    }
    changed = nextRoom(
      host,
      (state) => state.phase === "league" && state.currentMatch?.live,
    );
    host.emit("host:startLeague");
    await changed;
    const league = await skipUntil("leagueComplete");
    assert.equal(league.matchCount, 12);
    changed = nextRoom(
      host,
      (state) => state.phase === "playoffs" && state.currentMatch?.live,
    );
    host.emit("host:startPlayoffs");
    await changed;
    await skipUntil("finalReady");
    changed = nextRoom(
      host,
      (state) => state.phase === "final" && state.currentMatch?.live,
    );
    host.emit("host:startFinal");
    await changed;
    const completed = await skipUntil("complete");
    assert.equal(completed.matchCount, 16);
    assert.ok(completed.championId);
  },
);
