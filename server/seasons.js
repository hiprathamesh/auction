const fs = require("node:fs");
const path = require("node:path");

function createSeasonStore(file) {
  let db;
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
      if (version > 1)
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
      if (version === 0) opened.exec("PRAGMA user_version=1");
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
          "INSERT INTO seasons (source_key, completed_at, champion_name, team_count, match_count, data) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          sourceKey,
          season.completedAt,
          season.champion?.teamName || "Champion",
          season.teams.length,
          season.matches.length,
          JSON.stringify(season),
        );
      database.exec("COMMIT");
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
  function list(before = Number.MAX_SAFE_INTEGER, limit = 24) {
    return open()
      .prepare(
        "SELECT id, completed_at AS completedAt, champion_name AS championName, team_count AS teamCount, match_count AS matchCount FROM seasons WHERE id < ? ORDER BY id DESC LIMIT ?",
      )
      .all(before, limit)
      .map((row) => ({ ...row, id: Number(row.id) }));
  }
  return {
    save,
    get,
    list,
    close: () => {
      if (db) {
        db.close();
        db = null;
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
    purchasePrice: p.purchasePrice,
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
    simulationSeed: m.simulationSeed,
    innings: (m.innings || []).map(innings),
    superOver: (m.superOver || []).map(innings),
    ballByBall: m.ballByBall || null,
  }));
  return {
    schemaVersion: 1,
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
