const crypto = require("crypto");
const zlib = require("node:zlib");
const { shuffle, simulateMatch, createSeededRandom } = require("./cricket");
const rules = require("../shared/rules.json");

const FRANCHISES = rules.franchises;
const DEFAULT_SETTINGS = {
  bidSeconds: 10,
  includeLegends: false,
  showRatings: false,
  startingPurse: 120,
  ballIntervalMs: 95,
  legendAuctionLimit: 6,
  rtmEnabled: false,
  rtmUses: 1,
  rtmPublicStatus: true,
  bidMultipliers: [2, 5, 10],
  tradesEnabled: false,
  tradeLimit: 2,
  recordSeason: false,
};
const MAX_SQUAD = rules.maxSquad;
const MAX_OVERSEAS = rules.maxSquadOverseas;
const MAX_LEGENDS_AUCTION = rules.defaultLegendAuctionLimit;
const MAX_LEGENDS_XI = rules.maxPlayingXILegends;
const AVAILABLE_BID_MULTIPLIERS = Object.freeze(rules.availableBidMultipliers);
// Backwards-compatible alias: MAX_LEGENDS now means the auction purchase cap.
const MAX_LEGENDS = MAX_LEGENDS_AUCTION;
const DEFAULT_TACTICS = Object.freeze(rules.defaultTactics);

const safeInt = (n, fallback, min, max) => {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
};

function getLegendAuctionLimit(settings = {}) {
  const value =
    settings.legendAuctionLimit ?? DEFAULT_SETTINGS.legendAuctionLimit;
  if (value === "unlimited" || value === 0 || value === null) return Infinity;
  const number = Number(value);
  return [4, 5, 6, 7, 8].includes(number)
    ? number
    : DEFAULT_SETTINGS.legendAuctionLimit;
}

function canUserAcquirePlayer(user, player, price, settings = {}) {
  if (!user || !player) return false;
  if ((user.squad || []).length >= MAX_SQUAD) return false;
  if (Number(user.purse) + 1e-6 < Number(price || 0)) return false;
  if (
    player.overseas &&
    (user.squad || []).filter((p) => p.overseas).length >= MAX_OVERSEAS
  )
    return false;
  if (
    player.legend &&
    (user.squad || []).filter((p) => p.legend).length >=
      getLegendAuctionLimit(settings)
  )
    return false;
  return true;
}

function createRoom(code, owner, playerDB) {
  const room = {
    code,
    seasonKey: crypto.randomUUID(),
    createdAt: Date.now(),
    hostId: owner.id,
    recordingOwnerIdentityId: null,
    phase: "lobby",
    settings: { ...DEFAULT_SETTINGS },
    users: [owner],
    ready: false,
    currentLot: null,
    auctionQueue: [],
    setOrder: [...playerDB.setOrder],
    currentSetIndex: 0,
    trades: [],
    tradeOffers: [],
    sold: [],
    unsold: [],
    lotHistory: [],
    auctionPaused: false,
    auctionEndsAt: null,
    auctionRemainingMs: null,
    auctionTimeout: null,
    nextLotTimeout: null,
    tickInterval: null,
    fixtures: [],
    currentMatch: null,
    liveTimeouts: [],
    liveEvents: [],
    liveEventIndex: 0,
    liveResult: null,
    simulationPaused: false,
    standings: [],
    playerStats: {},
    matchResults: [],
    playoff: {
      round: null,
      q1WinnerId: null,
      q1LoserId: null,
      eliminatorWinnerId: null,
      finalists: [],
    },
    championId: null,
    lastNotice: null,
    destroyed: false,
  };
  owner.isHost = true;
  owner.ready = false;
  owner.purse = room.settings.startingPurse;
  owner.squad = [];
  owner.lineup = [];
  owner.bowlerIds = [];
  owner.tactics = { ...DEFAULT_TACTICS };
  owner.xiReady = false;
  owner.rtmUsesUsed = 0;
  owner.tradesUsed = 0;
  owner.connected = true;
  return room;
}

function addUser(room, user) {
  if (room.users.length >= 10)
    return { error: "This room already has 10 players." };
  if (!["lobby", "auction"].includes(room.phase)) {
    return {
      error: "Joining is only open in the lobby or during the auction.",
    };
  }
  if (!FRANCHISES.some((t) => t.id === user.teamId))
    return { error: "Choose a valid IPL franchise." };
  if (room.users.some((u) => u.teamId === user.teamId && u.id !== user.id))
    return { error: "That franchise has already been selected in this room." };
  if (
    room.users.some(
      (u) =>
        u.name.toLowerCase() === user.name.toLowerCase() && u.id !== user.id,
    )
  )
    return { error: "That display name is already in use." };
  user.isHost = false;
  user.ready = false;
  user.purse = room.settings.startingPurse;
  user.squad = [];
  user.lineup = [];
  user.bowlerIds = [];
  user.tactics = { ...DEFAULT_TACTICS };
  user.xiReady = false;
  user.rtmUsesUsed = 0;
  user.tradesUsed = 0;
  user.connected = true;
  user.joinedAt = Date.now();
  room.users.push(user);
  return { user };
}

function assignUser(socket, room, user) {
  socket.data.roomCode = room.code;
  socket.data.userId = user.id;
  // Keep the active socket on the private server-side user object so the RTM
  // holder alone can receive their armed/disarmed state when public visibility is off.
  user.socketId = socket.id;
}

function cleanupTimers(room) {
  if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
  if (room.nextLotTimeout) clearTimeout(room.nextLotTimeout);
  if (room.tickInterval) clearInterval(room.tickInterval);
  room.liveTimeouts.forEach(clearTimeout);
  room.auctionTimeout = null;
  room.nextLotTimeout = null;
  room.tickInterval = null;
  room.liveTimeouts = [];
}

function calculateTeamRatings(squad = []) {
  const topEleven = [...(Array.isArray(squad) ? squad : [])]
    .sort(
      (a, b) =>
        (Number(b.ovr) || 0) - (Number(a.ovr) || 0) ||
        String(a.name || "").localeCompare(String(b.name || "")),
    )
    .slice(0, 11);
  if (topEleven.length < 11) return null;
  const adjustedAverage = (key) => {
    const values = topEleven.map((player) => Number(player[key]) || 0);
    const rawAverage = values.reduce((sum, value) => sum + value, 0) / 11;
    const correctionFactor = values.reduce(
      (sum, value) => sum + Math.max(0, value - rawAverage),
      0,
    );
    return Math.floor(rawAverage + correctionFactor / 11);
  };
  return {
    playersUsed: 11,
    ovr: adjustedAverage("ovr"),
    batting: adjustedAverage("batting"),
    bowling: adjustedAverage("bowling"),
    fielding: adjustedAverage("fielding"),
  };
}

