const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  generateInnings,
  makeDoubleRoundRobin,
  simulateMatch,
  createSeededRandom,
} = require("../server/cricket");
const { getLeaders, createLiveEvents } = require("../server/game");
const { buildBowlingPlan } = require("../shared/bowling-plan.mjs");
const { buildCompactAuction } = require("../server/matchPlan");
const database = require("../data/players.json");

function team(id, players) {
  return {
    id,
    userId: id,
    name: id,
    teamName: id,
    squad: players,
    lineup: players.map((player) => player.id),
    bowlerIds: players.slice(0, 5).map((player) => player.id),
    tactics: { batting: "buildup", bowling: "balanced", fielding: "balanced" },
  };
}

test("fixtures contain one home and away meeting for every team", () => {
  for (let count = 2; count <= 10; count += 1) {
    const teams = Array.from({ length: count }, (_, index) => ({
      id: `team-${index}`,
    }));
    const fixtures = makeDoubleRoundRobin(teams);
    assert.equal(fixtures.length, count * (count - 1));
    assert.equal(
      new Set(fixtures.map((match) => `${match.homeId}/${match.awayId}`)).size,
      fixtures.length,
    );
    assert.ok(
      fixtures.every(
        (match) =>
          match.homeId && match.awayId && match.homeId !== match.awayId,
      ),
    );
  }
});

test("a wide or no-ball at the start of an over does not change the bowler", () => {
  const players = database.players
    .filter((player) => !player.legend && !player.overseas)
    .slice(0, 22);
  const home = team("home", players.slice(0, 11));
  const away = team("away", players.slice(11));
  let seed = 20261110;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let openingExtras = 0;
  for (let index = 0; index < 100; index += 1) {
    const innings = generateInnings(home, away, { random });
    assert.ok(innings.bowlers.every((bowler) => bowler.legalBalls <= 24));
    for (let ball = 1; ball < innings.events.length; ball += 1) {
      const previous = innings.events[ball - 1];
      const current = innings.events[ball];
      if (!previous.legal && previous.balls % 6 === 0) {
        openingExtras += 1;
        assert.equal(
          current.bowler.name,
          previous.bowler.name,
          "bowler changed after an opening extra",
        );
      }
    }
  }
  assert.ok(openingExtras > 0, "sample should include an opening extra");
});

test("best bowling figures are ranked by individual figures, not tournament wickets", () => {
  const playerStats = {
    a: {
      playerId: "a",
      name: "A",
      wickets: 20,
      bowlerRuns: 300,
      bowlerBalls: 240,
      bestBowling: "3/20",
    },
    b: {
      playerId: "b",
      name: "B",
      wickets: 10,
      bowlerRuns: 200,
      bowlerBalls: 120,
      bestBowling: "6/10",
    },
  };
  assert.equal(getLeaders({ playerStats }).bestFigures[0].name, "B");
});

test("a match seed reproduces its score and delivery outcomes", () => {
  const players = database.players
    .filter((player) => !player.legend && !player.overseas)
    .slice(0, 22);
  const home = team("home", players.slice(0, 11));
  const away = team("away", players.slice(11));
  const first = createLiveEvents(home, away, 123456);
  const second = createLiveEvents(home, away, 123456);
  const summarize = (match) => ({
    winnerId: match.result.winnerId,
    margin: match.result.margin,
    scores: match.result.innings.map((innings) => [
      innings.runs,
      innings.wickets,
      innings.legalBalls,
    ]),
    events: match.events.map(({ key, ...event }) => event),
  });
  assert.deepEqual(summarize(first), summarize(second));
});

test("seeded matches preserve scorekeeping and bowling invariants", () => {
  const players = database.players
    .filter((player) => !player.legend && !player.overseas)
    .slice(0, 22);
  const home = team("home", players.slice(0, 11));
  const away = team("away", players.slice(11));
  for (let seed = 1; seed <= 1000; seed += 1) {
    away.tactics.bowling = ["balanced", "powerplay", "death"][seed % 3];
    const match = simulateMatch(home, away, {
      random: createSeededRandom(seed),
    });
    for (const innings of match.innings) {
      assert.ok(innings.legalBalls <= 120);
      assert.ok(innings.bowlers.every((bowler) => bowler.legalBalls <= 24));
      assert.equal(
        innings.bowlers.reduce((sum, bowler) => sum + bowler.legalBalls, 0),
        innings.legalBalls,
      );
      assert.equal(
        innings.batters.filter((batter) => batter.out).length,
        innings.wickets,
      );
      assert.equal(
        innings.batters.reduce((sum, batter) => sum + batter.runs, 0) +
          innings.events.reduce((sum, event) => sum + event.extraRuns, 0),
        innings.runs,
      );
      assert.equal(
        innings.bowlers.reduce((sum, bowler) => sum + bowler.runs, 0),
        innings.events.reduce((sum, event) => sum + event.bowlerRuns, 0),
      );
      let freeHit = false;
      for (const event of innings.events) {
        assert.equal(event.freeHit, freeHit);
        if (freeHit && event.wicket) assert.equal(event.dismissal, "run out");
        if (event.extraType === "noBall") freeHit = true;
        else if (event.legal) freeHit = false;
      }
      const bowlersByOver = new Map();
      for (const event of innings.events) {
        const over = Math.floor((event.balls - (event.legal ? 1 : 0)) / 6);
        if (!bowlersByOver.has(over))
          bowlersByOver.set(over, event.bowler.name);
        assert.equal(
          bowlersByOver.get(over),
          event.bowler.name,
          `seed ${seed}, over ${over + 1}`,
        );
      }
      const ordered = [...bowlersByOver.values()];
      for (let over = 1; over < ordered.length; over += 1)
        assert.notEqual(
          ordered[over],
          ordered[over - 1],
          `consecutive overs at seed ${seed}`,
        );
    }
  }
});

