const demand = require("../data/auction-demand.json");

function rankBowlers(players) {
  return [...players].sort(
    (a, b) =>
      b.bowling - a.bowling || b.ovr - a.ovr || a.id.localeCompare(b.id),
  );
}

function suggestMatchPlan(squad, findBestLegalXI) {
  const legal = findBestLegalXI(squad);
  if (!legal) return null;
  const bowling = new Set(
    rankBowlers(squad)
      .slice(0, 7)
      .map((p) => p.id),
  );
  const candidates = [
    { keeper: false, bowling: false },
    { keeper: true, bowling: false },
    { keeper: true, bowling: true },
  ].map((weights) =>
    findBestLegalXI(
      squad,
      (p) =>
        p.ovr +
        (weights.keeper && p.role === "Wicketkeeper" ? 14 : 0) +
        (weights.bowling && bowling.has(p.id) ? 15 : 0),
    ),
  );
  const score = (players) =>
    players.reduce((sum, p) => sum + p.ovr, 0) +
    (players.some((p) => p.role === "Wicketkeeper") ? 25 : 0) +
    rankBowlers(players)
      .slice(0, 5)
      .reduce((sum, p) => sum + p.bowling * 0.55, 0);
  const selected = candidates.reduce(
    (best, candidate) => (score(candidate) > score(best) ? candidate : best),
    legal,
  );
  const unplaced = [...selected];
  const lineup = [];
  for (let slot = 1; slot <= selected.length; slot++) {
    const fit = (p) =>
      p.batting + (p.preferredBattingPositions?.includes(slot) ? 9 : 0);
    unplaced.sort((a, b) => fit(b) - fit(a) || b.ovr - a.ovr);
    lineup.push(unplaced.shift().id);
  }
  const ranked = rankBowlers(selected);
  const bowlerIds = ranked
    .slice(0, ranked[5]?.bowling >= 65 ? 6 : 5)
    .map((p) => p.id);
  return {
    lineup,
    bowlerIds,
    bowlingPlan: {},
    superOverPlan: {
      batters: [...selected]
        .sort(
          (a, b) =>
            (b.skills?.hitting ?? b.batting) - (a.skills?.hitting ?? a.batting),
        )
        .slice(0, 3)
        .map((p) => p.id),
      bowler: ranked[0].id,
    },
  };
}

function buildCompactAuction(
  players,
  teamCount,
  users = [],
  random = Math.random,
) {
  const variation = new Map(players.map((player) => [player.id, random() * 8]));
  const preference = (player) =>
    (demand[player.id] || 0) * 5 +
    player.ovr +
    (player.set === "Marquee Set 1" ? 4 : 0) +
    variation.get(player.id);
  const ranked = [...players].sort((a, b) => preference(b) - preference(a));
  const selected = new Set();
  const domestics = (players) =>
    players.filter((p) => !p.overseas && !p.legend);
  const home = domestics(ranked);
  const keepers = (players) => players.filter((p) => p.role === "Wicketkeeper");
  const bowlers = (players) =>
    rankBowlers(players).filter((p) => p.bowling >= 60);
  const retained = users.flatMap((user) => user.squad || []);
  const retainedHome = domestics(retained);
  function fill(list, count) {
    for (const player of list.slice(0, Math.max(0, count)))
      selected.add(player.id);
  }
  fill(keepers(home), teamCount * 2 - keepers(retainedHome).length);
  fill(bowlers(home), teamCount * 6 - bowlers(retainedHome).length);
  for (const player of home) {
    if (selected.size + retainedHome.length >= teamCount * 10) break;
    selected.add(player.id);
  }
  for (const player of ranked) {
    if (selected.size + retained.length >= teamCount * 19) break;
    selected.add(player.id);
  }
  const primary = ranked.filter((p) => selected.has(p.id));
  const byRole = ["Batter", "Bowler", "All-rounder", "Wicketkeeper"].map(
    (role) => primary.filter((p) => p.role === role),
  );
  const queue = [];
  while (byRole.some((group) => group.length)) {
    for (const group of byRole) {
      if (group.length) queue.push(group.shift());
    }
  }
  return { queue, reserve: ranked.filter((p) => !selected.has(p.id)) };
}

module.exports = { rankBowlers, suggestMatchPlan, buildCompactAuction };