// Pick the strongest possible starting XI while respecting both IPL limits:
// at most four overseas players and at most four legends. Dynamic programming
// avoids a greedy selection that could consume both limits too early.
function findBestLegalXI(squad = []) {
  const players = Array.isArray(squad) ? squad : [];
  const dp = Array.from({ length: 12 }, () =>
    Array.from({ length: 5 }, () => Array(5).fill(null)),
  );
  dp[0][0][0] = { rating: 0, players: [] };

  for (const player of players) {
    const overseasCost = player?.overseas ? 1 : 0;
    const legendCost = player?.legend ? 1 : 0;
    for (let count = 10; count >= 0; count--) {
      for (let overseas = 4; overseas >= 0; overseas--) {
        for (let legends = 4; legends >= 0; legends--) {
          const state = dp[count][overseas][legends];
          if (!state) continue;
          const nextOverseas = overseas + overseasCost;
          const nextLegends = legends + legendCost;
          if (nextOverseas > 4 || nextLegends > MAX_LEGENDS_XI) continue;
          const nextRating = state.rating + (Number(player.ovr) || 0);
          const existing = dp[count + 1][nextOverseas][nextLegends];
          if (!existing || nextRating > existing.rating) {
            dp[count + 1][nextOverseas][nextLegends] = {
              rating: nextRating,
              players: [...state.players, player],
            };
          }
        }
      }
    }
  }

  let best = null;
  for (let overseas = 0; overseas <= 4; overseas++) {
    for (let legends = 0; legends <= MAX_LEGENDS_XI; legends++) {
      const candidate = dp[11][overseas][legends];
      if (candidate && (!best || candidate.rating > best.rating))
        best = candidate;
    }
  }
  return best ? best.players : null;
}

function roomRtmUsesRemaining(user, settings = {}) {
  if (!settings.rtmEnabled) return 0;
  return Math.max(
    0,
    Number(settings.rtmUses || 1) - (Number(user.rtmUsesUsed) || 0),
  );
}

function publicUser(user, settings, includeBowlingRanks = false) {
  const bowlingRank = includeBowlingRanks
    ? new Map(
        [...user.squad]
          .sort(
            (a, b) =>
              (b.bowling || 0) - (a.bowling || 0) ||
              (b.ovr || 0) - (a.ovr || 0) ||
              a.name.localeCompare(b.name),
          )
          .map((player, index) => [player.id, index + 1]),
      )
    : null;
  const squad = user.squad.map((p) => ({
    ...p,
    ...(includeBowlingRanks ? { bowlingRank: bowlingRank.get(p.id) } : {}),
    // Purchased squad ratings are visible in squad panels/previews. The host's
    // showRatings setting still controls ratings on the live auction player card.
  }));
  return {
    id: user.id,
    name: user.name,
    teamId: user.teamId,
    teamName: user.teamName,
    teamShort: user.teamShort,
    teamColor: user.teamColor,
    isHost: user.isHost,
    ready: user.ready,
    connected: user.connected,
    purse: user.purse,
    squad,
    lineup: user.lineup,
    bowlerIds: user.bowlerIds || [],
    tactics: { ...DEFAULT_TACTICS, ...(user.tactics || {}) },
    teamRatings: calculateTeamRatings(user.squad),
    xiReady: user.xiReady,
    rtmUsesUsed: Number(user.rtmUsesUsed) || 0,
    tradesUsed: Number(user.tradesUsed) || 0,
    rtmUsesRemaining: roomRtmUsesRemaining(user, settings),
    overseasCount: user.squad.filter((p) => p.overseas).length,
    legendCount: user.squad.filter((p) => p.legend).length,
    squadCount: user.squad.length,
  };
}

function publicRoom(room, viewerId) {
  const lot = room.currentLot
    ? {
        id: room.currentLot.id,
        player: room.settings.showRatings
          ? room.currentLot.player
          : {
              ...room.currentLot.player,
              ovr: undefined,
              batting: undefined,
              bowling: undefined,
              fielding: undefined,
            },
        set: room.currentLot.set,
        basePrice: room.currentLot.basePrice,
        currentBid: room.currentLot.currentBid,
        currentBidderId: room.currentLot.currentBidderId,
        currentBidderName:
          room.users.find((u) => u.id === room.currentLot.currentBidderId)
            ?.name || null,
        timerRemainingMs: room.auctionPaused
          ? room.auctionRemainingMs
          : Math.max(0, (room.auctionEndsAt || Date.now()) - Date.now()),
        endsAt: room.auctionEndsAt,
        outUserIds: [...(room.currentLot.outUserIds || [])],
        rtmTeamId: room.currentLot.player.rtmTeamId || null,
        rtmHolderUserId: room.currentLot.rtmHolderUserId || null,
        rtmHolderName:
          room.users.find((u) => u.id === room.currentLot.rtmHolderUserId)
            ?.name || null,
        // When activation privacy is enabled, the shared room snapshot never reveals
        // the holder's live toggle state. The holder receives a private socket event.
        rtmIsOn: Boolean(
          room.settings.rtmPublicStatus !== false &&
          room.currentLot.rtmHolderUserId &&
          room.currentLot.rtmOptInUserId === room.currentLot.rtmHolderUserId,
        ),
        rtmUsesRemaining: room.users.find(
          (u) => u.id === room.currentLot.rtmHolderUserId,
        )
          ? roomRtmUsesRemaining(
              room.users.find((u) => u.id === room.currentLot.rtmHolderUserId),
              room.settings,
            )
          : 0,
        lotNumber: room.currentLot.lotNumber,
        totalLots: room.currentLot.totalLots,
      }
    : null;
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    viewerId,
    settings: room.settings,
    users: room.users.map((u) =>
      publicUser(u, room.settings, room.phase === "lineup"),
    ),
    tradeOffers:
      room.phase === "auctionResults"
        ? room.tradeOffers.filter((o) => o.status === "pending")
        : [],
    tradeHistory: room.phase === "auctionResults" ? room.trades.slice(-12) : [],
    franchises: FRANCHISES,
    currentLot: lot,
    currentSet:
      room.currentLot?.set ||
      (room.phase === "auction" ? room.setOrder[room.currentSetIndex] : null),
    currentSetIndex: room.currentSetIndex,
    setOrder: room.setOrder,
    totalLots:
      room.totalLots ||
      room.auctionQueue.length +
        room.lotHistory.length +
        (room.currentLot ? 1 : 0),
    lotsRemaining: room.auctionQueue.length,
    auctionLotsDone: room.lotHistory.length,
    auctionPaused: room.auctionPaused,
    simulationPaused: Boolean(room.simulationPaused),
    sold: room.sold.map((x) => ({
      playerId: x.player.id,
      playerName: x.player.name,
      price: x.price,
      userId: x.userId,
      teamName: x.teamName,
      lotNumber: x.lotNumber,
    })),
    unsold: room.unsold.map((x) => ({
      playerId: x.player.id,
      playerName: x.player.name,
      basePrice: x.basePrice,
      lotNumber: x.lotNumber,
    })),
    lotHistory: room.lotHistory.slice(-18),
    latestLotResult: room.lastNotice,
    // Send a compact fixture index only. Full scorecards are already exposed
    // separately through the bounded matchResults list; serializing each
    // fixture's result here would retransmit every ball event for every match.
    fixtures: room.fixtures.map((f) => ({
      id: f.id,
      type: f.type,
      round: f.round || null,
      played: Boolean(f.played),
      homeId: f.homeId,
      awayId: f.awayId,
      winnerId: f.winnerId || f.result?.winnerId || null,
      margin: f.result?.margin || null,
      tied: Boolean(f.result?.tied),
      result: f.result
        ? {
            id: f.result.id,
            type: f.result.type,
            round: f.result.round || null,
            homeId: f.result.homeId,
            awayId: f.result.awayId,
            winnerId: f.result.winnerId || null,
            margin: f.result.margin || null,
            tied: Boolean(f.result.tied),
            played: Boolean(f.result.played),
            live: Boolean(f.result.live),
          }
        : undefined,
    })),
    currentMatch: room.currentMatch
      ? publicMatch(room.currentMatch, room)
      : null,
    standings: room.standings,
    matchCount: room.matchResults.length,
    totalLeagueMatches: room.fixtures.filter((f) => f.type === "league").length,
    playerLeaders: getLeaders(room),
    matchResults: room.matchResults.slice(-10).map(publicMatchResult),
    playoff: room.playoff,
    championId: room.championId,
    archivedSeasonId: room.archivedSeasonId || null,
    lastNotice: room.lastNotice,
  };
}

