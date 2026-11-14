const { simulateMatch, createSeededRandom } = require("../server/cricket");
const { findBestLegalXI } = require("../server/game");
const { suggestMatchPlan } = require("../server/matchPlan");
const database = require("../data/players.json");

const sampleSize = Math.max(
  100,
  Math.min(100000, Number(process.argv[2]) || 5000),
);
const selected = findBestLegalXI(
  database.players.filter((player) => !player.legend),
);
if (!selected) throw new Error("Could not build a legal test XI");

function team(id, batting) {
  const squad = selected.map((player) => ({
    ...player,
    id: `${id}-${player.id}`,
  }));
  const plan = suggestMatchPlan(squad, findBestLegalXI);
  return {
    userId: id,
    name: id,
    teamName: id,
    squad,
    ...plan,
    tactics: { batting, bowling: "balanced", fielding: "balanced" },
  };
}

for (const batting of ["buildup", "powerplay", "finish"]) {
  let homeWins = 0;
  let ties = 0;
  const firstScores = [];
  let earlyCollapses = 0;
  let allOuts = 0;
  const phases = Array.from({ length: 3 }, () => ({
    balls: 0,
    runs: 0,
    wickets: 0,
    extras: 0,
  }));
  const chase = Object.fromEntries(
    ["<160", "160–189", "190–219", "220+"].map((range) => [
      range,
      { matches: 0, won: 0 },
    ]),
  );
  const home = team("home", batting);
  const away = team("away", "buildup");
  for (let seed = 1; seed <= sampleSize; seed += 1) {
    const match = simulateMatch(home, away, {
      random: createSeededRandom(seed),
    });
    if (match.winnerId === "home") homeWins += 1;
    if (match.tied) ties += 1;
    const innings = match.innings[0];
    firstScores.push(innings.runs);
    earlyCollapses += Number(
      innings.events.some((ball) => ball.balls <= 36 && ball.wickets >= 3),
    );
    allOuts += Number(innings.allOut);
    const target = innings.runs + 1;
    const range =
      target < 160
        ? "<160"
        : target < 190
          ? "160–189"
          : target < 220
            ? "190–219"
            : "220+";
    chase[range].matches++;
    chase[range].won += Number(match.winnerId === "away");
    for (const event of innings.events) {
      const over = (event.balls - Number(event.legal)) / 6;
      const phase = phases[over < 6 ? 0 : over < 15 ? 1 : 2];
      phase.balls += Number(event.legal);
      phase.runs += event.runs;
      phase.wickets += Number(event.wicket);
      phase.extras += event.extraRuns;
    }
  }
  firstScores.sort((a, b) => a - b);
  const winRate = homeWins / sampleSize;
  const margin = 1.96 * Math.sqrt((winRate * (1 - winRate)) / sampleSize);
  console.log(
    JSON.stringify({
      batting,
      matches: sampleSize,
      homeWinPercent: +(winRate * 100).toFixed(2),
      confidence95Percent: +(margin * 100).toFixed(2),
      ties,
      firstInningsAverage: +(
        firstScores.reduce((sum, runs) => sum + runs, 0) / sampleSize
      ).toFixed(1),
      firstInningsP05P50P95: [0.05, 0.5, 0.95].map(
        (percentile) => firstScores[Math.floor(sampleSize * percentile)],
      ),
      threeDownInPowerplayPercent: +(
        (100 * earlyCollapses) /
        sampleSize
      ).toFixed(1),
      allOutPercent: +((100 * allOuts) / sampleSize).toFixed(1),
      phases: phases.map(({ balls, runs, wickets, extras }) => ({
        runsPerOver: +((6 * runs) / balls).toFixed(2),
        wicketsPer100Legal: +((100 * wickets) / balls).toFixed(2),
        extrasPer100Legal: +((100 * extras) / balls).toFixed(2),
      })),
      chase,
    }),
  );
}
console.log(
  "Identical player abilities and lineups; home bats first. Ties are before the super over.",
);
