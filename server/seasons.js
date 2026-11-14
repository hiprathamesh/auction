const fs = require("node:fs");
const path = require("node:path");

function finalPlacement(season, teamId) {
  if (season.champion?.id === teamId) return { rank: 1, label: "Champion" };
  const matches = season.matches || [];
  const final = matches.find((match) => match.type === "final");
  if (final && [final.homeId, final.awayId].includes(teamId))
    return { rank: 2, label: "Runner-up" };
  const qualifier = matches.find((match) => match.round === "Qualifier 2");
  if (
    qualifier &&
    [qualifier.homeId, qualifier.awayId].includes(teamId) &&
    qualifier.winnerId !== teamId
  )
    return { rank: 3, label: "Third place" };
  const eliminator = matches.find((match) => match.round === "Eliminator");
  if (
    eliminator &&
    [eliminator.homeId, eliminator.awayId].includes(teamId) &&
    eliminator.winnerId !== teamId
  )
    return { rank: 4, label: "Fourth place" };
  const rank =
    (season.standings || []).findIndex((row) => row.userId === teamId) + 1;
  return {
    rank: rank || null,
    label: rank ? `League #${rank}` : "Season appearance",
  };
}

function indexSeason(database, id, season) {
  const member = database.prepare(`INSERT OR REPLACE INTO season_members
    (season_id, room_user_id, identity_id, display_name, team_name, team_id, finish, wins, losses, champion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const team of season.teams || []) {
    const standing = (season.standings || []).find(
      (row) => row.userId === team.id,
    );
    const leagueFinish =
      (season.standings || []).findIndex((row) => row.userId === team.id) + 1;
    member.run(
      id,
      team.id,
      team.identityId || null,
      team.name,
      team.teamName,
      team.teamId,
      leagueFinish || null,
      standing?.won || 0,
      standing?.lost || 0,
      season.champion?.id === team.id ? 1 : 0,
    );
  }
  const stats = new Map(
    (season.playerStats || []).map((row) => [row.playerId, { ...row }]),
  );
  for (const team of season.teams || []) {
    for (const player of team.squad || []) {
      if (!stats.has(player.id))
        stats.set(player.id, {
          playerId: player.id,
          name: player.name,
          teamId: team.id,
          teamName: team.teamName,
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          wickets: 0,
          bowlerBalls: 0,
          bowlerRuns: 0,
          fifties: 0,
          hundreds: 0,
          mvpScore: 0,
        });
    }
  }
  const appearances = new Map();
  const appearanceFor = (playerId) => {
    if (!appearances.has(playerId))
      appearances.set(playerId, {
        matchIds: new Set(),
        innings: 0,
        outs: 0,
        bowlingInnings: 0,
        bestScore: 0,
      });
    return appearances.get(playerId);
  };
  for (const match of season.matches || []) {
    for (const team of season.teams || []) {
      if (![match.homeId, match.awayId].includes(team.id)) continue;
      const plan = match.teamPlans?.find((entry) => entry.userId === team.id);
      for (const playerId of plan?.lineup || team.lineup || []) {
        if (!stats.has(playerId)) continue;
        const data = appearanceFor(playerId);
        data.matchIds.add(match.id);
      }
    }
    for (const innings of match.innings || []) {
      for (const batter of innings.batters || []) {
        const playerId = batter.player?.id;
        if (
          !playerId ||
          !stats.has(playerId) ||
          !(batter.balls || batter.runs || batter.out)
        )
          continue;
        const data = appearanceFor(playerId);
        data.matchIds.add(match.id);
        data.innings++;
        if (batter.out) data.outs++;
        data.bestScore = Math.max(data.bestScore, Number(batter.runs) || 0);
      }
      for (const bowler of innings.bowlers || []) {
        const playerId = bowler.player?.id;
        if (!playerId || !stats.has(playerId) || !bowler.legalBalls) continue;
        const data = appearanceFor(playerId);
        data.matchIds.add(match.id);
        data.bowlingInnings++;
      }
    }
  }
  const leaders = (key) =>
    Math.max(0, ...[...stats.values()].map((row) => Number(row[key]) || 0));
  const topRuns = leaders("runs"),
    topWickets = leaders("wickets"),
    topMvp = leaders("mvpScore");
  const saleByPlayer = new Map(
    (season.auction?.sales || []).map((sale) => [sale.player.id, sale]),
  );
  const insert = database.prepare(`INSERT OR REPLACE INTO season_players
    (season_id, player_id, name, runs, wickets, mvp_score, data) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [playerId, row] of stats) {
    const team = (season.teams || []).find((entry) =>
      entry.squad?.some((p) => p.id === playerId),
    );
    const appearance = appearances.get(playerId);
    const sale = saleByPlayer.get(playerId);
    const squadPlayer = team?.squad?.find((entry) => entry.id === playerId);
    const leagueFinish =
      (season.standings || []).findIndex((entry) => entry.userId === team?.id) +
      1;
    const enriched = {
      ...row,
      role: squadPlayer?.role || null,
      nationality: squadPlayer?.nationality || null,
      photo: squadPlayer?.photo || null,
      photoAttribution: squadPlayer?.photoAttribution || null,
      legend: Boolean(squadPlayer?.legend),
      matches: appearance?.matchIds.size || 0,
      bestScore: appearance?.bestScore || 0,
      innings: appearance?.innings || 0,
      outs: appearance?.outs || 0,
      bowlingInnings: appearance?.bowlingInnings || 0,
      squadTeamName: team?.teamName || row.teamName || null,
      squadOwnerId: team?.identityId || null,
      squadOwnerName: team?.name || null,
      retained: squadPlayer?.retained === true || undefined,
      champion: Boolean(team && season.champion?.id === team.id),
      leagueFinish: leagueFinish || null,
      finalFinish: team ? finalPlacement(season, team.id) : null,
      price: sale?.price ?? null,
      orangeCap: topRuns > 0 && Number(row.runs) === topRuns,
      purpleCap: topWickets > 0 && Number(row.wickets) === topWickets,
      mvpAward: topMvp > 0 && Number(row.mvpScore) === topMvp,
      seasonId: id,
      completedAt: season.completedAt,
    };
    insert.run(
      id,
      playerId,
      row.name,
      Number(row.runs) || 0,
      Number(row.wickets) || 0,
      Number(row.mvpScore) || 0,
      JSON.stringify(enriched),
    );
  }
}