function publicMatch(match, room) {
  return {
    id: match.id,
    type: match.type,
    round: match.round,
    homeId: match.homeId,
    awayId: match.awayId,
    home: publicUser(
      room.users.find((u) => u.id === match.homeId),
      room.settings,
    ),
    away: publicUser(
      room.users.find((u) => u.id === match.awayId),
      room.settings,
    ),
    inningsIndex: match.inningsIndex || 0,
    live: Boolean(match.live),
    target: match.target || null,
    liveScore: match.liveScore || null,
    result: match.result ? publicMatchResult(match) : null,
  };
}
function publicMatchResult(match) {
  if (!match) return null;
  if (!match.innings)
    return {
      id: match.id,
      type: match.type,
      round: match.round,
      homeId: match.homeId,
      awayId: match.awayId,
      winnerId: match.winnerId,
      margin: match.margin,
      tied: match.tied,
      simulationSeed: match.simulationSeed,
    };
  return {
    id: match.id,
    type: match.type,
    round: match.round,
    homeId: match.homeId,
    awayId: match.awayId,
    winnerId: match.winnerId,
    margin: match.margin,
    tied: match.tied,
    simulationSeed: match.simulationSeed,
    innings: match.innings.map((inn) => ({
      battingTeamId: inn.battingTeamId,
      battingTeamName: inn.battingTeamName,
      battingUserName: inn.battingUserName,
      bowlingTeamId: inn.bowlingTeamId,
      bowlingTeamName: inn.bowlingTeamName,
      runs: inn.runs,
      wickets: inn.wickets,
      legalBalls: inn.legalBalls,
      overs: inn.overs,
      allOut: inn.allOut,
      nrrOvers: inn.nrrOvers,
      batters: inn.batters.map((b) => ({
        playerId: b.player.id,
        name: b.player.name,
        runs: b.runs,
        balls: b.balls,
        fours: b.fours,
        sixes: b.sixes,
        out: b.out,
        dismissal: b.dismissal,
        strikeRate: b.strikeRate,
      })),
      bowlers: inn.bowlers.map((b) => ({
        playerId: b.player.id,
        name: b.player.name,
        runs: b.runs,
        wickets: b.wickets,
        balls: b.legalBalls,
        overs: b.overs,
        economy: b.economy,
        maidens: b.maidens,
      })),
    })),
  };
}

function basePriceIncrement(price) {
  return rules.bidLadder.find(
    (step) => step.below === null || price < step.below,
  ).increment;
}

// The opening base price is the first bid step; after that, each step advances
// the price ladder. Once a bid exists, every step is an additional increment.
function calculateBidAmount(lot, multiplier = 1) {
  if (!lot) return 0;
  const factor = Number(multiplier);
  if (![1, ...AVAILABLE_BID_MULTIPLIERS].includes(factor))
    throw new RangeError("Unsupported bid multiplier.");
  const current = lot.currentBidderId
    ? Number(lot.currentBid)
    : Number(lot.basePrice);
  // Count true bid-ladder steps. Re-evaluate the increment after each step
  // because the ladder can change at price thresholds (for example ₹1 Cr).
  let bid = current;
  const increments = lot.currentBidderId ? factor : factor - 1;
  for (let step = 0; step < increments; step++) {
    bid = Number((bid + basePriceIncrement(bid)).toFixed(2));
  }
  return bid;
}

function getLeaders(room) {
  const rows = Object.values(room.playerStats).map((s) => ({
    ...s,
    strikeRate: s.balls ? (s.runs * 100) / s.balls : 0,
    economy: s.bowlerBalls ? s.bowlerRuns / (s.bowlerBalls / 6) : 0,
  }));
  const top = (sortFn, take = 5, minBalls = 0) =>
    rows
      .filter((r) => (r.balls || 0) >= minBalls)
      .sort(sortFn)
      .slice(0, take);
  return {
    orangeCap: top((a, b) => b.runs - a.runs || b.sixes - a.sixes),
    purpleCap: top((a, b) => b.wickets - a.wickets || a.economy - b.economy),
    mvp: top((a, b) => b.mvpScore - a.mvpScore),
    mostSixes: top((a, b) => b.sixes - a.sixes),
    mostFours: top((a, b) => b.fours - a.fours),
    bestStrikeRate: top((a, b) => b.strikeRate - a.strikeRate, 5, 12),
    bestEconomy: [...rows]
      .filter((r) => r.bowlerBalls >= 12)
      .sort((a, b) => a.economy - b.economy)
      .slice(0, 5),
    bestFigures: [...rows]
      .filter((r) => r.bowlerBalls >= 6)
      .sort((a, b) => {
        const [aWickets, aRuns] = (a.bestBowling || "0/0")
          .split("/")
          .map(Number);
        const [bWickets, bRuns] = (b.bestBowling || "0/0")
          .split("/")
          .map(Number);
        return bWickets - aWickets || aRuns - bRuns;
      })
      .slice(0, 5),
    mostFifties: top((a, b) => b.fifties - a.fifties),
    mostHundreds: top((a, b) => b.hundreds - a.hundreds),
  };
}

