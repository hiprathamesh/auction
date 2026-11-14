export function buildBowlingPlan(
  bowlers,
  { overs = 20, tactic = "balanced", priorities = {}, random = () => 0.5 } = {},
) {
  const remaining = bowlers.map(() => 4);
  const fixed = new Map();
  const reserve = (id, slots) => {
    const index = bowlers.findIndex((player) => player.id === id);
    if (index < 0) return;
    for (const slot of slots) fixed.set(slot, index);
  };
  reserve(
    priorities.powerplay,
    [0, 2].filter((slot) => slot < overs),
  );
  reserve(
    priorities.death,
    [overs - 4, overs - 2].filter((slot) => slot >= 15),
  );

  const strength = bowlers.map((player) => player.bowling || 50);
  const ranked = bowlers
    .map((_, index) => index)
    .sort((a, b) => strength[b] - strength[a]);
  const reserveAfter = Array.from({ length: overs }, (_, over) =>
    bowlers.map(
      (_, index) =>
        [...fixed].filter(([slot, bowler]) => slot > over && bowler === index)
          .length,
    ),
  );
  const failed = new Set();
  function schedule(over, previous) {
    if (over === overs) return [];
    const key = `${previous}:${remaining.join("")}`;
    if (failed.has(key)) return null;
    const required = reserveAfter[over];
    const phase = over < 6 ? "powerplay" : over >= 15 ? "death" : "middle";
    const phasePriority = phase === tactic && !priorities[phase];
    const candidates = (fixed.has(over) ? [fixed.get(over)] : ranked)
      .filter(
        (index) =>
          index !== previous &&
          index !== fixed.get(over + 1) &&
          remaining[index] > required[index],
      )
      .map((index) => ({
        index,
        score:
          strength[index] / 20 +
          random() * 1.4 +
          (bowlers[index].skills?.bowlingPhase === phase ? 0.35 : 0) +
          (phasePriority && ranked.indexOf(index) < 2 ? 2.2 : 0) +
          (tactic === "death" && phase !== "death" && ranked.indexOf(index) < 2
            ? -(4 - remaining[index]) * 1.2
            : 0) +
          (bowlers.length === 5
            ? remaining[index] * 1.2
            : remaining[index] * 0.45) -
          (priorities.backup === bowlers[index].id ? 4 : 0),
      }))
      .sort((a, b) => b.score - a.score);

    for (const { index } of candidates) {
      remaining[index]--;
      const slotsLeft = overs - over - 1;
      const capacity = remaining.reduce(
        (sum, count, bowler) =>
          sum +
          Math.min(
            count,
            Math.floor((slotsLeft + Number(bowler !== index)) / 2),
          ),
        0,
      );
      const rest = capacity >= slotsLeft ? schedule(over + 1, index) : null;
      remaining[index]++;
      if (rest) return [bowlers[index].id, ...rest];
    }
    failed.add(key);
    return null;
  }

  return schedule(0, -1);
}
