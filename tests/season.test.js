const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const database = require("../data/players.json");
const { makeDoubleRoundRobin } = require("../server/cricket");
const { makeSeasonSnapshot } = require("../server/seasons");

test("a ten-team league and playoffs finish with consistent standings", () => {
  const file = path.resolve(__dirname, "../server/game.js");
  const tasks = new Map();
  let clock = 0;
  let sequence = 0;
  const context = {
    require: createRequire(file),
    module: { exports: {} },
    Date,
    Math,
    setTimeout: (fn, delay) => {
      const id = ++sequence;
      tasks.set(id, { fn, due: clock + delay });
      return id;
    },
    clearTimeout: (id) => tasks.delete(id),
    clearInterval: () => {},
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, {
    filename: file,
  });
  const game = context.module.exports;
  const io = { to: () => ({ emit: () => {} }) };
  const room = game.createRoom(
    "TEST1",
    { id: "u0", name: "Host", teamId: "CSK" },
    database,
  );
  let pool = [...database.players].sort((a, b) => b.ovr - a.ovr);
  room.users = game.FRANCHISES.map((franchise, index) => {
    const squad = game.findBestLegalXI(pool);
    assert.ok(squad);
    pool = pool.filter(
      (player) => !squad.some((selected) => selected.id === player.id),
    );
    return {
      id: `u${index}`,
      name: `User ${index}`,
      teamId: franchise.id,
      teamName: franchise.name,
      teamShort: franchise.short,
      teamColor: franchise.color,
      squad,
      lineup: squad.map((player) => player.id),
      bowlerIds: [...squad]
        .sort((a, b) => b.bowling - a.bowling)
        .slice(0, 5)
        .map((player) => player.id),
      purse: 0,
      tactics: { ...game.DEFAULT_TACTICS },
      connected: true,
    };
  });
  const advance = () => {
    let steps = 0;
    while (tasks.size) {
      const [id, task] = [...tasks.entries()].sort(
        (a, b) => a[1].due - b[1].due,
      )[0];
      tasks.delete(id);
      clock = task.due;
      task.fn();
      assert.ok(++steps < 100000, "simulation timers should finish");
    }
  };
  room.phase = "league";
  room.fixtures = makeDoubleRoundRobin(room.users);
  game.startLiveMatch(io, room, room.fixtures[0]);
  advance();
  assert.equal(room.phase, "leagueComplete");
  assert.equal(room.matchResults.length, 90);
  assert.ok(room.standings.every((entry) => entry.played === 18));
  assert.equal(
    room.standings.reduce((total, entry) => total + entry.points, 0),
    180,
  );
  game.startPlayoffs(io, room);
  advance();
  assert.equal(room.phase, "finalReady");
  room.phase = "final";
  game.startLiveMatch(io, room, {
    id: "final",
    type: "final",
    round: "Final",
    homeId: room.playoff.finalists[0],
    awayId: room.playoff.finalists[1],
  });
  advance();
  assert.equal(room.phase, "complete");
  assert.equal(room.matchResults.length, 94);
  assert.ok(room.championId);
  const archive = makeSeasonSnapshot(room);
  assert.equal(archive.matches.length, 94);
  assert.equal(
    archive.matches.filter((match) => match.type !== "league").length,
    4,
  );
  assert.ok(
    archive.matches.every((match) => match.ballByBall.innings.length === 2),
  );
  assert.ok(
    room.matchResults.every((match) =>
      match.innings.every((innings) => !innings.events),
    ),
  );
});

test("a restored final can resume before match creation", () => {
  const game = require("../server/game");
  const team = game.FRANCHISES[0];
  const room = game.createRoom(
    "TEST1",
    {
      id: "home",
      name: "Home",
      teamId: team.id,
      teamName: team.name,
      teamShort: team.short,
      teamColor: team.color,
    },
    database,
  );
  const other = game.FRANCHISES[1];
  game.addUser(room, {
    id: "away",
    name: "Away",
    teamId: other.id,
    teamName: other.name,
    teamShort: other.short,
    teamColor: other.color,
  });
  let pool = [...database.players];
  for (const user of room.users) {
    user.squad = game.findBestLegalXI(pool);
    pool = pool.filter(
      (player) => !user.squad.some((selected) => selected.id === player.id),
    );
    user.lineup = user.squad.map((player) => player.id);
    user.bowlerIds = user.lineup.slice(0, 5);
  }
  room.phase = "final";
  room.playoff.finalists = ["home", "away"];
  room.simulationPaused = true;
  const io = { to: () => ({ emit: () => {} }) };
  assert.equal(game.resumeSimulation(io, room), true);
  assert.equal(room.currentMatch.id, "final");
  assert.equal(room.simulationPaused, false);
  game.cleanupTimers(room);
});