function updatePlayerStats(room, match) {
  for (const inn of match.innings || []) {
    for (const b of inn.batters) {
      const id = b.player.id;
      if (!room.playerStats[id])
        room.playerStats[id] = {
          playerId: id,
          name: b.player.name,
          teamId: inn.battingTeamId,
          teamName: inn.battingTeamName,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          wickets: 0,
          bowlerBalls: 0,
          bowlerRuns: 0,
          fifties: 0,
          hundreds: 0,
          bestBowling: null,
          mvpScore: 0,
        };
      const s = room.playerStats[id];
      s.runs += b.runs;
      s.balls += b.balls;
      s.fours += b.fours;
      s.sixes += b.sixes;
      if (b.runs >= 100) s.hundreds += 1;
      else if (b.runs >= 50) s.fifties += 1;
      s.mvpScore =
        s.runs +
        25 * s.wickets +
        3 * s.sixes +
        s.fours +
        s.fifties * 10 +
        s.hundreds * 25;
    }
    for (const bw of inn.bowlers) {
      const id = bw.player.id;
      if (!room.playerStats[id])
        room.playerStats[id] = {
          playerId: id,
          name: bw.player.name,
          teamId: inn.bowlingTeamId,
          teamName: inn.bowlingTeamName,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          wickets: 0,
          bowlerBalls: 0,
          bowlerRuns: 0,
          fifties: 0,
          hundreds: 0,
          bestBowling: null,
          mvpScore: 0,
        };
      const s = room.playerStats[id];
      s.wickets += bw.wickets;
      s.bowlerBalls += bw.legalBalls;
      s.bowlerRuns += bw.runs;
      const [oldW, oldR] = (s.bestBowling || "0/0").split("/").map(Number);
      if (
        bw.legalBalls > 0 &&
        (!s.bestBowling ||
          bw.wickets > oldW ||
          (bw.wickets === oldW && bw.runs < oldR))
      )
        s.bestBowling = `${bw.wickets}/${bw.runs}`;
      s.mvpScore =
        s.runs +
        25 * s.wickets +
        3 * s.sixes +
        s.fours +
        s.fifties * 10 +
        s.hundreds * 25;
    }
  }
}

function calculateStandings(room) {
  const teams = room.users.map((u) => ({
    userId: u.id,
    teamId: u.teamId,
    teamName: u.teamName,
    teamShort: u.teamShort,
    userName: u.name,
    played: 0,
    won: 0,
    lost: 0,
    tied: 0,
    points: 0,
    runsFor: 0,
    runsAgainst: 0,
    oversFor: 0,
    oversAgainst: 0,
    nrr: 0,
  }));
  const byId = new Map(teams.map((t) => [t.userId, t]));
  for (const match of room.matchResults) {
    if (match.type !== "league" || !match.innings || match.innings.length < 2)
      continue;
    const home = byId.get(match.homeId);
    const away = byId.get(match.awayId);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    const inn1 = match.innings[0];
    const inn2 = match.innings[1];
    const t1 = byId.get(inn1.battingTeamId);
    const t2 = byId.get(inn2.battingTeamId);
    t1.runsFor += inn1.runs;
    t1.oversFor += inn1.nrrOvers;
    t1.runsAgainst += inn2.runs;
    t1.oversAgainst += inn2.nrrOvers;
    t2.runsFor += inn2.runs;
    t2.oversFor += inn2.nrrOvers;
    t2.runsAgainst += inn1.runs;
    t2.oversAgainst += inn1.nrrOvers;
    if (match.tied || !match.winnerId) {
      home.tied += 1;
      away.tied += 1;
      home.points += 1;
      away.points += 1;
    } else {
      const winner = byId.get(match.winnerId);
      const loser = match.winnerId === home.userId ? away : home;
      winner.won += 1;
      winner.points += 2;
      loser.lost += 1;
    }
  }
  for (const t of teams)
    t.nrr =
      (t.oversFor > 0 ? t.runsFor / t.oversFor : 0) -
      (t.oversAgainst > 0 ? t.runsAgainst / t.oversAgainst : 0);
  teams.sort(
    (a, b) =>
      b.points - a.points ||
      b.won - a.won ||
      b.nrr - a.nrr ||
      b.runsFor - a.runsFor,
  );
  return teams.map((t, i) => ({
    ...t,
    position: i + 1,
    nrr: Number(t.nrr.toFixed(3)),
  }));
}

function makePlayerSquadView(user) {
  return {
    batters: user.squad.filter((p) => p.role === "Batter"),
    wicketkeepers: user.squad.filter((p) => p.role === "Wicketkeeper"),
    allRounders: user.squad.filter((p) => p.role === "All-rounder"),
    bowlers: user.squad.filter((p) => p.role === "Bowler"),
  };
}

function startAuction(io, room, playerDB) {
  if (room.phase !== "lobby")
    return { error: "The auction has already been started." };
  if (room.users.length < 2)
    return {
      error: "At least two players must join before the auction starts.",
    };
  if (room.users.some((u) => !u.ready))
    return { error: "Everyone must be ready before the auction starts." };
  room.phase = "auction";
  room.currentSetIndex = 0;
  room.sold = [];
  room.unsold = [];
  room.lotHistory = [];
  for (const u of room.users) {
    u.purse = room.settings.startingPurse;
    u.squad = [];
    u.lineup = [];
    u.bowlerIds = [];
    u.tactics = { ...DEFAULT_TACTICS };
    u.xiReady = false;
    u.rtmUsesUsed = 0;
  }
  const bySet = new Map();
  for (const s of room.setOrder) bySet.set(s, []);
  for (const p of playerDB.players) {
    if (!room.settings.includeLegends && p.legend) continue;
    if (!bySet.has(p.set)) bySet.set(p.set, []);
    bySet.get(p.set).push(p);
  }
  room.auctionQueue = room.setOrder.flatMap((s) => shuffle(bySet.get(s) || []));
  room.totalLots = room.auctionQueue.length;
  room.nextLotNumber = 0;
  openNextLot(io, room);
  return { ok: true };
}

function allTeamsAtLegendLimit(room) {
  const limit = getLegendAuctionLimit(room.settings);
  return (
    Number.isFinite(limit) &&
    Array.isArray(room.users) &&
    room.users.length > 0 &&
    room.users.every(
      (user) =>
        (Array.isArray(user.squad) ? user.squad : []).filter(
          (player) => player && player.legend,
        ).length >= limit,
    )
  );
}

function skipLegendLotsWhenFull(room) {
  if (
    !allTeamsAtLegendLimit(room) ||
    !Array.isArray(room.auctionQueue) ||
    !room.auctionQueue.length
  )
    return 0;

  const queueLengthBefore = room.auctionQueue.length;
  room.auctionQueue = room.auctionQueue.filter((player) => !player?.legend);
  const skippedCount = queueLengthBefore - room.auctionQueue.length;

  if (skippedCount > 0) {
    const recordedLots = Array.isArray(room.lotHistory)
      ? room.lotHistory.length
      : 0;
    const existingTotal = Number.isFinite(Number(room.totalLots))
      ? Number(room.totalLots)
      : recordedLots + queueLengthBefore + (room.currentLot ? 1 : 0);
    const minimumTotal =
      recordedLots + room.auctionQueue.length + (room.currentLot ? 1 : 0);
    // Keep auction progress consistent with lots that can still actually be auctioned.
    room.totalLots = Math.max(minimumTotal, existingTotal - skippedCount);
  }

  return skippedCount;
}

