const crypto = require("crypto");
const { buildBowlingPlan } = require("../shared/bowling-plan.mjs");
const {
  minBowlingOptions,
  maxBowlingOptions,
} = require("../shared/rules.json");

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
    skills: player.skills,
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
    battingIds = battingTeam.lineup,
    selectedBowlerId = null,
    conditions = 0,
  } = options;
  // `lineup` is an ordered list: its first two players open, and later entries
  // come in next when a wicket falls. Never reorder this list inside the engine.
  const battingXI = (Array.isArray(battingIds) ? battingIds : [])
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
    .map((id) => fieldingXI.find((p) => p.id === id))
    .filter(Boolean);
  // Compatibility fallback for old saved/in-memory rooms without a bowling unit.
  if (
    bowlingOrder.length < minBowlingOptions ||
    bowlingOrder.length > maxBowlingOptions ||
    new Set(bowlingOrder.map((p) => p.id)).size !== bowlingOrder.length
  ) {
    bowlingOrder = [...fieldingXI]
      .sort(
        (a, b) =>
          (b.bowling || 0) - (a.bowling || 0) || (b.ovr || 0) - (a.ovr || 0),
      )
      .slice(0, Math.min(5, fieldingXI.length));
  }
  if (superOver) {
    const chosen =
      fieldingXI.find((player) => player.id === selectedBowlerId) ||
      bowlingOrder[0];
    bowlingOrder = chosen ? [chosen] : [];
  }
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
        (sum, player) => sum + (Number(player.fielding) || 65),
        0,
      ) / fieldingXI.length
    : 65;
  const keeper = fieldingXI.find((player) => player.role === "Wicketkeeper");
  const keeping = keeper ? keeper.fielding || 65 : 55;
  const skill = (player, key, fallback) =>
    player.skills?.[key] ?? (Number(player[fallback]) || 65);
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
  let startedOver = -1;
  let overRuns = 0;
  let freeHit = false;
  const plan = superOver
    ? bowlingOrder.map((player) => player.id)
    : buildBowlingPlan(bowlingOrder, {
        overs: overCount,
        tactic: bowlingTactic,
        priorities: bowlingTeam.bowlingPlan,
        random,
      });
  const batterNow = () => batting[strikerIndex] || null;
  const nonStrikerNow = () => batting[nonStrikerIndex] || null;

  const maxWickets = superOver ? 2 : 10;
  while (
    plan &&
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
      startedOver = overNo;
      currentBowlerId = plan[overNo];
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

    const batter = striker.player;
    const hitting = skill(batter, "hitting", "batting");
    const rotation = skill(batter, "rotation", "batting");
    const survival = skill(batter, "survival", "batting");
    const prevention = skill(bowler, "prevention", "bowling");
    const takingWickets = skill(bowler, "wickets", "bowling");
    const control = skill(bowler, "control", "bowling");
    const fieldingEdge = avgFielding - 75;
    const death = superOver || overNo >= 15;
    const powerplay = !superOver && overNo < 6;
    const ballsLeft = overCount * 6 - legalBalls;
    const resources = clamp((maxWickets - wickets - 1) / (death ? 4 : 6), 0, 1);
    const chasePressure =
      target === null
        ? 0
        : clamp(
            (((target - runs) * 6) / ballsLeft - (death ? 10.5 : 8.5)) / 7,
            -0.65,
            0.9,
          );
    const intent = clamp(
      chasePressure * (0.18 + resources * (death ? 0.52 : 0.27)) -
        (!death ? (1 - resources) * 0.65 : 0),
      -0.9,
      0.9,
    );
    const power = hitting - 75 - (prevention - 75) * 0.58;
    const phaseFit =
      (batter.skills?.battingPhase ===
      (death ? "death" : powerplay ? "powerplay" : "middle")
        ? 0.004
        : 0) -
      (bowler.skills?.bowlingPhase ===
      (death ? "death" : powerplay ? "powerplay" : "middle")
        ? 0.004
        : 0);
    let wicketP =
      (death ? 0.086 : powerplay ? 0.042 : 0.044) -
      (survival - 75) * 0.00058 +
      (takingWickets - 75) * 0.00062 +
      fieldingEdge * 0.00012 +
      intent * 0.019 -
      conditions * 0.003;
    let sixP =
      (death ? 0.092 : powerplay ? 0.048 : 0.044) +
      power * 0.00085 +
      phaseFit +
      intent * 0.024 +
      conditions * 0.012 -
      fieldingEdge * 0.0001;
    let fourP =
      (death ? 0.174 : powerplay ? 0.171 : 0.117) +
      power * 0.00067 +
      phaseFit +
      intent * 0.016 +
      conditions * 0.018 -
      fieldingEdge * 0.00016;
    let dotP =
      (death ? 0.235 : powerplay ? 0.316 : 0.261) -
      (rotation - 75) * 0.00105 +
      (prevention - 75) * 0.00052 -
      intent * 0.012 -
      conditions * 0.018 +
      fieldingEdge * 0.00014;
    let oneP =
      (death ? 0.287 : powerplay ? 0.28 : 0.364) +
      (rotation - 75) * 0.0006 -
      intent * 0.023;
    let twoP = (death ? 0.113 : powerplay ? 0.083 : 0.109) - intent * 0.009;
    const threeP = 0.009;
    const wideP = clamp(
      (death ? 0.064 : powerplay ? 0.052 : 0.042) - (control - 75) * 0.00048,
      0.012,
      0.09,
    );
    const noBallP = clamp(0.0045 - (control - 75) * 0.00008, 0.0015, 0.012);
    const byeP = clamp(0.0045 - (keeping - 75) * 0.00014, 0.001, 0.008);
    const legByeP = death ? 0.024 : 0.014;

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
      // A familiar slot gives a small edge alongside the player’s phase strengths.
      const preferredOddsMultiplier = 1.08;
      sixP *= preferredOddsMultiplier;
      fourP *= preferredOddsMultiplier;
      oneP *= preferredOddsMultiplier;
      twoP *= preferredOddsMultiplier;
    }
    const adjustedThreeP = threeP * (preferredBattingSlot ? 1.08 : 1);
    wicketP = clamp(wicketP, 0.022, 0.14);
    sixP = clamp(sixP, 0.012, 0.16);
    fourP = clamp(fourP, 0.055, 0.24);
    dotP = clamp(dotP, 0.12, 0.44);
    oneP = clamp(oneP, 0.18, 0.44);
    twoP = clamp(twoP, 0.07, 0.16);
    const r =
      random() *
      (wicketP +
        sixP +
        fourP +
        dotP +
        oneP +
        twoP +
        adjustedThreeP +
        wideP +
        noBallP +
        byeP +
        legByeP);
    let outcome = "DOT";
    let batterRuns = 0;
    let teamRuns = 0;
    let legal = true;
    let wicket = false;
    let dismissal = "";
    let extraType = null;
    const wasFreeHit = freeHit;

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
      const stumpedChance = keeper && !powerplay ? 0.025 : 0;
      const dismissalRoll = random();
      if (dismissalRoll < caughtChance) dismissal = "caught";
      else if (dismissalRoll < caughtChance + runOutChance)
        dismissal = "run out";
      else if (dismissalRoll < caughtChance + runOutChance + lbwChance)
        dismissal = "lbw";
      else if (
        dismissalRoll <
        caughtChance + runOutChance + lbwChance + stumpedChance
      )
        dismissal = "stumped";
      else dismissal = "bowled";
      if (wasFreeHit && dismissal !== "run out") {
        wicket = false;
        dismissal = "";
      }
      if (wicket) {
        outcome = `WICKET Â· ${dismissal.toUpperCase()}`;
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
    } else {
      const extraRoll =
        r - (wicketP + sixP + fourP + dotP + oneP + twoP + adjustedThreeP);
      extraType =
        extraRoll < wideP
          ? "wide"
          : extraRoll < wideP + noBallP
            ? "noBall"
            : extraRoll < wideP + noBallP + byeP
              ? "bye"
              : "legBye";
      legal = extraType === "bye" || extraType === "legBye";
      const label = {
        wide: "Wide",
        noBall: "No-ball",
        bye: "Bye",
        legBye: "Leg-bye",
      }[extraType];
      teamRuns = 1;
      outcome = `${label.toUpperCase()} · +1`;
    }
    if (extraType === "noBall") freeHit = true;
    else if (legal) freeHit = false;
    const chargedRuns =
      extraType === "bye" || extraType === "legBye" ? 0 : teamRuns;

    if (legal) {
      legalBalls += 1;
      bowlerStats.balls += 1;
      bowlerStats.legalBalls += 1;
    }
    if (extraType !== "wide") striker.balls += 1;
    striker.runs += batterRuns;
    runs += teamRuns;
    bowlerStats.runs += chargedRuns;
    overRuns += chargedRuns;
    bowlerStats.currentOverRuns += chargedRuns;

    // Rotate the strike on odd runs; after the sixth legal ball the ends swap again.
    if (!wicket && legal && teamRuns % 2 === 1) {
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
      extraType,
      extraRuns: teamRuns - batterRuns,
      bowlerRuns: chargedRuns,
      freeHit: wasFreeHit,
      maxBalls: overCount * 6,
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
        playerId: bowlerStats.player.id,
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
        : extraType
          ? `${outcome} to ${battingTeam.teamName}.`
          : outcome === "SIX"
            ? `${striker.player.name} launches it for six.`
            : outcome === "FOUR"
              ? `${striker.player.name} finds the boundary.`
              : teamRuns > 0
                ? `${striker.player.name} takes ${teamRuns} run${teamRuns > 1 ? "s" : ""}.`
                : `${bowler.name} beats the bat.`,
      target,
    };
    if (ballNo === 0 && legal && !superOver) {
      const priority = overNo < 6 ? "powerplay" : overNo >= 15 ? "death" : null;
      if (priority && bowlingTeam.bowlingPlan?.[priority] === bowler.id)
        event.commentary = `${bowler.name} bowls a planned ${priority} over. ${event.commentary}`;
    }
    events.push(event);
  }

  if (
    currentBowlerId &&
    bowlers.get(currentBowlerId) &&
    overRuns === 0 &&
    legalBalls > startedOver * 6 &&
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
    maxBalls: overCount * 6,
    extras: events.reduce((sum, event) => sum + event.extraRuns, 0),
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
  const random = options.random || Math.random;
  // Both sides share the same scoring conditions, including any Super Over.
  const conditions = options.conditions ?? (random() + random() - 1) * 2.2;
  const innings1 = generateInnings(home, away, {
    battingIds: options.homeBatters,
    selectedBowlerId: options.awayBowler,
    maxOvers: options.maxOvers || 20,
    superOver: options.superOver || false,
    random,
    conditions,
  });
  const innings2 = generateInnings(away, home, {
    battingIds: options.awayBatters,
    selectedBowlerId: options.homeBowler,
    target: innings1.runs + 1,
    maxOvers: options.maxOvers || 20,
    superOver: options.superOver || false,
    random,
    conditions,
  });
  let winnerId = null;
  let margin = "Match tied";
  if (innings2.runs > innings1.runs) {
    winnerId = away.userId;
    const wicketsLeft = (options.superOver ? 2 : 10) - innings2.wickets;
    margin = `${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}`;
  } else if (innings1.runs > innings2.runs) {
    winnerId = home.userId;
    margin = `${innings1.runs - innings2.runs} run${innings1.runs - innings2.runs === 1 ? "" : "s"}`;
  }
  return {
    innings: [innings1, innings2],
    conditions,
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
