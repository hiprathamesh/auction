const crypto = require("crypto");

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rng = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

function playerShape(player) {
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    nationality: player.nationality,
    overseas: player.overseas,
    ovr: player.ovr,
    batting: player.batting,
    bowling: player.bowling,
    fielding: player.fielding,
    legend: Boolean(player.legend),
    preferredBattingPositions: Array.isArray(player.preferredBattingPositions)
      ? [...player.preferredBattingPositions]
      : [],
    battingPosition: Number.isInteger(player.battingPosition)
      ? player.battingPosition
      : null,
  };
}

function generateInnings(battingTeam, bowlingTeam, options = {}) {
  const {
    target = null,
    maxOvers = 20,
    superOver = false,
    random = Math.random,
  } = options;
  // `lineup` is an ordered list: its first two players open, and later entries
  // come in next when a wicket falls. Never reorder this list inside the engine.
  const battingXI = (
    Array.isArray(battingTeam.lineup) ? battingTeam.lineup : []
  )
    .map((id) => battingTeam.squad.find((p) => p.id === id))
    .filter(Boolean);
  const fieldingXI = (
    Array.isArray(bowlingTeam.lineup) ? bowlingTeam.lineup : []
  )
    .map((id) => bowlingTeam.squad.find((p) => p.id === id))
    .filter(Boolean);
  const bowlingIds = Array.isArray(bowlingTeam.bowlerIds)
    ? bowlingTeam.bowlerIds
    : [];
  let bowlingOrder = bowlingIds
    .map((id) => bowlingTeam.squad.find((p) => p.id === id))
    .filter(Boolean);
  // Compatibility fallback for old saved/in-memory rooms without a bowling unit.
  if (
    bowlingOrder.length !== 5 ||
    new Set(bowlingOrder.map((p) => p.id)).size !== 5
  ) {
    bowlingOrder = [...fieldingXI]
      .sort(
        (a, b) =>
          (b.bowling || 0) - (a.bowling || 0) || (b.ovr || 0) - (a.ovr || 0),
      )
      .slice(0, Math.min(5, fieldingXI.length));
  }
  if (!bowlingOrder.length) bowlingOrder = [...fieldingXI];
  const batting = battingXI.map((player, index) => ({
    player: playerShape({ ...player, battingPosition: index + 1 }),
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    out: false,
    dismissal: "",
  }));
  const bowlers = new Map(
    bowlingOrder.map((p) => [
      p.id,
      {
        player: playerShape(p),
        runs: 0,
        wickets: 0,
        balls: 0,
        legalBalls: 0,
        maidens: 0,
        currentOverRuns: 0,
      },
    ]),
  );
  const avgFielding = fieldingXI.length
    ? fieldingXI.reduce(
        (sum, player) =>
          sum + (Number(player.fielding) || 65) + (player.legend ? 3 : 0),
        0,
      ) / fieldingXI.length
    : 65;
  // Legends receive a small, explicit performance premium in addition to their boosted ratings.
  // This keeps a 99-rated legend better than a 99-rated regular player without making outcomes certain.
  const battingAbility = (player) =>
    (Number(player.batting) || 65) * 0.8 +
    (Number(player.ovr) || 65) * 0.2 +
    (player.legend ? 4.5 : 0);
  const bowlingAbility = (player) =>
    (Number(player.bowling) || 50) * 0.82 +
    (Number(player.ovr) || 65) * 0.18 +
    (player.role === "Bowler" ? 2 : player.role === "All-rounder" ? 0.5 : 0) +
    (player.legend ? 4.5 : 0);
  const battingTactic = ["powerplay", "buildup", "finish"].includes(
    battingTeam.tactics?.batting,
  )
    ? battingTeam.tactics.batting
    : "buildup";
  const bowlingTactic = ["powerplay", "balanced", "death"].includes(
    bowlingTeam.tactics?.bowling,
  )
    ? bowlingTeam.tactics.bowling
    : "balanced";
  const fieldingTactic = ["aggressive", "balanced", "conservative"].includes(
    bowlingTeam.tactics?.fielding,
  )
    ? bowlingTeam.tactics.fielding
    : "balanced";
  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  let strikerIndex = 0;
  let nonStrikerIndex = 1;
  let nextBatterIndex = 2;
  const events = [];
  const overCount = Math.max(1, maxOvers);
  let currentBowlerId = null;
  let previousBowlerId = null;
  let startedOver = -1;
  let overRuns = 0;
  const oversByBowler = new Map(bowlingOrder.map((p) => [p.id, 0]));
  const powerplayOversByBowler = new Map(bowlingOrder.map((p) => [p.id, 0]));
  const deathOversByBowler = new Map(bowlingOrder.map((p) => [p.id, 0]));
  const bestTwoBowlerIds = new Set(
    [...bowlingOrder]
      .sort(
        (a, b) =>
          bowlingAbility(b) - bowlingAbility(a) || (b.ovr || 0) - (a.ovr || 0),
      )
      .slice(0, 2)
      .map((p) => p.id),
  );

  const batterNow = () => batting[strikerIndex] || null;
  const nonStrikerNow = () => batting[nonStrikerIndex] || null;
  const weightedPick = (candidates) => {
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    const weights = candidates.map((p) =>
      Math.exp((bowlingAbility(p) - 75) / 35),
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let ticket = random() * totalWeight;
    for (let i = 0; i < candidates.length; i += 1) {
      ticket -= weights[i];
      if (ticket <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  };
  const chooseBowler = (overNo) => {
    const cap = superOver ? 6 : 24;
    let allowed = bowlingOrder.filter((p) => {
      const stats = bowlers.get(p.id);
      return stats && stats.legalBalls < cap && p.id !== previousBowlerId;
    });
    if (!allowed.length) {
      allowed = bowlingOrder.filter(
        (p) => (bowlers.get(p.id)?.legalBalls ?? cap) < cap,
      );
    }
    if (!allowed.length) return bowlingOrder[0];

    // Phase-aware strategies gently move the two strongest selected bowlers into
    // the chosen phase, while preserving the four-over cap and no consecutive overs.
    if (!superOver && bowlingTactic === "powerplay" && overNo < 6) {
      const quota = allowed.filter(
        (p) =>
          bestTwoBowlerIds.has(p.id) &&
          (powerplayOversByBowler.get(p.id) || 0) < 2,
      );
      if (quota.length) return weightedPick(quota);
    }
    if (!superOver && bowlingTactic === "death") {
      if (overNo < 15) {
        // Keep the top two fresh where possible; the three supporting options bowl early.
        const supporting = allowed.filter((p) => !bestTwoBowlerIds.has(p.id));
        if (supporting.length) {
          const leastUsed = Math.min(
            ...supporting.map((p) => oversByBowler.get(p.id) || 0),
          );
          return weightedPick(
            supporting.filter(
              (p) => (oversByBowler.get(p.id) || 0) === leastUsed,
            ),
          );
        }
      } else {
        const quota = allowed.filter(
          (p) =>
            bestTwoBowlerIds.has(p.id) &&
            (deathOversByBowler.get(p.id) || 0) < 2,
        );
        if (quota.length) return weightedPick(quota);
      }
    }

    // Balanced allocation: use the least-used legal bowler, then rating and luck as tie-breakers.
    const leastUsedOvers = Math.min(
      ...allowed.map((p) => oversByBowler.get(p.id) || 0),
    );
    const leastUsed = allowed.filter(
      (p) => (oversByBowler.get(p.id) || 0) === leastUsedOvers,
    );
    return weightedPick(leastUsed) || allowed[0];
  };

  const maxWickets = superOver ? 2 : 10;
  while (
    legalBalls < overCount * 6 &&
    wickets < maxWickets &&
    (target === null || runs < target)
  ) {
    const overNo = Math.floor(legalBalls / 6);
    const ballNo = legalBalls % 6;
    // An illegal first delivery leaves legalBalls unchanged, but the over has
    // already started and must continue with the same bowler.
    if (ballNo === 0 && startedOver !== overNo) {
      if (currentBowlerId && bowlers.get(currentBowlerId) && overRuns === 0)
        bowlers.get(currentBowlerId).maidens += 1;
      if (overNo >= overCount) break;
      const selected = chooseBowler(overNo);
      startedOver = overNo;
      currentBowlerId = selected.id;
      previousBowlerId = currentBowlerId;
      oversByBowler.set(
        currentBowlerId,
        (oversByBowler.get(currentBowlerId) || 0) + 1,
      );
      if (overNo < 6)
        powerplayOversByBowler.set(
          currentBowlerId,
          (powerplayOversByBowler.get(currentBowlerId) || 0) + 1,
        );
      if (overNo >= 15)
        deathOversByBowler.set(
          currentBowlerId,
          (deathOversByBowler.get(currentBowlerId) || 0) + 1,
        );
      overRuns = 0;
      bowlers.get(currentBowlerId).currentOverRuns = 0;
    }
    const striker = batterNow();
    const nonStriker = nonStrikerNow();
    if (!striker || !nonStriker) break;
    const bowler =
      bowlingOrder.find((p) => p.id === currentBowlerId) || bowlingOrder[0];
    const bowlerStats = bowlers.get(bowler.id) || bowlers.values().next().value;
    if (!bowlerStats) break;

    const batSkill = battingAbility(striker.player);
    const bowlSkill = bowlingAbility(bowler);
    // Temper the raw gap so rating advantages matter across a match without
    // making large gaps nearly deterministic.
    const skillGap = (batSkill - bowlSkill) * 0.55;
    const fieldingEdge = avgFielding - 75;
    // Ratings provide a real edge, but their effects are deliberately bounded.
    // A 10-point mismatch changes ball outcomes noticeably without deciding a
    // whole match on its own; each delivery still rolls an independent random outcome.
    let wicketP =
      0.054 -
      skillGap * 0.0007 +
      (bowler.role === "Bowler" ? 0.004 : 0) +
      fieldingEdge * 0.00015;
    let sixP =
      0.05 +
      (batSkill - 75) * 0.00065 -
      (bowlSkill - 75) * 0.00028 -
      fieldingEdge * 0.00014;
    let fourP =
      0.145 +
      (batSkill - 75) * 0.00055 -
      (bowlSkill - 75) * 0.0003 -
      fieldingEdge * 0.0002;
    let dotP = 0.29 - skillGap * 0.0007 + fieldingEdge * 0.00015;
    let oneP = 0.3;
    let twoP = 0.105;
    const threeP = 0.009;
    const extraP = 0.027;

    // Tactical modifiers are intentionally small compared with the player-skill ratings.
    // They bias probabilities by fractions of a percentage point to a few points, not outcomes.
    if (battingTactic === "powerplay" && overNo < 6) {
      sixP += 0.005;
      fourP += 0.006;
      wicketP += 0.002;
      dotP -= 0.003;
      oneP -= 0.002;
    } else if (battingTactic === "buildup" && overNo < 6) {
      sixP -= 0.003;
      fourP -= 0.004;
      wicketP -= 0.002;
      dotP += 0.004;
      oneP += 0.003;
      twoP += 0.001;
    } else if (battingTactic === "finish") {
      if (overNo < 15) {
        sixP -= 0.003;
        fourP -= 0.003;
        wicketP -= 0.0008;
        oneP += 0.002;
        twoP += 0.002;
      } else {
        sixP += 0.009;
        fourP += 0.007;
        wicketP += 0.002;
        dotP -= 0.006;
        oneP -= 0.003;
        twoP -= 0.002;
      }
    }
    let caughtChanceModifier = 0;
    if (fieldingTactic === "aggressive") {
      // Close, attacking fields pressure quick singles but can leak boundaries.
      dotP += 0.006;
      oneP -= 0.005;
      twoP -= 0.004;
      fourP += 0.004;
      sixP += 0.003;
      caughtChanceModifier -= 0.035;
    } else if (fieldingTactic === "conservative") {
      // Protect the rope and attack chances: more singles/twos, but slightly better catching.
      dotP -= 0.005;
      oneP += 0.006;
      twoP += 0.005;
      fourP -= 0.003;
      sixP -= 0.002;
      wicketP += 0.001;
      caughtChanceModifier += 0.1;
    }
    const preferredBattingSlot =
      ["Batter", "Wicketkeeper", "All-rounder"].includes(striker.player.role) &&
      Array.isArray(striker.player.preferredBattingPositions) &&
      striker.player.preferredBattingPositions.includes(
        striker.player.battingPosition,
      );
    if (preferredBattingSlot) {
      // Multiply batter-scored outcome weights by 1.17. Since the weights are
      // normalized below, this is a +17% relative-odds bonus versus dots/dismissals.
      const preferredOddsMultiplier = 1.17;
      sixP *= preferredOddsMultiplier;
      fourP *= preferredOddsMultiplier;
      oneP *= preferredOddsMultiplier;
      twoP *= preferredOddsMultiplier;
    }
    const adjustedThreeP = threeP * (preferredBattingSlot ? 1.17 : 1);
    wicketP = clamp(wicketP, 0.03, 0.092);
    sixP = clamp(sixP, 0.025, 0.09);
    fourP = clamp(fourP, 0.09, 0.21);
    dotP = clamp(dotP, 0.21, 0.38);
    oneP = clamp(oneP, 0.2, 0.4);
    twoP = clamp(twoP, 0.07, 0.16);
    const r =
      random() *
      (wicketP + sixP + fourP + dotP + oneP + twoP + adjustedThreeP + extraP);
    let outcome = "DOT";
    let batterRuns = 0;
    let teamRuns = 0;
    let legal = true;
    let wicket = false;
    let dismissal = "";

    if (r < wicketP) {
      wicket = true;
      const fieldingQuality = clamp((avgFielding - 60) / 39, 0, 1);
      const caughtChance = clamp(
        0.48 + fieldingQuality * 0.13 + caughtChanceModifier,
        0.4,
        0.72,
      );
      const runOutChance = clamp(
        0.08 +
          fieldingQuality * 0.04 +
          (fieldingTactic === "aggressive" ? 0.015 : 0),
        0.06,
        0.16,
      );
      const lbwChance = 0.15;
      const dismissalRoll = random();
      if (dismissalRoll < caughtChance) dismissal = "caught";
      else if (dismissalRoll < caughtChance + runOutChance)
        dismissal = "run out";
      else if (dismissalRoll < caughtChance + runOutChance + lbwChance)
        dismissal = "lbw";
      else dismissal = "bowled";
      outcome = `WICKET · ${dismissal.toUpperCase()}`;
      striker.out = true;
      striker.dismissal = dismissal;
      wickets += 1;
      if (dismissal !== "run out") bowlerStats.wickets += 1;
      if (nextBatterIndex < batting.length) {
        strikerIndex = nextBatterIndex;
        nextBatterIndex += 1;
      } else {
        strikerIndex = -1;
      }
    } else if (r < wicketP + sixP) {
      batterRuns = 6;
      teamRuns = 6;
      striker.sixes += 1;
      outcome = "SIX";
    } else if (r < wicketP + sixP + fourP) {
      batterRuns = 4;
      teamRuns = 4;
      striker.fours += 1;
      outcome = "FOUR";
    } else if (r < wicketP + sixP + fourP + dotP) {
      outcome = "DOT";
    } else if (r < wicketP + sixP + fourP + dotP + oneP) {
      batterRuns = 1;
      teamRuns = 1;
      outcome = "1 RUN";
    } else if (r < wicketP + sixP + fourP + dotP + oneP + twoP) {
      batterRuns = 2;
      teamRuns = 2;
      outcome = "2 RUNS";
    } else if (
      r <
      wicketP + sixP + fourP + dotP + oneP + twoP + adjustedThreeP
    ) {
      batterRuns = 3;
      teamRuns = 3;
      outcome = "3 RUNS";
    } else if (
      r <
      wicketP + sixP + fourP + dotP + oneP + twoP + adjustedThreeP + extraP
    ) {
      teamRuns = 1;
      legal = false;
      outcome = random() < 0.55 ? "WIDE · +1" : "NO-BALL · +1";
    } else {
      outcome = "DOT";
    }

    if (legal) {
      legalBalls += 1;
      striker.balls += 1;
      bowlerStats.balls += 1;
      bowlerStats.legalBalls += 1;
    }
    striker.runs += batterRuns;
    runs += teamRuns;
    bowlerStats.runs += teamRuns;
    overRuns += teamRuns;
    bowlerStats.currentOverRuns += teamRuns;

    // Rotate the strike on odd runs; after the sixth legal ball the ends swap again.
    if (!wicket && (batterRuns === 1 || batterRuns === 3 || batterRuns === 5)) {
      [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
    }
    if (
      legal &&
      legalBalls % 6 === 0 &&
      wickets < maxWickets &&
      target !== null &&
      runs < target
    ) {
      [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
    } else if (
      legal &&
      legalBalls % 6 === 0 &&
      wickets < maxWickets &&
      target === null
    ) {
      [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
    }

    const currentBatterA = batterNow();
    const currentBatterB = nonStrikerNow();
    const over = Math.floor(legalBalls / 6);
    const ball = legalBalls % 6;
    const event = {
      key: crypto.randomUUID(),
      outcome,
      wicket,
      dismissal,
      legal,
      runs: teamRuns,
      batterRuns,
      score: runs,
      wickets,
      balls: legalBalls,
      overs: fmtOvers(legalBalls),
      innings: {
        runs,
        wickets,
        balls: legalBalls,
        overs: fmtOvers(legalBalls),
      },
      batter1: currentBatterA
        ? {
            name: currentBatterA.player.name,
            runs: currentBatterA.runs,
            balls: currentBatterA.balls,
            out: currentBatterA.out,
          }
        : null,
      batter2: currentBatterB
        ? {
            name: currentBatterB.player.name,
            runs: currentBatterB.runs,
            balls: currentBatterB.balls,
            out: currentBatterB.out,
          }
        : null,
      bowler: {
        name: bowlerStats.player.name,
        runs: bowlerStats.runs,
        wickets: bowlerStats.wickets,
        balls: bowlerStats.legalBalls,
        overs: fmtOvers(bowlerStats.legalBalls),
      },
      overNumber: over,
      ballNumber: ball,
      commentary: wicket
        ? `${striker.player.name} is out! ${dismissal}.`
        : outcome === "SIX"
          ? `${striker.player.name} launches it for six.`
          : outcome === "FOUR"
            ? `${striker.player.name} finds the boundary.`
            : teamRuns > 0
              ? `${striker.player.name} takes ${teamRuns} run${teamRuns > 1 ? "s" : ""}.`
              : `${bowler.name} beats the bat.`,
      target,
    };
    events.push(event);
  }

  if (
    currentBowlerId &&
    bowlers.get(currentBowlerId) &&
    overRuns === 0 &&
    legalBalls % 6 === 0
  )
    bowlers.get(currentBowlerId).maidens += 1;
  const allOut = wickets >= maxWickets;
  const reachedTarget = target !== null && runs >= target;
  const completed = legalBalls >= overCount * 6 || allOut || reachedTarget;
  const innings = {
    battingTeamId: battingTeam.userId,
    battingTeamName: battingTeam.teamName,
    battingUserName: battingTeam.name,
    bowlingTeamId: bowlingTeam.userId,
    bowlingTeamName: bowlingTeam.teamName,
    runs,
    wickets,
    legalBalls,
    overs: fmtOvers(legalBalls),
    allOut,
    target,
    completed,
    batters: batting.map((b) => ({
      ...b,
      strikeRate: b.balls ? (b.runs * 100) / b.balls : 0,
    })),
    bowlers: [...bowlers.values()].map((b) => ({
      ...b,
      overs: fmtOvers(b.legalBalls),
      economy: b.legalBalls ? b.runs / (b.legalBalls / 6) : 0,
    })),
    events,
  };
  // All-out innings count as a full allocation for NRR, per common T20 practice.
  innings.nrrOvers =
    allOut && legalBalls < overCount * 6 ? overCount : legalBalls / 6;
  return innings;
}

function simulateMatch(home, away, options = {}) {
  const innings1 = generateInnings(home, away, {
    maxOvers: options.maxOvers || 20,
    superOver: options.superOver || false,
    random: options.random,
  });
  const innings2 = generateInnings(away, home, {
    target: innings1.runs + 1,
    maxOvers: options.maxOvers || 20,
    superOver: options.superOver || false,
    random: options.random,
  });
  let winnerId = null;
  let margin = "Match tied";
  if (innings2.runs > innings1.runs) {
    winnerId = away.userId;
    margin = `${10 - innings2.wickets} wicket${10 - innings2.wickets === 1 ? "" : "s"}`;
  } else if (innings1.runs > innings2.runs) {
    winnerId = home.userId;
    margin = `${innings1.runs - innings2.runs} run${innings1.runs - innings2.runs === 1 ? "" : "s"}`;
  }
  return {
    innings: [innings1, innings2],
    winnerId,
    margin,
    tied: winnerId === null,
  };
}

function makeDoubleRoundRobin(teams) {
  // Room users store their primary key as `id`; the match simulator uses
  // `userId`. Accept either shape so fixtures never contain undefined IDs.
  const teamId = (team) => (team ? team.userId || team.id || null : null);
  const n = teams.length;
  const list = [...teams];
  if (n % 2) list.push(null);
  const size = list.length;
  const rounds = [];
  const rotating = [...list];
  for (let round = 0; round < size - 1; round += 1) {
    const games = [];
    for (let i = 0; i < size / 2; i += 1) {
      const a = rotating[i];
      const b = rotating[size - 1 - i];
      if (a && b) {
        const flip = (round + i) % 2 === 1;
        games.push({
          homeId: flip ? teamId(b) : teamId(a),
          awayId: flip ? teamId(a) : teamId(b),
        });
      }
    }
    rounds.push(games);
    const fixed = rotating[0];
    const tail = rotating.slice(1);
    tail.unshift(tail.pop());
    rotating.splice(0, rotating.length, fixed, ...tail);
  }
  // Play the first leg in round order, then reverse home and away for the second.
  const fixtures = [];
  for (let i = 0; i < rounds.length; i += 1) {
    fixtures.push(...rounds[i]);
  }
  fixtures.push(
    ...rounds
      .map((r) => r.map((m) => ({ homeId: m.awayId, awayId: m.homeId })))
      .flat(),
  );
  return fixtures.map((f, index) => ({
    id: `league-${index + 1}`,
    type: "league",
    played: false,
    ...f,
  }));
}

module.exports = {
  fmtOvers,
  generateInnings,
  simulateMatch,
  makeDoubleRoundRobin,
  shuffle,
  rng,
  createSeededRandom,
};