function refreshCurrentLotRtmHolder(room) {
  const lot = room?.currentLot;
  if (!lot) return null;
  if (!room.settings?.rtmEnabled || !lot.player?.rtmTeamId) {
    lot.rtmHolderUserId = null;
    lot.rtmOptInUserId = null;
    return null;
  }
  const holder = room.users.find(
    (user) =>
      user.teamId === lot.player.rtmTeamId &&
      roomRtmUsesRemaining(user, room.settings) > 0 &&
      canUserAcquirePlayer(
        user,
        lot.player,
        lot.currentBid || lot.basePrice,
        room.settings,
      ),
  );
  const nextHolderId = holder?.id || null;
  if (lot.rtmHolderUserId !== nextHolderId) lot.rtmOptInUserId = null;
  lot.rtmHolderUserId = nextHolderId;
  return holder || null;
}

function openNextLot(io, room) {
  if (
    room.destroyed ||
    room.phase !== "auction" ||
    room.auctionPaused ||
    room.currentLot
  )
    return;
  if (room.nextLotTimeout) clearTimeout(room.nextLotTimeout);
  room.nextLotTimeout = null;

  // Once every remaining team has reached the host-configured auction legend limit, remove
  // remaining legends from the queue before selecting a lot. This also handles re-auctioned
  // unsold players, since they are placed back into the same queue.
  const skippedLegendCount = skipLegendLotsWhenFull(room);

  if (!room.auctionQueue.length) {
    room.currentLot = null;
    room.phase = "auctionResults";
    room.lastNotice = {
      kind: "auctionComplete",
      text:
        skippedLegendCount > 0
          ? `The auction is complete. ${skippedLegendCount} remaining legend lot${skippedLegendCount === 1 ? " was" : "s were"} skipped because every team reached the ${getLegendAuctionLimit(room.settings)}-legend purchase limit.`
          : "The auction is complete.",
    };
    broadcast(io, room);
    return;
  }
  const player = room.auctionQueue.shift();
  const lotNumber = room.lotHistory.length + 1;
  room.currentSetIndex = Math.max(0, room.setOrder.indexOf(player.set));
  room.currentLot = {
    id: crypto.randomUUID(),
    player,
    set: player.set,
    basePrice: player.basePrice,
    currentBid: player.basePrice,
    currentBidderId: null,
    outUserIds: [],
    lotNumber,
    totalLots: room.totalLots,
    rtmHolderUserId: null,
    rtmOptInUserId: null,
  };
  refreshCurrentLotRtmHolder(room);
  room.auctionEndsAt = Date.now() + room.settings.bidSeconds * 1000;
  room.auctionRemainingMs = room.settings.bidSeconds * 1000;
  room.lastNotice =
    skippedLegendCount > 0
      ? {
          kind: "legendLotsSkipped",
          text: `Skipped ${skippedLegendCount} remaining legend lot${skippedLegendCount === 1 ? "" : "s"} because every team has filled all ${getLegendAuctionLimit(room.settings)} legend purchase slots.`,
        }
      : null;
  room.auctionTimeout = setTimeout(
    () => settleLot(io, room, false),
    room.settings.bidSeconds * 1000,
  );
  broadcast(io, room);
}

function hasEligibleNextBidder(room, lot, highestBidder) {
  if (!room || !lot || !highestBidder) return false;
  const nextBid = calculateBidAmount(lot, 1);
  return room.users.some((candidate) => {
    if (!candidate || candidate.id === highestBidder.id) return false;
    if ((lot.outUserIds || []).includes(candidate.id)) return false;
    return canUserAcquirePlayer(candidate, lot.player, nextBid, room.settings);
  });
}

function canRtmHolderStillChangeDecision(room, lot, highestBidder) {
  if (!room?.settings?.rtmEnabled || !lot?.rtmHolderUserId) return false;
  const holder = room.users.find(
    (candidate) => candidate.id === lot.rtmHolderUserId,
  );
  if (!holder || holder.id === highestBidder?.id) return false;
  if ((lot.outUserIds || []).includes(holder.id)) return false;
  if (holder.teamId !== lot.player.rtmTeamId) return false;
  // An eligible holder keeps the bid window even during a brief disconnect,
  // giving them a chance to reconnect before the authoritative deadline.
  return (
    roomRtmUsesRemaining(holder, room.settings) > 0 &&
    canUserAcquirePlayer(holder, lot.player, lot.currentBid, room.settings)
  );
}

function shouldFastSettleLot(room) {
  if (
    !room ||
    room.phase !== "auction" ||
    room.auctionPaused ||
    !room.currentLot?.currentBidderId
  )
    return false;
  const lot = room.currentLot;
  const highestBidder = room.users.find(
    (candidate) => candidate.id === lot.currentBidderId,
  );
  if (!highestBidder) return false;
  if (hasEligibleNextBidder(room, lot, highestBidder)) return false;
  if (canRtmHolderStillChangeDecision(room, lot, highestBidder)) return false;
  return true;
}

function settleLot(io, room, forced = false, fastClosed = false) {
  if (!room.currentLot || room.phase !== "auction") return;
  if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
  if (room.nextLotTimeout) clearTimeout(room.nextLotTimeout);
  if (room.tickInterval) clearInterval(room.tickInterval);
  room.auctionTimeout = null;
  room.nextLotTimeout = null;
  room.tickInterval = null;
  const lot = room.currentLot;
  let sold = false;
  let exercisedRtm = false;
  const highestBidder = lot.currentBidderId
    ? room.users.find((u) => u.id === lot.currentBidderId)
    : null;
  let winner = highestBidder;
  const rtmHolder =
    lot.rtmOptInUserId &&
    lot.rtmOptInUserId === lot.rtmHolderUserId &&
    !(lot.outUserIds || []).includes(lot.rtmOptInUserId)
      ? room.users.find((u) => u.id === lot.rtmHolderUserId)
      : null;
  if (
    highestBidder &&
    rtmHolder &&
    rtmHolder.id !== highestBidder.id &&
    room.settings.rtmEnabled &&
    roomRtmUsesRemaining(rtmHolder, room.settings) > 0 &&
    rtmHolder.teamId === lot.player.rtmTeamId &&
    canUserAcquirePlayer(rtmHolder, lot.player, lot.currentBid, room.settings)
  ) {
    winner = rtmHolder;
    exercisedRtm = true;
  }
  if (
    winner &&
    canUserAcquirePlayer(winner, lot.player, lot.currentBid, room.settings)
  ) {
    winner.purse = Number((winner.purse - lot.currentBid).toFixed(2));
    winner.squad.push({ ...lot.player, purchasePrice: lot.currentBid });
    if (exercisedRtm)
      winner.rtmUsesUsed = (Number(winner.rtmUsesUsed) || 0) + 1;
    room.sold.push({
      player: lot.player,
      price: lot.currentBid,
      userId: winner.id,
      teamName: winner.teamName,
      lotNumber: lot.lotNumber,
      rtm: exercisedRtm,
      originalBidderId: highestBidder?.id || null,
    });
    sold = true;
    if (exercisedRtm) {
      room.lastNotice = {
        kind: "rtm",
        playerName: lot.player.name,
        teamName: winner.teamName,
        price: lot.currentBid,
        text: `${winner.teamName} activated Right to Match for ${lot.player.name} at ₹${lot.currentBid.toFixed(2)} Cr and acquired the player.${fastClosed ? " The lot closed early because no other team could submit a valid bid." : ""}`,
      };
    } else {
      room.lastNotice = {
        kind: "sold",
        text: `${lot.player.name} SOLD to ${winner.teamName} for ₹${lot.currentBid.toFixed(2)} Cr${fastClosed ? " — no other team could submit a valid bid, so the lot closed early." : ""}`,
        playerName: lot.player.name,
        teamName: winner.teamName,
        price: lot.currentBid,
      };
    }
  }
  if (!sold) {
    room.unsold.push({
      player: lot.player,
      basePrice: lot.basePrice,
      lotNumber: lot.lotNumber,
    });
    room.lastNotice = {
      kind: "unsold",
      text: `${lot.player.name} goes UNSOLD`,
      playerName: lot.player.name,
    };
  }
  room.lotHistory.push({
    lotNumber: lot.lotNumber,
    playerId: lot.player.id,
    playerName: lot.player.name,
    set: lot.set,
    result: sold ? (exercisedRtm ? "RTM" : "SOLD") : "UNSOLD",
    teamName: sold ? winner.teamName : null,
    price: sold ? lot.currentBid : null,
    rtm: exercisedRtm,
  });
  room.currentLot = null;
  room.auctionEndsAt = null;
  room.auctionRemainingMs = null;
  broadcast(io, room);
  if (forced) return;
  room.nextLotTimeout = setTimeout(() => openNextLot(io, room), 1250);
}