function createSeasonStore(file) {
  let db;
  let leadersCache;
  function open() {
    if (db) return db;
    const { DatabaseSync } = require("node:sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const opened = new DatabaseSync(file);
    try {
      opened.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;",
      );
      const version = opened.prepare("PRAGMA user_version").get().user_version;
      if (version > 4)
        throw new Error("Unsupported season archive database version.");
      opened.exec(`CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL UNIQUE,
      completed_at INTEGER NOT NULL,
      champion_name TEXT NOT NULL,
      team_count INTEGER NOT NULL,
      match_count INTEGER NOT NULL,
      data TEXT NOT NULL
      )`);
      if (version < 4) {
        opened.exec("BEGIN IMMEDIATE");
        try {
          if (version < 2)
            opened.exec(`CREATE TABLE season_members (
            season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            room_user_id TEXT NOT NULL, identity_id TEXT, display_name TEXT NOT NULL,
            team_name TEXT NOT NULL, team_id TEXT NOT NULL, finish INTEGER,
            wins INTEGER NOT NULL, losses INTEGER NOT NULL, champion INTEGER NOT NULL,
            PRIMARY KEY (season_id, room_user_id));
            CREATE INDEX season_members_identity ON season_members(identity_id, season_id DESC);
            CREATE TABLE season_players (
            season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            player_id TEXT NOT NULL, name TEXT NOT NULL, runs INTEGER NOT NULL,
            wickets INTEGER NOT NULL, mvp_score REAL NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY (season_id, player_id));
            CREATE INDEX season_players_player ON season_players(player_id, season_id DESC);
            CREATE INDEX season_players_runs ON season_players(runs DESC);
            CREATE INDEX season_players_wickets ON season_players(wickets DESC);
            ALTER TABLE seasons ADD COLUMN owner_id TEXT;`);
          for (const row of opened
            .prepare("SELECT id, data FROM seasons")
            .all())
            indexSeason(opened, row.id, JSON.parse(row.data));
          opened.exec("PRAGMA user_version=4; COMMIT");
        } catch (error) {
          opened.exec("ROLLBACK");
          throw error;
        }
      }
      opened.exec("PRAGMA foreign_keys=ON");
      db = opened;
    } catch (error) {
      opened.close();
      throw error;
    }
    return db;
  }
  function save(sourceKey, season) {
    const database = open();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = database
        .prepare("SELECT id FROM seasons WHERE source_key = ?")
        .get(sourceKey);
      if (existing) {
        database.exec("COMMIT");
        return { id: Number(existing.id), created: false };
      }
      const result = database
        .prepare(
          "INSERT INTO seasons (source_key, completed_at, champion_name, team_count, match_count, data, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          sourceKey,
          season.completedAt,
          season.champion?.teamName || "Champion",
          season.teams.length,
          season.matches.length,
          JSON.stringify(season),
          season.ownerIdentityId || null,
        );
      indexSeason(database, Number(result.lastInsertRowid), season);
      database.exec("COMMIT");
      leadersCache = undefined;
      return { id: Number(result.lastInsertRowid), created: true };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  function get(id) {
    const row = open()
      .prepare("SELECT id, data FROM seasons WHERE id = ?")
      .get(id);
    return row ? { id: Number(row.id), ...JSON.parse(row.data) } : null;
  }
  function latestRoster() {
    const rows = open()
      .prepare(
        `SELECT latest.id AS seasonId, p.player_id AS playerId,
          json_extract(p.data, '$.squadOwnerId') AS identityId,
          json_extract(p.data, '$.retained') AS retained
        FROM (SELECT id FROM seasons ORDER BY id DESC LIMIT 1) AS latest
        LEFT JOIN season_players p ON p.season_id = latest.id
          AND json_extract(p.data, '$.squadOwnerId') IS NOT NULL
        ORDER BY p.player_id`,
      )
      .all();
    if (!rows.length) return null;
    return {
      id: Number(rows[0].seasonId),
      players: Object.fromEntries(
        rows
          .filter((row) => row.identityId)
          .map(({ playerId, identityId, retained }) => [
            playerId,
            { identityId, retained: retained === 1 },
          ]),
      ),
    };
  }
  function list(before = Number.MAX_SAFE_INTEGER, limit = 24) {
    return open()
      .prepare(
        "SELECT id, completed_at AS completedAt, champion_name AS championName, team_count AS teamCount, match_count AS matchCount FROM seasons WHERE id < ? ORDER BY id DESC LIMIT ?",
      )
      .all(before, limit)
      .map((row) => ({ ...row, id: Number(row.id) }));
  }
  function remove(id) {
    const removed =
      Number(
        open().prepare("DELETE FROM seasons WHERE id = ?").run(id).changes,
      ) > 0;
    if (removed) leadersCache = undefined;
    return removed;
  }
  function listForUser(userId, before = Number.MAX_SAFE_INTEGER, limit = 24) {
    return open()
      .prepare(
        `SELECT s.id, s.completed_at AS completedAt,
      s.champion_name AS championName, s.team_count AS teamCount,
      s.match_count AS matchCount, m.team_name AS yourTeam,
      m.display_name AS yourName, m.finish AS leagueFinish, m.champion AS champion
      FROM seasons s JOIN season_members m ON m.season_id=s.id
      WHERE m.identity_id=? AND s.id<? ORDER BY s.id DESC LIMIT ?`,
      )
      .all(userId, before, limit)
      .map((row) => ({ ...row, id: Number(row.id) }));
  }
  function userSeasons(userId) {
    return open()
      .prepare(
        `SELECT s.id, s.completed_at AS completedAt, s.data,
      s.champion_name AS championName, s.team_count AS teamCount,
      m.room_user_id AS roomUserId, m.display_name AS displayName, m.team_name AS teamName, m.team_id AS teamId,
      m.finish AS leagueFinish, m.wins, m.losses, m.champion
      FROM season_members m JOIN seasons s ON s.id=m.season_id
      WHERE m.identity_id=? ORDER BY s.id DESC`,
      )
      .all(userId)
      .map(({ data, roomUserId, ...row }) => {
        const season = JSON.parse(data);
        const team = season.teams.find((entry) => entry.id === roomUserId);
        const stats = new Map(
          (season.playerStats || []).map((player) => [player.playerId, player]),
        );
        const squad =
          team?.squad?.map((player) => ({
            id: player.id,
            name: player.name,
            inXi: team.lineup?.includes(player.id) || false,
            price: player.purchasePrice,
            retained: player.retained === true || undefined,
            runs: stats.get(player.id)?.runs || 0,
            wickets: stats.get(player.id)?.wickets || 0,
          })) || [];
        const teams = new Map(season.teams.map((entry) => [entry.id, entry]));
        const results = season.matches.flatMap((match) => {
          if (match.homeId !== roomUserId && match.awayId !== roomUserId)
            return [];
          const opponent = teams.get(
            match.homeId === roomUserId ? match.awayId : match.homeId,
          );
          return [
            {
              matchId: match.id,
              stage: match.round || "League",
              playoff: match.type !== "league",
              opponentId: opponent?.identityId || null,
              opponentName: opponent?.name,
              opponentTeam: opponent?.teamName,
              result: match.winnerId
                ? match.winnerId === roomUserId
                  ? "win"
                  : "loss"
                : "tie",
            },
          ];
        });
        return {
          ...row,
          squad,
          finalFinish: finalPlacement(season, roomUserId),
          results,
          topScorer:
            [...squad]
              .sort((a, b) => b.runs - a.runs)
              .find((player) => player.runs > 0) || null,
          topWicketTaker:
            [...squad]
              .sort((a, b) => b.wickets - a.wickets)
              .find((player) => player.wickets > 0) || null,
        };
      });
  }
  function coPlayers(userId) {
    return open()
      .prepare(
        `SELECT m.identity_id AS id, COUNT(DISTINCT m.season_id) AS seasons,
      MAX(m.display_name) AS displayName FROM season_members mine
      JOIN season_members m ON m.season_id=mine.season_id
      WHERE mine.identity_id=? AND m.identity_id IS NOT NULL AND m.identity_id<>?
      GROUP BY m.identity_id ORDER BY seasons DESC, id LIMIT 100`,
      )
      .all(userId, userId);
  }
  function playerSeasons(playerId) {
    return open()
      .prepare(
        "SELECT data FROM season_players WHERE player_id=? ORDER BY season_id DESC",
      )
      .all(playerId)
      .map((row) => JSON.parse(row.data));
  }
  function playerMatchLog(playerId) {
    const seasons = open()
      .prepare(
        `SELECT s.id, s.data FROM season_players p JOIN seasons s ON s.id=p.season_id
        WHERE p.player_id=? ORDER BY s.id DESC`,
      )
      .all(playerId);
    return seasons.flatMap(({ id, data }) => {
      const season = JSON.parse(data);
      const team = season.teams.find((entry) =>
        entry.squad?.some((player) => player.id === playerId),
      );
      if (!team) return [];
      const teams = new Map(season.teams.map((entry) => [entry.id, entry]));
      return season.matches.flatMap((match) => {
        if (match.homeId !== team.id && match.awayId !== team.id) return [];
        const batting = [],
          bowling = [];
        for (const innings of match.innings || []) {
          const batter = innings.batters?.find(
            (entry) => entry.player?.id === playerId,
          );
          if (batter && (batter.balls || batter.runs || batter.out))
            batting.push({
              runs: batter.runs,
              balls: batter.balls,
              fours: batter.fours,
              sixes: batter.sixes,
              out: batter.out,
              dismissal: batter.dismissal,
            });
          const bowler = innings.bowlers?.find(
            (entry) => entry.player?.id === playerId,
          );
          if (bowler && (bowler.legalBalls || bowler.runs || bowler.wickets))
            bowling.push({
              wickets: bowler.wickets,
              runs: bowler.runs,
              balls: bowler.legalBalls,
              maidens: bowler.maidens,
            });
        }
        if (
          !batting.length &&
          !bowling.length &&
          !(
            match.teamPlans?.find((plan) => plan.userId === team.id)?.lineup ||
            team.lineup
          )?.includes(playerId)
        )
          return [];
        const opponent = teams.get(
          match.homeId === team.id ? match.awayId : match.homeId,
        );
        return [
          {
            seasonId: id,
            matchId: match.id,
            stage: match.round || "League",
            team: team.teamName,
            opponent: opponent?.teamName,
            batting,
            bowling,
          },
        ];
      });
    });
  }
  function playerLeaders(limit = 1000) {
    const database = open();
    // The version changes when an import or another connection commits.
    const version = database.prepare("PRAGMA data_version").get().data_version;
    if (leadersCache?.version === version)
      return leadersCache.rows.slice(0, limit);
    const rows = database
      .prepare(
        `SELECT player_id AS id, MAX(name) AS name,
      COUNT(*) AS seasons, SUM(runs) AS runs, SUM(wickets) AS wickets,
      SUM(mvp_score) AS mvpScore,
      SUM(CASE WHEN json_extract(data, '$.matches') > 0 THEN 1 ELSE 0 END) AS seasonsPlayed,
      SUM(COALESCE(json_extract(data, '$.balls'), 0)) AS balls,
      SUM(COALESCE(json_extract(data, '$.outs'), 0)) AS outs,
      SUM(COALESCE(json_extract(data, '$.bowlerBalls'), 0)) AS bowlerBalls,
      SUM(COALESCE(json_extract(data, '$.bowlerRuns'), 0)) AS bowlerRuns,
      COUNT(json_extract(data, '$.price')) AS auctionSales,
      SUM(COALESCE(json_extract(data, '$.price'), 0)) AS auctionSpend FROM season_players
      GROUP BY player_id ORDER BY runs DESC, wickets DESC, player_id`,
      )
      .all();
    leadersCache = { version, rows };
    return rows.slice(0, limit);
  }
  function ownerOf(id) {
    return (
      open().prepare("SELECT owner_id FROM seasons WHERE id=?").get(id)
        ?.owner_id || null
    );
  }
  function linkMember(seasonId, roomUserId, identityId) {
    const database = open();
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database
        .prepare("SELECT data FROM seasons WHERE id=?")
        .get(seasonId);
      if (!row) throw new Error("Season not found.");
      const season = JSON.parse(row.data);
      const team = season.teams.find((entry) => entry.id === roomUserId);
      if (!team) throw new Error("Season member not found.");
      team.identityId = identityId;
      database
        .prepare("UPDATE seasons SET data=? WHERE id=?")
        .run(JSON.stringify(season), seasonId);
      database
        .prepare("DELETE FROM season_members WHERE season_id=?")
        .run(seasonId);
      database
        .prepare("DELETE FROM season_players WHERE season_id=?")
        .run(seasonId);
      indexSeason(database, seasonId, season);
      database.exec("COMMIT");
      leadersCache = undefined;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    save,
    get,
    latestRoster,
    list,
    remove,
    listForUser,
    userSeasons,
    coPlayers,
    playerSeasons,
    playerMatchLog,
    playerLeaders,
    ownerOf,
    linkMember,
    close: () => {
      if (db) {
        db.close();
        db = null;
        leadersCache = undefined;
      }
    },
  };
}

function makeSeasonSnapshot(room) {
  if (
    room.phase !== "complete" ||
    !room.championId ||
    !room.matchResults.length
  )
    throw new Error("Only a completed season can be recorded.");
  const player = (p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    nationality: p.nationality,
    overseas: p.overseas,
    legend: p.legend,
    ovr: p.ovr,
    batting: p.batting,
    bowling: p.bowling,
    fielding: p.fielding,
    skills: p.skills,
    purchasePrice: p.purchasePrice,
    retained: p.retained === true || undefined,
    photo: p.photo,
    photoAttribution: p.photoAttribution,
    preferredBattingPositions: p.preferredBattingPositions,
  });
  const innings = (inn) => ({
    battingTeamId: inn.battingTeamId,
    battingTeamName: inn.battingTeamName,
    bowlingTeamId: inn.bowlingTeamId,
    bowlingTeamName: inn.bowlingTeamName,
    runs: inn.runs,
    wickets: inn.wickets,
    legalBalls: inn.legalBalls,
    overs: inn.overs,
    target: inn.target,
    maxBalls: inn.maxBalls,
    extras: inn.extras,
    allOut: inn.allOut,
    nrrOvers: inn.nrrOvers,
    batters: (inn.batters || []).map((b) => ({
      ...b,
      player: player(b.player),
    })),
    bowlers: (inn.bowlers || []).map((b) => ({
      ...b,
      player: player(b.player),
    })),
  });
  const teams = room.users.map((u) => ({
    id: u.id,
    identityId: u.identityId || null,
    name: u.name,
    teamId: u.teamId,
    teamName: u.teamName,
    teamShort: u.teamShort,
    teamColor: u.teamColor,
    purse: u.purse,
    squad: u.squad.map(player),
    lineup: [...u.lineup],
    bowlerIds: [...u.bowlerIds],
    tactics: { ...u.tactics },
    bowlingPlan: u.bowlingPlan,
    superOverPlan: u.superOverPlan,
    rtmUsesUsed: u.rtmUsesUsed,
    tradesUsed: u.tradesUsed,
  }));
  const matches = room.matchResults.map((m) => ({
    id: m.id,
    type: m.type,
    round: m.round,
    homeId: m.homeId,
    awayId: m.awayId,
    winnerId: m.winnerId,
    margin: m.margin,
    tied: m.tied,
    toss: m.toss,
    simulationSeed: m.simulationSeed,
    engineVersion: m.engineVersion,
    ratingVersion: m.ratingVersion,
    conditions: m.conditions,
    teamPlans: m.teamPlans,
    innings: (m.innings || []).map(innings),
    superOver: (m.superOver || []).map(innings),
    ballByBall: m.ballByBall || null,
  }));
  return {
    schemaVersion: 2,
    ownerIdentityId:
      room.recordingOwnerIdentityId ||
      room.users.find((u) => u.id === room.hostId)?.identityId ||
      null,
    startedAt: room.createdAt,
    completedAt: room.completedAt || Date.now(),
    champion: teams.find((u) => u.id === room.championId),
    settings: { ...room.settings },
    teams,
    standings: room.standings,
    matches,
    fixtures: room.fixtures.map((f) => ({
      id: f.id,
      type: f.type,
      round: f.round,
      homeId: f.homeId,
      awayId: f.awayId,
      played: f.played,
      winnerId: f.winnerId,
    })),
    playoff: { ...room.playoff },
    playerStats: Object.values(room.playerStats),
    trades: room.trades,
    auction: {
      sales: room.sold.map((sale) => ({
        player: player(sale.player),
        price: sale.price,
        userId: sale.userId,
        teamName: sale.teamName,
        lotNumber: sale.lotNumber,
        rtm: sale.rtm,
      })),
      unsold: room.unsold.map((entry) => ({
        player: player(entry.player),
        basePrice: entry.basePrice,
        lotNumber: entry.lotNumber,
      })),
      history: room.lotHistory,
    },
  };
}

module.exports = { createSeasonStore, makeSeasonSnapshot };
