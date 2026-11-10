const { simulateMatch, createSeededRandom } = require("../server/cricket");
const { findBestLegalXI } = require("../server/game");
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
  return {
    userId: id,
    name: id,
    teamName: id,
    squad,
    lineup: squad.map((player) => player.id),
    bowlerIds: [...squad]
      .sort((a, b) => b.bowling - a.bowling)
      .slice(0, 5)
      .map((player) => player.id),
    tactics: { batting, bowling: "balanced", fielding: "balanced" },
  };
}

for (const batting of ["buildup", "powerplay", "finish"]) {
  let homeWins = 0;
  let ties = 0;
  let firstInningsRuns = 0;
  const home = team("home", batting);
  const away = team("away", "buildup");
  for (let seed = 1; seed <= sampleSize; seed += 1) {
    const match = simulateMatch(home, away, {
      random: createSeededRandom(seed),
    });
    if (match.winnerId === "home") homeWins += 1;
    if (match.tied) ties += 1;
    firstInningsRuns += match.innings[0].runs;
  }
  const winRate = homeWins / sampleSize;
  const margin = 1.96 * Math.sqrt((winRate * (1 - winRate)) / sampleSize);
  console.log(
    JSON.stringify({
      batting,
      matches: sampleSize,
      homeWinPercent: +(winRate * 100).toFixed(2),
      confidence95Percent: +(margin * 100).toFixed(2),
      ties,
      firstInningsAverage: +(firstInningsRuns / sampleSize).toFixed(1),
    }),
  );
}
console.log(
  "Identical player abilities and lineups; home bats first. Ties are before the super over.",
);