function updateStandingsAndStats(room, match) {
  // Retain compact delivery records for an optional season archive, then release
  // the much larger transient event arrays used by live playback.
  const compress = (innings) =>
    innings.events
      ? zlib.deflateSync(JSON.stringify(innings.events)).toString("base64")
      : null;
  match.ballByBall = {
    encoding: "deflate-base64",
    innings: (match.innings || []).map(compress),
    superOver: (match.superOver || []).map(compress),
  };
  for (const innings of match.innings || []) delete innings.events;
  for (const innings of match.superOver || []) delete innings.events;
  room.matchResults.push(match);
  updatePlayerStats(room, match);
  room.standings = calculateStandings(room);
  const fixture = room.fixtures.find((f) => f.id === match.id);
  if (fixture) {
    fixture.played = true;
    fixture.result = match;
    fixture.winnerId = match.winnerId;
  }
}

function createLiveEvents(
  home,
  away,
  seed = crypto.randomBytes(4).readUInt32LE(0),
) {
  const random = createSeededRandom(seed);
  const result = simulateMatch(home, away, { random });
  result.simulationSeed = seed;
  const events = [];
  result.innings.forEach((inn, idx) => {
    events.push({
      type: "inningsStart",
      inningsIndex: idx,
      teamId: inn.battingTeamId,
      teamName: inn.battingTeamName,
      target: inn.target,
    });
    inn.events.forEach((ball) =>
      events.push({
        type: "ball",
        inningsIndex: idx,
        battingTeamId: inn.battingTeamId,
        battingTeamName: inn.battingTeamName,
        bowlingTeamId: inn.bowlingTeamId,
        bowlingTeamName: inn.bowlingTeamName,
        ...ball,
      }),
    );
    events.push({
      type: "inningsEnd",
      inningsIndex: idx,
      teamId: inn.battingTeamId,
      teamName: inn.battingTeamName,
      runs: inn.runs,
      wickets: inn.wickets,
      overs: inn.overs,
      target: inn.target,
    });
  });
  if (result.tied) {
    // A tied match gets a one-over eliminator with the same player ratings and bowling constraints.
    const first = simulateMatch(home, away, {
      maxOvers: 1,
      superOver: true,
      random,
    });
    result.superOver = first.innings;
    const superEvents = [];
    first.innings.forEach((inn, idx) => {
      superEvents.push({
        type: "inningsStart",
        inningsIndex: idx + 2,
        teamId: inn.battingTeamId,
        teamName: inn.battingTeamName,
        target: inn.target,
        superOver: true,
      });
      inn.events.forEach((ball) =>
        superEvents.push({
          type: "ball",
          inningsIndex: idx + 2,
          superOver: true,
          battingTeamId: inn.battingTeamId,
          battingTeamName: inn.battingTeamName,
          bowlingTeamId: inn.bowlingTeamId,
          bowlingTeamName: inn.bowlingTeamName,
          ...ball,
        }),
      );
      superEvents.push({
        type: "inningsEnd",
        inningsIndex: idx + 2,
        teamId: inn.battingTeamId,
        teamName: inn.battingTeamName,
        runs: inn.runs,
        wickets: inn.wickets,
        overs: inn.overs,
        target: inn.target,
        superOver: true,
      });
    });
    events.push({ type: "superOverStart" }, ...superEvents, {
      type: "superOverEnd",
      innings: first.innings.map((i) => ({
        battingTeamId: i.battingTeamId,
        runs: i.runs,
        wickets: i.wickets,
      })),
    });
    if (!first.tied) {
      result.winnerId = first.winnerId;
      result.margin = `Super over (${first.innings[0].runs}–${first.innings[1].runs})`;
      result.tied = false;
      result.superOver = first.innings;
    } else {
      // Extremely rare second tie: decide with an attribute-weighted random draw, keep tied scoring recorded.
      const homePower = home.lineup.reduce(
        (s, id) => s + (home.squad.find((p) => p.id === id)?.ovr || 60),
        0,
      );
      const awayPower = away.lineup.reduce(
        (s, id) => s + (away.squad.find((p) => p.id === id)?.ovr || 60),
        0,
      );
      result.winnerId =
        random() * (homePower + awayPower) < homePower
          ? home.userId
          : away.userId;
      result.margin = "Super over";
      result.tied = false;
    }
  }
  return { result, events };
}

function startLiveMatch(io, room, match) {
  if (!room.fixtures.some((f) => f.id === match.id))
    room.fixtures.push({ ...match, played: false });
  const storedHome = room.users.find((u) => u.id === match.homeId);
  const storedAway = room.users.find((u) => u.id === match.awayId);
  if (!storedHome || !storedAway) {
    // Never fail silently into the endless “Preparing the next match” screen.
    room.currentMatch = null;
    room.lastNotice = {
      kind: "simulationError",
      text: `Could not start ${match.round || "the match"}: a team ID does not match any player in this room. Restart the room after updating the game files.`,
    };
    broadcast(io, room);
    return;
  }
  // Cricket simulation routines use `userId`; room/lobby records use `id`.
  // Add the alias to simulation-only copies so event and winner IDs stay valid.
  const home = { ...storedHome, userId: storedHome.id };
  const away = { ...storedAway, userId: storedAway.id };
  const built = createLiveEvents(home, away);
  room.currentMatch = {
    ...match,
    live: true,
    inningsIndex: 0,
    target: null,
    liveScore: null,
  };
  room.simulationPaused = false;
  room.liveResult = built.result;
  room.liveEvents = built.events;
  room.liveEventIndex = 0;
  room.liveTimeouts.forEach(clearTimeout);
  room.liveTimeouts = [];
  broadcast(io, room);
  io.to(room.code).emit("simulation:matchStart", {
    match: {
      id: match.id,
      type: match.type,
      round: match.round,
      home: publicUser(storedHome, room.settings),
      away: publicUser(storedAway, room.settings),
    },
  });
  playNextEvent(io, room);
}