test("five to seven bowlers can cover 20 overs and honor both phase reservations", () => {
  const players = database.players
    .filter((player) => player.bowling >= 75)
    .slice(0, 7);
  for (const count of [5, 6, 7]) {
    const unit = players.slice(0, count);
    for (let seed = 1; seed <= 100; seed++) {
      const opening = unit[seed % count].id;
      const death = unit[Math.floor(seed / count) % count].id;
      const plan = buildBowlingPlan(unit, {
        random: createSeededRandom(seed),
        tactic: ["balanced", "powerplay", "death"][seed % 3],
        priorities: { powerplay: opening, death },
      });
      assert.equal(plan.length, 20);
      assert.deepEqual(
        [plan[0], plan[2], plan[16], plan[18]],
        [opening, opening, death, death],
      );
      assert.ok(plan.every((id, index) => id !== plan[index - 1]));
      assert.ok(
        unit.every(
          (player) => plan.filter((id) => id === player.id).length <= 4,
        ),
      );
    }
  }
});

test("tied Super Overs replay with alternate batting order and eligible players", () => {
  const players = database.players
    .filter((player) => !player.legend)
    .slice(0, 11);
  const home = team("home", players);
  const away = team(
    "away",
    players.map((player) => ({ ...player, id: `away-${player.id}` })),
  );
  home.superOverPlan = {
    batters: home.lineup.slice(3, 6),
    bowler: home.lineup[8],
  };
  away.superOverPlan = {
    batters: away.lineup.slice(3, 6),
    bowler: away.lineup[8],
  };
  let result;
  for (let seed = 1; seed <= 4000; seed++) {
    const generated = createLiveEvents(home, away, seed).result;
    if (generated.superOver?.length > 2) {
      result = generated;
      break;
    }
  }
  assert.ok(result);
  assert.equal(result.superOver[0].battingTeamId, away.userId);
  assert.equal(result.superOver[2].battingTeamId, home.userId);
  assert.equal(result.superOver[0].runs, result.superOver[1].runs);
  for (const side of [home, away]) {
    const batting = result.superOver.filter(
      (innings) => innings.battingTeamId === side.userId,
    );
    const bowling = result.superOver.filter(
      (innings) => innings.bowlingTeamId === side.userId,
    );
    assert.deepEqual(
      batting[0].batters.map((entry) => entry.player.id),
      side.superOverPlan.batters,
    );
    assert.equal(bowling[0].bowlers[0].player.id, side.superOverPlan.bowler);
    assert.notEqual(bowling[1].bowlers[0].player.id, side.superOverPlan.bowler);
    assert.ok(
      batting[1].batters.every(
        (entry) =>
          !batting[0].batters.some(
            (first) => first.out && first.player.id === entry.player.id,
          ),
      ),
    );
  }
  assert.ok(result.winnerId);
});

test("compact auctions preserve player IDs and domestic role coverage across room sizes", () => {
  for (const teamCount of [6, 7, 10]) {
    for (const legends of [true, false]) {
      const players = database.players.filter(
        (player) => legends || !player.legend,
      );
      const retained = players.find(
        (player) => !player.overseas && !player.legend,
      );
      const available = players.filter((player) => player.id !== retained.id);
      const { queue, reserve } = buildCompactAuction(
        available,
        teamCount,
        [{ squad: [retained] }],
        () => 0.5,
      );
      assert.equal(queue.length + 1, teamCount * 19);
      assert.deepEqual(
        new Set([...queue, ...reserve].map((player) => player.id)),
        new Set(available.map((player) => player.id)),
      );
      assert.equal(queue.length + reserve.length, available.length);
      const domestic = [...queue, retained].filter(
        (player) => !player.overseas && !player.legend,
      );
      assert.ok(domestic.length >= teamCount * 10);
      assert.ok(
        domestic.filter((player) => player.role === "Wicketkeeper").length >=
          teamCount,
      );
      assert.ok(
        domestic.filter((player) => player.bowling >= 60).length >=
          teamCount * 5,
      );
    }
  }
});