function playNextEvent(io, room) {
  if (
    !room.currentMatch ||
    !room.liveResult ||
    room.simulationPaused ||
    room.phase === "complete"
  )
    return;
  const event = room.liveEvents[room.liveEventIndex];
  if (!event) {
    finishLiveMatch(io, room);
    return;
  }
  room.liveEventIndex += 1;
  if (event.type === "inningsStart") {
    room.currentMatch.inningsIndex = event.inningsIndex;
    room.currentMatch.target = event.target;
    room.currentMatch.liveScore = {
      runs: 0,
      wickets: 0,
      balls: 0,
      overs: "0.0",
      inningsIndex: event.inningsIndex,
      battingTeamId: event.teamId,
      battingTeamName: event.teamName,
      target: event.target,
      superOver: Boolean(event.superOver),
    };
    io.to(room.code).emit("simulation:inningsStart", event);
    broadcast(io, room, false);
    const timer = setTimeout(
      () => playNextEvent(io, room),
      event.inningsIndex === 0 ? 500 : 1350,
    );
    room.liveTimeouts.push(timer);
    return;
  }
  if (event.type === "inningsEnd") {
    io.to(room.code).emit("simulation:inningsEnd", event);
    const timer = setTimeout(() => playNextEvent(io, room), 350);
    room.liveTimeouts.push(timer);
    return;
  }
  if (event.type === "superOverStart" || event.type === "superOverEnd") {
    io.to(room.code).emit(`simulation:${event.type}`, event);
    const timer = setTimeout(() => playNextEvent(io, room), 300);
    room.liveTimeouts.push(timer);
    return;
  }
  if (event.type === "ball") {
    room.currentMatch.inningsIndex = event.inningsIndex;
    room.currentMatch.target = event.target || room.currentMatch.target;
    room.currentMatch.liveScore = {
      runs: event.score,
      wickets: event.wickets,
      balls: event.balls,
      overs: event.overs,
      inningsIndex: event.inningsIndex,
      battingTeamId: event.battingTeamId,
      battingTeamName: event.battingTeamName,
      target: event.target || room.currentMatch.target,
      superOver: Boolean(event.superOver),
      batter1: event.batter1,
      batter2: event.batter2,
      bowler: event.bowler,
      outcome: event.outcome,
      commentary: event.commentary,
    };
    if (room.liveEventIndex % 20 === 0) room.saveCheckpoint?.(room);
    io.to(room.code).emit("simulation:ball", event);
    if (event.wicket) {
      const timer = setTimeout(() => playNextEvent(io, room), 520);
      room.liveTimeouts.push(timer);
    } else {
      const speed = room.settings.ballIntervalMs;
      const timer = setTimeout(() => playNextEvent(io, room), speed);
      room.liveTimeouts.push(timer);
    }
    return;
  }
  playNextEvent(io, room);
}

function finishLeaguePhase(io, room) {
  room.currentMatch = null;
  room.standings = calculateStandings(room);

  // Rooms with fewer than four teams are useful for local testing, but cannot
  // run the standard four-team playoff bracket. In that case, finish on the
  // league table and declare its top team champion.
  if (room.users.length < 4) {
    room.phase = "complete";
    room.completedAt = Date.now();
    room.championId = room.standings[0]?.userId || null;
    const champion = room.users.find((u) => u.id === room.championId);
    room.lastNotice = {
      kind: "champion",
      winnerId: room.championId,
      text: champion
        ? `${champion.teamName} wins the league-only season!`
        : "The league-only season is complete.",
    };
    broadcast(io, room);
    if (champion) {
      io.to(room.code).emit("simulation:champion", {
        winnerId: champion.id,
        name: champion.teamName,
      });
    }
    return;
  }

  room.phase = "leagueComplete";
  room.lastNotice = {
    kind: "leagueComplete",
    text: "League phase complete. Playoffs are ready.",
  };
  broadcast(io, room);
}

function advanceAfterMatch(io, room, match) {
  room.currentMatch = null;
  if (room.phase === "league") {
    const remaining = room.fixtures.find(
      (f) => f.type === "league" && !f.played,
    );
    if (remaining) startLiveMatch(io, room, remaining);
    else finishLeaguePhase(io, room);
  } else if (room.phase === "playoffs") {
    advancePlayoffs(io, room, match);
  } else if (room.phase === "final") {
    room.phase = "complete";
    room.completedAt = Date.now();
    room.championId = match.winnerId;
    room.lastNotice = {
      kind: "champion",
      winnerId: match.winnerId,
      text: `${room.users.find((u) => u.id === match.winnerId)?.teamName || "Champion"} wins the IPL Auction League!`,
    };
    broadcast(io, room);
    io.to(room.code).emit("simulation:champion", {
      winnerId: room.championId,
      name: room.users.find((u) => u.id === room.championId)?.teamName,
    });
  }
}

function finishLiveMatch(io, room, delay = 1700) {
  if (!room.currentMatch || !room.liveResult) return;
  room.liveTimeouts.forEach(clearTimeout);
  room.liveTimeouts = [];
  const result = room.liveResult;
  const match = { ...room.currentMatch, ...result, played: true, live: false };
  delete match.liveScore;
  delete match.inningsIndex;
  delete match.target;
  updateStandingsAndStats(room, match);
  room.currentMatch = { ...match, live: false };
  room.lastNotice = {
    kind: "matchEnd",
    winnerId: result.winnerId,
    margin: result.margin,
    tied: result.tied,
  };
  io.to(room.code).emit("simulation:matchEnd", publicMatchResult(match));
  room.liveResult = null;
  room.liveEvents = [];
  room.liveEventIndex = 0;
  broadcast(io, room);
  const timer = setTimeout(() => advanceAfterMatch(io, room, match), delay);
  room.liveTimeouts.push(timer);
}

function resumeSimulation(io, room) {
  if (
    !room.simulationPaused ||
    !["league", "playoffs", "final"].includes(room.phase)
  )
    return false;
  room.simulationPaused = false;
  room.lastNotice = {
    kind: "resume",
    text: "The tournament simulation resumed.",
  };
  broadcast(io, room);
  if (room.currentMatch && room.liveResult) playNextEvent(io, room);
  else if (room.currentMatch) advanceAfterMatch(io, room, room.currentMatch);
  else if (room.phase === "league") {
    const remaining = room.fixtures.find(
      (fixture) => fixture.type === "league" && !fixture.played,
    );
    if (remaining) startLiveMatch(io, room, remaining);
    else finishLeaguePhase(io, room);
  } else if (room.phase === "final") {
    const [homeId, awayId] = room.playoff.finalists || [];
    if (homeId && awayId) {
      startLiveMatch(io, room, {
        id: "final",
        type: "final",
        round: "Final",
        homeId,
        awayId,
        played: false,
      });
    } else {
      room.simulationPaused = true;
      broadcast(io, room);
      return false;
    }
  } else if (room.phase === "playoffs") {
    const round = room.playoff.round;
    const fixture =
      round === "Qualifier 1"
        ? {
            id: "playoff-q1",
            homeId: room.standings[0]?.userId,
            awayId: room.standings[1]?.userId,
          }
        : round === "Eliminator"
          ? {
              id: "playoff-eliminator",
              homeId: room.standings[2]?.userId,
              awayId: room.standings[3]?.userId,
            }
          : round === "Qualifier 2"
            ? {
                id: "playoff-q2",
                homeId: room.playoff.q1LoserId,
                awayId: room.playoff.eliminatorWinnerId,
              }
            : null;
    if (!fixture?.homeId || !fixture.awayId) {
      room.simulationPaused = true;
      broadcast(io, room);
      return false;
    }
    startLiveMatch(io, room, {
      ...fixture,
      type: "playoff",
      round,
      played: false,
    });
  }
  return true;
}

function advancePlayoffs(io, room, match) {
  const round = match.round || room.playoff.round;
  if (round === "Qualifier 1") {
    room.playoff.q1WinnerId = match.winnerId;
    room.playoff.q1LoserId =
      match.homeId === match.winnerId ? match.awayId : match.homeId;
    room.playoff.round = "Eliminator";
    const third = room.standings[2]?.userId;
    const fourth = room.standings[3]?.userId;
    startLiveMatch(io, room, {
      id: "playoff-eliminator",
      type: "playoff",
      round: "Eliminator",
      homeId: third,
      awayId: fourth,
      played: false,
    });
  } else if (round === "Eliminator") {
    room.playoff.eliminatorWinnerId = match.winnerId;
    room.playoff.round = "Qualifier 2";
    startLiveMatch(io, room, {
      id: "playoff-q2",
      type: "playoff",
      round: "Qualifier 2",
      homeId: room.playoff.q1LoserId,
      awayId: room.playoff.eliminatorWinnerId,
      played: false,
    });
  } else if (round === "Qualifier 2") {
    room.playoff.finalists = [room.playoff.q1WinnerId, match.winnerId];
    room.phase = "finalReady";
    room.playoff.round = "Finalists confirmed";
    room.currentMatch = null;
    room.lastNotice = {
      kind: "finalists",
      text: "The finalists are confirmed.",
    };
    broadcast(io, room);
  }
}

function startPlayoffs(io, room) {
  if (room.phase !== "leagueComplete")
    return { error: "Finish the league phase first." };
  if (room.standings.length < 4)
    return { error: "At least four teams are required for playoffs." };
  const top4 = room.standings.slice(0, 4);
  room.phase = "playoffs";
  room.playoff = {
    round: "Qualifier 1",
    q1WinnerId: null,
    q1LoserId: null,
    eliminatorWinnerId: null,
    finalists: [],
  };
  startLiveMatch(io, room, {
    id: "playoff-q1",
    type: "playoff",
    round: "Qualifier 1",
    homeId: top4[0].userId,
    awayId: top4[1].userId,
    played: false,
  });
  return { ok: true };
}

function privateState(room, user) {
  const lot = room.currentLot;
  const isRtmHolder = Boolean(
    lot?.rtmHolderUserId && lot.rtmHolderUserId === user.id,
  );
  return {
    rtmPlayerId: lot?.player?.id || null,
    isRtmHolder,
    rtmIsOn: Boolean(isRtmHolder && lot.rtmOptInUserId === user.id),
    ownSquadOvrs: room.settings.showRatings
      ? null
      : Object.fromEntries(
          (user.squad || []).map((player) => [
            player.id,
            Number(player.ovr) || 0,
          ]),
        ),
  };
}

function sendSnapshot(socket, room, user) {
  socket.emit("room:update", {
    ...publicRoom(room, null),
    version: room.publicVersion || 0,
  });
  if (user) socket.emit("room:privateState", privateState(room, user));
}

function broadcast(io, room, announce = true, syncPrivateState = announce) {
  if (
    room.phase === "complete" &&
    room.settings.recordSeason &&
    !room.archivedSeasonId
  )
    room.recordCompletedSeason?.();
  const snapshot = publicRoom(room, null);
  const previousVersion = room.publicVersion || 0;
  const nextVersion = previousVersion + 1;
  const previousFields = room.publicFieldVersions;
  const fields = {};
  const changes = {};
  for (const [key, value] of Object.entries(snapshot)) {
    fields[key] = JSON.stringify(value);
    if (!previousFields || fields[key] !== previousFields[key])
      changes[key] = value;
  }
  room.publicVersion = nextVersion;
  room.publicFieldVersions = fields;
  const checkpointSaved = room.saveCheckpoint?.(room);
  if (checkpointSaved === false && !room.checkpointWarning) {
    room.checkpointWarning = true;
    io.to(room.code).emit("app:error", {
      message:
        "The local checkpoint could not be saved. Play can continue, but restart recovery may be incomplete.",
    });
  } else if (checkpointSaved === true) {
    room.checkpointWarning = false;
  }
  if (!previousFields)
    io.to(room.code).emit("room:update", { ...snapshot, version: nextVersion });
  else
    io.to(room.code).emit("room:patch", {
      previousVersion,
      version: nextVersion,
      changes,
    });

  if (syncPrivateState) {
    for (const user of room.users) {
      if (!user.socketId) continue;
      io.to(user.socketId).emit("room:privateState", privateState(room, user));
    }
  }

  if (announce && room.lastNotice)
    io.to(room.code).emit("room:notice", room.lastNotice);
}

function hostCheck(room, userId) {
  return room.hostId === userId;
}

module.exports = {
  FRANCHISES,
  DEFAULT_SETTINGS,
  MAX_SQUAD,
  MAX_OVERSEAS,
  MAX_LEGENDS_AUCTION,
  MAX_LEGENDS_XI,
  MAX_LEGENDS,
  DEFAULT_TACTICS,
  calculateTeamRatings,
  findBestLegalXI,
  createRoom,
  addUser,
  assignUser,
  cleanupTimers,
  publicRoom,
  publicUser,
  basePriceIncrement,
  calculateBidAmount,
  getLeaders,
  calculateStandings,
  makePlayerSquadView,
  startAuction,
  openNextLot,
  settleLot,
  broadcast,
  sendSnapshot,
  hostCheck,
  createLiveEvents,
  startLiveMatch,
  finishLiveMatch,
  resumeSimulation,
  startPlayoffs,
  finishLeaguePhase,
  updateStandingsAndStats,
  safeInt,
  AVAILABLE_BID_MULTIPLIERS,
  getLegendAuctionLimit,
  canUserAcquirePlayer,
  roomRtmUsesRemaining,
  refreshCurrentLotRtmHolder,
  hasEligibleNextBidder,
  canRtmHolderStillChangeDecision,
  shouldFastSettleLot,
};
