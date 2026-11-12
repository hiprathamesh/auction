const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const net = require("node:net");
const express = require("express");
const { Server } = require("socket.io");
const game = require("./game");
const registerAuctionHandlers = require("./handlers/auction");
const registerTradeHandlers = require("./handlers/trades");
const registerLineupHandlers = require("./handlers/lineups");
const registerTournamentHandlers = require("./handlers/tournament");
const { createCheckpointStore } = require("./checkpoints");
const { validatePlayerDatabase } = require("./playerDatabase");
const { expireInactiveRooms } = require("./roomLifecycle");
const { safeOn } = require("./safeEvents");
const { createSeasonStore, makeSeasonSnapshot } = require("./seasons");
const { createIdentityStore, COOKIE, SESSION_MS } = require("./identity");
const zlib = require("node:zlib");

const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, "..");
const DIST = process.env.DIST_DIR
  ? path.resolve(process.env.DIST_DIR)
  : path.join(ROOT, "dist");
const DB = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "players.json"), "utf8"),
);
const playersById = new Map(DB.players.map((player) => [player.id, player]));
const careerMetrics = require("../shared/career-metrics.json");
const databaseErrors = validatePlayerDatabase(DB, {
  publicDirectory: path.join(ROOT, "public"),
  franchiseIds: game.FRANCHISES.map((team) => team.id),
});
if (databaseErrors.length)
  throw new Error(`Invalid player database:\n${databaseErrors.join("\n")}`);
const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  },
  maxHttpBufferSize: 64 * 1024,
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(
      null,
      !origin || !allowedOrigins.length || allowedOrigins.includes(origin),
    );
  },
});
const rooms = new Map();
const socketByUser = new Map();
const seasonDatabasePath = process.env.SEASONS_DB_PATH
  ? path.resolve(process.env.SEASONS_DB_PATH)
  : path.join(ROOT, ".local", "seasons.sqlite");
const seasonStore = createSeasonStore(seasonDatabasePath);
const identities = createIdentityStore(
  path.join(path.dirname(seasonDatabasePath), "identities.sqlite"),
);
const identityAttempts = new Map();
const signedIn = (req) => identities.session(req.headers.cookie);
const socketIdentity = (socket) =>
  identities.session(socket.request.headers.cookie);
const secureCookie = (req) =>
  req.secure || req.get("x-forwarded-proto") === "https";
const sessionCookie = (req, token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; ${secureCookie(req) ? "Secure; " : ""}Priority=High`;
function sameOrigin(req, res, next) {
  const origin = req.get("Origin");
  const host = req.get("Host");
  if (
    origin &&
    !allowedOrigins.includes(origin) &&
    origin !== `http://${host}` &&
    origin !== `https://${host}`
  )
    return res.status(403).json({ error: "Invalid request origin." });
  next();
}
function requireIdentity(req, res, next) {
  req.identityId = signedIn(req);
  if (!req.identityId)
    return res.status(401).json({ error: "Identify yourself to continue." });
  next();
}
function recordCompletedSeason(room) {
  try {
    const saved = seasonStore.save(room.seasonKey, makeSeasonSnapshot(room));
    room.archivedSeasonId = saved.id;
  } catch (error) {
    console.error("Could not automatically record season:", error);
    io.to(room.code).emit("app:error", {
      message:
        "The season could not be recorded. The host can retry from host options.",
    });
  }
}
const ownerKeyPath = path.join(
  path.dirname(seasonDatabasePath),
  "archive-owner-key",
);
let ownerKey = process.env.ARCHIVE_OWNER_KEY;
if (!ownerKey) {
  try {
    fs.mkdirSync(path.dirname(ownerKeyPath), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(
        ownerKeyPath,
        `${crypto.randomBytes(32).toString("base64url")}\n`,
        { mode: 0o600, flag: "wx" },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    ownerKey = fs.readFileSync(ownerKeyPath, "utf8").trim();
  } catch (error) {
    console.error(
      `Archive deletion disabled: could not load owner key: ${error.message}`,
    );
  }
}
if (ownerKey && (ownerKey.length < 32 || ownerKey.length > 256)) {
  console.error(
    "Archive deletion disabled: owner key must be 32 to 256 characters.",
  );
  ownerKey = null;
}
const ownerKeyHash = ownerKey
  ? crypto.createHash("sha256").update(ownerKey).digest()
  : null;
let failedOwnerAttempts = 0;
let ownerLockUntil = 0;
const idleHours = Math.max(
  1,
  Math.min(168, Number(process.env.ROOM_IDLE_HOURS) || 24),
);
const maxRooms = Math.max(
  1,
  Math.min(1000, Number(process.env.MAX_ROOMS) || 100),
);
const checkpoints = createCheckpointStore({
  enabled: process.env.ROOM_CHECKPOINTS === "1",
  directory: process.env.ROOM_DATA_DIR
    ? path.resolve(process.env.ROOM_DATA_DIR)
    : path.join(ROOT, ".local", "rooms"),
});
function registerRoom(room) {
  room.saveCheckpoint = checkpoints.save;
  room.recordCompletedSeason = () => recordCompletedSeason(room);
  room.findPlayer = (id) => playersById.get(id);
  room.verifySeatIdentity = (user) => {
    const socket = io.sockets.sockets.get(user.socketId);
    return Boolean(socket && hasSeatIdentity(socket, user));
  };
  rooms.set(room.code, room);
}
for (const restored of checkpoints.load(idleHours * 60 * 60 * 1000))
  registerRoom(restored);
const cleanupInterval = setInterval(() => {
  const expired = expireInactiveRooms(rooms, {
    now: Date.now(),
    idleMs: idleHours * 60 * 60 * 1000,
    cleanupTimers: game.cleanupTimers,
    removeCheckpoint: checkpoints.remove,
  });
  expired.forEach((code) => console.log(`Expired inactive room ${code}`));
}, 60 * 1000);
cleanupInterval.unref();

app.disable("x-powered-by");
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    app: "IPL Auction Arena",
    playerCount: DB.players.length,
  }),
);
app.get("/api/teams", (_req, res) => res.json(game.FRANCHISES));
app.get("/api/players/count", (_req, res) =>
  res.json({
    count: DB.players.length,
    legends: DB.players.filter((p) => p.legend).length,
    sets: DB.setOrder.length,
  }),
);
app.get("/api/identity", (req, res) => {
  res.set("Cache-Control", "no-store").json({ id: signedIn(req) });
});
app.post(
  "/api/identity",
  sameOrigin,
  express.json({ limit: "1kb" }),
  (req, res) => {
    const forwarded = req.get("CF-Connecting-IP");
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress,
    );
    const key = loopback && net.isIP(forwarded || "") ? forwarded : req.ip;
    const now = Date.now();
    if (identityAttempts.size > 10000)
      for (const [address, attempts] of identityAttempts)
        if (now - attempts.at(-1) > 15 * 60 * 1000)
          identityAttempts.delete(address);
    const recent = (identityAttempts.get(key) || []).filter(
      (time) => now - time < 15 * 60 * 1000,
    );
    recent.push(now);
    identityAttempts.set(key, recent);
    if (recent.length > 60)
      return res
        .status(429)
        .json({ error: "Too many sign-in attempts. Try later." });
    try {
      const result = identities.identify(req.body?.id, req.body?.pin);
      if (result.error)
        return res.status(result.status).json({ error: result.error });
      res.set(
        "Set-Cookie",
        sessionCookie(req, result.token, SESSION_MS / 1000),
      );
      res.set("Cache-Control", "no-store").json({ id: result.id });
    } catch (error) {
      console.error("Could not identify user:", error);
      res.status(500).json({ error: "Identity service is unavailable." });
    }
  },
);
app.delete("/api/identity", sameOrigin, (req, res) => {
  identities.logout(req.headers.cookie);
  res.set("Set-Cookie", sessionCookie(req, "", 0));
  res.set("Cache-Control", "no-store").json({ ok: true });
});
app.patch(
  "/api/identity/pin",
  sameOrigin,
  requireIdentity,
  express.json({ limit: "1kb" }),
  (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = identities.changePin(
        req.identityId,
        req.body?.currentPin,
        req.body?.newPin,
      );
      if (result.error)
        return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch (error) {
      console.error("Could not change PIN:", error);
      res.status(500).json({ error: "Identity service is unavailable." });
    }
  },
);
app.get("/api/seasons", (req, res) => {
  const identityId = signedIn(req);
  if (!identityId)
    return res
      .status(401)
      .json({ error: "Identify yourself to view your seasons." });
  const before = Number(req.query.before || Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(before) || before < 1)
    return res.status(400).json({ error: "Invalid page." });
  try {
    res
      .set("Cache-Control", "no-store")
      .json({ seasons: seasonStore.listForUser(identityId, before) });
  } catch (error) {
    console.error("Could not list seasons:", error);
    res.status(500).json({ error: "Season archive is unavailable." });
  }
});
app.get("/api/hub", requireIdentity, (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json({
      id: req.identityId,
      seasons: seasonStore.listForUser(
        req.identityId,
        Number.MAX_SAFE_INTEGER,
        6,
      ),
      people: seasonStore.coPlayers(req.identityId),
      leaders: seasonStore.playerLeaders(6),
    });
  } catch (error) {
    console.error("Could not load hub:", error);
    res.status(500).json({ error: "Hub is unavailable." });
  }
});
app.get("/api/users/:id", requireIdentity, (req, res) => {
  const id = req.params.id;
  if (!/^[a-z][a-z0-9]{3,31}$/.test(id) || !identities.exists(id))
    return res.status(404).json({ error: "User not found." });
  try {
    const seasons = seasonStore.userSeasons(id);
    res.set("Cache-Control", "no-store").json({
      id,
      seasons,
      totals: {
        seasons: seasons.length,
        trophies: seasons.filter((item) => item.champion).length,
        wins: seasons.reduce((sum, item) => sum + item.wins, 0),
        losses: seasons.reduce((sum, item) => sum + item.losses, 0),
        teams: [...new Set(seasons.map((item) => item.teamName))].length,
      },
    });
  } catch (error) {
    console.error("Could not load user profile:", error);
    res.status(500).json({ error: "User profile is unavailable." });
  }
});
app.get("/api/players", requireIdentity, (_req, res) => {
  try {
    const leaders = new Map(
      seasonStore.playerLeaders(10000).map((item) => [item.id, item]),
    );
    const statsFor = (id) => {
      const { id: _id, name: _name, ...stats } = leaders.get(id) || {};
      return stats;
    };
    const players = DB.players.map((player) => ({
      id: player.id,
      name: player.name,
      role: player.role,
      nationality: player.nationality,
      photo: player.photo,
      legend: player.legend,
      ...statsFor(player.id),
    }));
    for (const [id, leader] of leaders)
      if (!players.some((player) => player.id === id)) {
        const latest = seasonStore.playerSeasons(id)[0];
        players.push({
          id,
          name: leader.name,
          role: latest?.role,
          nationality: latest?.nationality,
          photo: latest?.photo,
          legend: latest?.legend,
          ...statsFor(id),
        });
      }
    res.set("Cache-Control", "no-store").json({
      players,
    });
  } catch (error) {
    console.error("Could not list players:", error);
    res.status(500).json({ error: "Players are unavailable." });
  }
});
app.get("/api/players/:id/matches", requireIdentity, (req, res) => {
  const id = req.params.id;
  if (!/^[a-z][a-z0-9-]*$/.test(id))
    return res.status(404).json({ error: "Player not found." });
  try {
    res
      .set("Cache-Control", "no-store")
      .json({ matches: seasonStore.playerMatchLog(id) });
  } catch (error) {
    console.error("Could not load player matches:", error);
    res.status(500).json({ error: "Player match log is unavailable." });
  }
});
function profilePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    nationality: player.nationality,
    photo: player.photo,
    photoAttribution: player.photoAttribution,
    legend: player.legend,
  };
}
app.get("/api/players/:id", (req, res) => {
  try {
    const catalogPlayer = DB.players.find(
      (entry) => entry.id === req.params.id,
    );
    res.set("Cache-Control", "no-store");
    if (!signedIn(req)) {
      if (!catalogPlayer)
        return res
          .status(401)
          .json({ error: "Identify yourself to continue." });
      return res.json({ player: profilePlayer(catalogPlayer) });
    }
    const seasons = seasonStore.playerSeasons(req.params.id);
    const player =
      catalogPlayer ||
      (seasons[0] ? { id: req.params.id, ...seasons[0] } : null);
    if (!player) return res.status(404).json({ error: "Player not found." });
    const sum = (key) =>
      seasons.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const leaders = seasonStore.playerLeaders(10000);
    const own = leaders.find((row) => row.id === player.id);
    const ranks = Object.fromEntries(
      Object.entries(careerMetrics).map(([key, metric]) => {
        const value = (row) => {
          if (!row || (metric.sample && row[metric.sample] < metric.career))
            return null;
          if (!metric.bottom) return row[key] > 0 ? row[key] : null;
          return row[metric.bottom] > 0
            ? (row[metric.top] * (metric.scale || 1)) / row[metric.bottom]
            : null;
        };
        const score = value(own);
        const qualified = leaders.map(value).filter((entry) => entry !== null);
        return [
          key,
          score === null
            ? null
            : {
                rank:
                  1 +
                  qualified.filter((entry) =>
                    metric.low ? entry < score : entry > score,
                  ).length,
                of: qualified.length,
              },
        ];
      }),
    );
    const priced = seasons.filter((row) => row.price != null);
    const bestBowling =
      seasons
        .map((row) => row.bestBowling)
        .filter((figure) => /^\d+\/\d+$/.test(figure || ""))
        .sort((a, b) => {
          const [aw, ar] = a.split("/").map(Number);
          const [bw, br] = b.split("/").map(Number);
          return bw - aw || ar - br;
        })[0] || null;
    res.json({
      player: profilePlayer(player),
      seasons,
      totals: {
        seasons: seasons.length,
        seasonsPlayed: seasons.filter((row) => row.matches > 0).length,
        matches: sum("matches"),
        innings: sum("innings"),
        runs: sum("runs"),
        bestScore: Math.max(
          0,
          ...seasons.map((row) => Number(row.bestScore) || 0),
        ),
        balls: sum("balls"),
        outs: sum("outs"),
        fours: sum("fours"),
        sixes: sum("sixes"),
        fifties: sum("fifties"),
        hundreds: sum("hundreds"),
        wickets: sum("wickets"),
        bestBowling,
        bowlerBalls: sum("bowlerBalls"),
        bowlerRuns: sum("bowlerRuns"),
        mvpScore: sum("mvpScore"),
        trophies: sum("champion"),
        orangeCaps: sum("orangeCap"),
        purpleCaps: sum("purpleCap"),
        mvpAwards: sum("mvpAward"),
        averagePrice: priced.length
          ? priced.reduce((total, row) => total + row.price, 0) / priced.length
          : null,
      },
      ranks,
    });
  } catch (error) {
    console.error("Could not load player profile:", error);
    res.status(500).json({ error: "Player profile is unavailable." });
  }
});
app.get(
  "/api/seasons/:id/matches/:matchId/balls",
  requireIdentity,
  (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      return res.status(404).json({ error: "Season not found." });
    try {
      const season = seasonStore.get(id);
      const match = season?.matches.find(
        (entry) => entry.id === req.params.matchId,
      );
      if (!match) return res.status(404).json({ error: "Match not found." });
      const expand = (entries) =>
        (entries || []).map((data) =>
          data
            ? JSON.parse(
                zlib.inflateSync(Buffer.from(data, "base64")).toString("utf8"),
              )
            : [],
        );
      res.set("Cache-Control", "no-store").json(
        match.ballByBall
          ? {
              innings: expand(match.ballByBall.innings),
              superOver: expand(match.ballByBall.superOver),
            }
          : { innings: [], superOver: [] },
      );
    } catch (error) {
      console.error("Could not read match deliveries:", error);
      res.status(500).json({ error: "Match deliveries are unavailable." });
    }
  },
);
app.get("/api/seasons/:id", requireIdentity, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1)
    return res.status(404).json({ error: "Season not found." });
  try {
    const season = seasonStore.get(id);
    if (!season) return res.status(404).json({ error: "Season not found." });
    season.matches = season.matches.map(({ ballByBall, ...match }) => ({
      ...match,
      hasBallByBall: Boolean(ballByBall),
    }));
    res.set("Cache-Control", "no-store").json(season);
  } catch (error) {
    console.error("Could not read season:", error);
    res.status(500).json({ error: "Season archive is unavailable." });
  }
});
app.delete("/api/seasons/:id", sameOrigin, (req, res) => {
  res.set("Cache-Control", "no-store");
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1)
    return res.status(404).json({ error: "Season not found." });
  const byIdentity = Boolean(
    signedIn(req) && signedIn(req) === seasonStore.ownerOf(id),
  );
  if (!ownerKeyHash && !byIdentity)
    return res
      .status(503)
      .json({ error: "Season deletion is not configured on this server." });
  if (!byIdentity && Date.now() < ownerLockUntil)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again later." });
  const supplied = req.get("Authorization") || "";
  const candidate = crypto
    .createHash("sha256")
    .update(supplied.startsWith("Bearer ") ? supplied.slice(7) : "")
    .digest();
  if (!byIdentity && !crypto.timingSafeEqual(candidate, ownerKeyHash)) {
    if (++failedOwnerAttempts >= 8) {
      ownerLockUntil = Date.now() + 15 * 60 * 1000;
      failedOwnerAttempts = 0;
    }
    return res.status(401).json({ error: "Incorrect owner key." });
  }
  failedOwnerAttempts = 0;
  try {
    if (!seasonStore.remove(id))
      return res.status(404).json({ error: "Season not found." });
    for (const room of rooms.values()) {
      if (room.archivedSeasonId === id) {
        room.archivedSeasonId = null;
        room.settings.recordSeason = false;
        room.lastNotice = {
          kind: "seasonDeleted",
          text: `Season ${id} was deleted from the archive.`,
        };
        try {
          game.broadcast(io, room);
        } catch (error) {
          console.error(
            "Could not notify a room of the deleted season:",
            error,
          );
        }
      }
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error("Could not delete season:", error);
    return res.status(500).json({ error: "The season could not be deleted." });
  }
});
app.use(
  express.static(DIST, {
    maxAge: "1h",
    etag: true,
    setHeaders(res, file) {
      if (path.basename(file) === "index.html")
        res.setHeader("Cache-Control", "no-cache");
      else if (file.includes(`${path.sep}assets${path.sep}`))
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);
// Saved seasons and room checkpoints can still contain the old image URLs.
app.get(
  /^\/player-portraits\/([a-z0-9-]+)\.(?:jpe?g|png|avif)$/,
  (req, res) => {
    const photo = DB.players.find(
      (player) => player.id === req.params[0],
    )?.photo;
    if (photo?.endsWith(".webp")) return res.redirect(photo);
    return res.sendStatus(404);
  },
);
app.use("/player-portraits", (_req, res) => res.sendStatus(404));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(DIST, "index.html"), {
    headers: { "Cache-Control": "no-cache" },
  });
});

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(
      { length: 5 },
      () => alphabet[crypto.randomInt(alphabet.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}
function getRoomAndUser(socket) {
  const code = socket.data.roomCode;
  const room = code && rooms.get(code);
  const user =
    room &&
    room.users.find(
      (u) => u.id === socket.data.userId && u.socketId === socket.id,
    );
  return { room, user };
}
function emitError(socket, message, code) {
  socket.emit("app:error", { message, code });
}
function hasSeatIdentity(socket, user) {
  return Boolean(user.identityId && socketIdentity(socket) === user.identityId);
}
function rejectRoomIdentity(socket, user, acknowledge) {
  const message = user
    ? "Identify yourself with the ID you used for this seat to continue."
    : "Identify yourself before joining this room.";
  emitError(socket, message, "ROOM_IDENTITY_REQUIRED");
  if (typeof acknowledge === "function") acknowledge({ ok: false, message });
}
function verifyHost(socket, room, user) {
  if (!room || !user) {
    emitError(
      socket,
      "Your room session was not found. Rejoin with the room code.",
    );
    return false;
  }
  if (!game.hostCheck(room, user.id)) {
    emitError(socket, "Only the host can do that.");
    return false;
  }
  return true;
}
function newCredential() {
  return crypto.randomBytes(32).toString("base64url");
}
function credentialHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function validCredential(user, token) {
  if (
    !user?.credentialHash ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    return false;
  const actual = Buffer.from(credentialHash(token), "hex");
  const expected = Buffer.from(user.credentialHash, "hex");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}
function leaveCurrentRoom(socket) {
  const { room, user } = getRoomAndUser(socket);
  if (!room || !user) return;
  socket.leave(room.code);
  if (socketByUser.get(user.id) === socket.id) socketByUser.delete(user.id);
  user.connected = false;
  user.socketId = null;
  if (room.users.every((candidate) => !candidate.connected))
    room.emptySince = Date.now();
  socket.data.roomCode = null;
  socket.data.userId = null;
  game.broadcast(io, room, false);
}
function joinSocket(socket, room, user, reconnectToken, hostRecoveryToken) {
  if (
    socket.data.roomCode &&
    (socket.data.roomCode !== room.code || socket.data.userId !== user.id)
  ) {
    leaveCurrentRoom(socket);
  }
  const previousSocket =
    user.socketId && user.socketId !== socket.id
      ? io.sockets.sockets.get(user.socketId)
      : null;
  if (previousSocket) {
    previousSocket.emit("room:replaced", {
      message: "This seat was opened in another tab or browser.",
    });
    previousSocket.leave(room.code);
    previousSocket.data.roomCode = null;
    previousSocket.data.userId = null;
    previousSocket.disconnect(true);
  }
  user.connected = true;
  room.emptySince = null;
  game.assignUser(socket, room, user);
  socket.join(room.code);
  socketByUser.set(user.id, socket.id);
  socket.emit("room:joined", {
    roomCode: room.code,
    userId: user.id,
    hostId: room.hostId,
    isHost: user.id === room.hostId,
    identified: hasSeatIdentity(socket, user),
    ...(reconnectToken ? { reconnectToken } : {}),
    ...(hostRecoveryToken ? { hostRecoveryToken } : {}),
  });
  game.sendSnapshot(socket, room, user);
  game.broadcast(io, room);
}
function normalizeName(name) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").slice(0, 22);
}
function buildUser(name, teamId) {
  const franchise = game.FRANCHISES.find((f) => f.id === teamId);
  if (!franchise) return null;
  return {
    id: crypto.randomUUID(),
    name,
    teamId: franchise.id,
    teamName: franchise.name,
    teamShort: franchise.short,
    teamColor: franchise.color,
  };
}
function setNotice(room, notice) {
  room.lastNotice = notice;
}

io.on("connection", (socket) => {
  if (io.engine.clientsCount > 500) {
    socket.disconnect(true);
    return;
  }
  socket.emit("app:connected", { ok: true });
  const onAction = (event, handler) => safeOn(socket, event, handler);

  const objectEvents = new Set([
    "room:create",
    "room:join",
    "room:rejoin",
    "room:recoverHost",
    "host:transfer",
    "host:kickUser",
    "host:settings",
    "lobby:retain",
    "auction:bid",
    "auction:rtmToggle",
    "auction:out",
    "trade:propose",
    "trade:respond",
  ]);
  const booleanEvents = new Set(["lobby:ready", "lineup:ready"]);
  let eventWindow = Date.now();
  let eventCount = 0;
  socket.use((packet, next) => {
    const [event, payload] = packet;
    const now = Date.now();
    if (now - eventWindow >= 1000) {
      eventWindow = now;
      eventCount = 0;
    }
    eventCount += 1;
    if (eventCount > 50) {
      socket.disconnect(true);
      return;
    }
    const { room, user } = getRoomAndUser(socket);
    if (
      room?.settings.identifiedOnly &&
      user &&
      !hasSeatIdentity(socket, user)
    ) {
      leaveCurrentRoom(socket);
      return rejectRoomIdentity(socket, user, packet.at(-1));
    }
    if (
      objectEvents.has(event) &&
      (!payload || typeof payload !== "object" || Array.isArray(payload))
    ) {
      emitError(socket, "Invalid action data.");
      return;
    }
    if (booleanEvents.has(event) && typeof payload !== "boolean") {
      emitError(socket, "Invalid action data.");
      return;
    }
    if (event === "lineup:set" && (!payload || typeof payload !== "object")) {
      emitError(socket, "Invalid playing XI.");
      if (typeof packet[packet.length - 1] === "function")
        packet[packet.length - 1]({
          ok: false,
          message: "Invalid playing XI.",
        });
      return;
    }
    const stringField = (key, max = 128) =>
      typeof payload[key] === "string" && payload[key].length <= max;
    const invalid =
      (event === "host:kickUser" && !stringField("userId")) ||
      (event === "host:transfer" && !stringField("userId")) ||
      (event === "room:recoverHost" &&
        (!stringField("code", 32) || !stringField("recoveryToken"))) ||
      (event === "room:rejoin" &&
        (!stringField("code", 32) ||
          !stringField("userId") ||
          !stringField("reconnectToken"))) ||
      (event === "room:join" && !stringField("code", 32)) ||
      (event === "lobby:retain" &&
        (!stringField("playerId") || typeof payload.selected !== "boolean")) ||
      (event === "auction:bid" &&
        (!stringField("lotId") ||
          !stringField("actionId") ||
          typeof payload.expectedBid !== "number" ||
          !Number.isFinite(payload.expectedBid) ||
          (payload.multiplier !== undefined &&
            typeof payload.multiplier !== "number"))) ||
      (event === "auction:rtmToggle" &&
        (!stringField("lotId") || typeof payload.enabled !== "boolean")) ||
      (event === "auction:out" && !stringField("lotId")) ||
      (event === "trade:propose" &&
        !["toUserId", "myPlayerId", "theirPlayerId"].every((key) =>
          stringField(key),
        )) ||
      (event === "trade:respond" &&
        (!stringField("offerId") || typeof payload.accept !== "boolean"));
    if (invalid) {
      const message = "Invalid action data.";
      emitError(socket, message);
      const acknowledgement = packet[packet.length - 1];
      if (typeof acknowledgement === "function")
        acknowledgement({ ok: false, message });
      return;
    }
    if (event === "lineup:set") {
      const ids = Array.isArray(payload) ? payload : payload.playerIds;
      const bowlers = Array.isArray(payload) ? undefined : payload.bowlerIds;
      if (
        !Array.isArray(ids) ||
        ids.length > 11 ||
        ids.some((id) => typeof id !== "string" || id.length > 128) ||
        (bowlers !== undefined &&
          (!Array.isArray(bowlers) ||
            bowlers.length > 5 ||
            bowlers.some((id) => typeof id !== "string" || id.length > 128)))
      ) {
        emitError(socket, "Invalid playing XI.");
        if (typeof packet[packet.length - 1] === "function")
          packet[packet.length - 1]({
            ok: false,
            message: "Invalid playing XI.",
          });
        return;
      }
    }
    next();
  });

  onAction("room:create", ({ name: rawName, teamId } = {}) => {
    if (rooms.size >= maxRooms)
      return emitError(
        socket,
        "The server has reached its room limit. Try again later.",
      );
    const name = normalizeName(rawName);
    if (name.length < 2)
      return emitError(
        socket,
        "Choose a display name with at least 2 characters.",
      );
    const user = buildUser(name, teamId);
    if (!user) return emitError(socket, "Choose an IPL franchise first.");
    user.identityId = socketIdentity(socket);
    const reconnectToken = newCredential();
    user.credentialHash = credentialHash(reconnectToken);
    const hostRecoveryToken = newCredential();
    const code = makeCode();
    const room = game.createRoom(code, user, DB);
    room.hostRecoveryHash = credentialHash(hostRecoveryToken);
    room.emptySince = null;
    registerRoom(room);
    joinSocket(socket, room, user, reconnectToken, hostRecoveryToken);
  });

  onAction(
    "room:join",
    ({ code: rawCode, name: rawName, teamId, resumeUserId } = {}) => {
      if (typeof rawCode !== "string" || rawCode.length > 32)
        return emitError(socket, "Invalid room code.");
      const code = rawCode
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const room = rooms.get(code);
      if (!room)
        return emitError(
          socket,
          "Room not found. Check the code and make sure the host server is running.",
        );
      if (resumeUserId)
        return emitError(
          socket,
          "Use your saved session credentials to rejoin.",
        );
      const name = normalizeName(rawName);
      if (name.length < 2)
        return emitError(
          socket,
          "Choose a display name with at least 2 characters.",
        );
      const user = buildUser(name, teamId);
      if (!user) return emitError(socket, "Choose an IPL franchise first.");
      user.identityId = socketIdentity(socket);
      if (room.settings.identifiedOnly && !user.identityId)
        return rejectRoomIdentity(socket);
      if (
        user.identityId &&
        room.users.some((entry) => entry.identityId === user.identityId)
      )
        return emitError(
          socket,
          "This identity already has a seat in the room. Rejoin your saved seat instead.",
        );
      const reconnectToken = newCredential();
      user.credentialHash = credentialHash(reconnectToken);
      const result = game.addUser(room, user);
      if (result.error) return emitError(socket, result.error);
      if (room.phase === "auction") {
        game.refreshCurrentLotRtmHolder(room);
        setNotice(room, {
          kind: "join",
          text: `${user.name} joined the room mid-auction.`,
        });
      }
      joinSocket(socket, room, user, reconnectToken);
    },
  );

  onAction("room:rejoin", ({ code, userId, reconnectToken } = {}) => {
    if (
      typeof code !== "string" ||
      code.length > 32 ||
      typeof userId !== "string"
    )
      return emitError(socket, "Invalid session credentials.");
    const room = rooms.get(code.toUpperCase());
    const user = room && room.users.find((u) => u.id === userId);
    if (!room || !validCredential(user, reconnectToken))
      return emitError(
        socket,
        "Saved session or credentials not found. Create a new room or join using the room code.",
      );
    if (room.settings.identifiedOnly && !hasSeatIdentity(socket, user))
      return rejectRoomIdentity(socket, user);
    joinSocket(socket, room, user);
  });

  onAction("room:sync", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user)
      return emitError(socket, "Rejoin the room to synchronize.");
    game.sendSnapshot(socket, room, user);
  });

  onAction("host:recordSeason", (acknowledgement) => {
    const { room, user } = getRoomAndUser(socket);
    const fail = (message) => {
      emitError(socket, message);
      if (typeof acknowledgement === "function")
        acknowledgement({ ok: false, message });
    };
    if (!room || !user || !game.hostCheck(room, user.id))
      return fail("Only the host can record this season.");
    if (!hasSeatIdentity(socket, user))
      return fail("Identify yourself as the host to record this season.");
    if (!room.settings.recordSeason)
      return fail("Season recording was not enabled in host options.");
    if (room.phase !== "complete")
      return fail("Only a completed season can be recorded.");
    try {
      room.seasonKey ||= crypto
        .createHash("sha256")
        .update(`${room.code}:${room.createdAt}:${room.hostId}`)
        .digest("hex");
      const saved = seasonStore.save(room.seasonKey, makeSeasonSnapshot(room));
      room.archivedSeasonId = saved.id;
      room.lastNotice = {
        kind: "seasonRecorded",
        text: `Season ${saved.id} was recorded.`,
      };
      game.broadcast(io, room);
      if (typeof acknowledgement === "function")
        acknowledgement({
          ok: true,
          id: saved.id,
          path: `/s/${saved.id}`,
          created: saved.created,
        });
    } catch (error) {
      console.error("Could not record season:", error);
      fail(
        "Could not record the season. Check the server logs and storage, then try again.",
      );
    }
  });

  onAction("room:recoverHost", ({ code, recoveryToken } = {}) => {
    const room = rooms.get(code.trim().toUpperCase());
    const host =
      room && room.users.find((candidate) => candidate.id === room.hostId);
    if (
      !host ||
      !validCredential({ credentialHash: room.hostRecoveryHash }, recoveryToken)
    )
      return emitError(socket, "Host recovery code or room not found.");
    if (room.settings.identifiedOnly && !hasSeatIdentity(socket, host))
      return rejectRoomIdentity(socket, host);
    const reconnectToken = newCredential();
    const hostRecoveryToken = newCredential();
    host.credentialHash = credentialHash(reconnectToken);
    room.hostRecoveryHash = credentialHash(hostRecoveryToken);
    joinSocket(socket, room, host, reconnectToken, hostRecoveryToken);
  });

  onAction("host:rotateRecovery", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    const hostRecoveryToken = newCredential();
    room.hostRecoveryHash = credentialHash(hostRecoveryToken);
    room.saveCheckpoint?.(room);
    socket.emit("host:recoveryToken", { hostRecoveryToken });
  });

  onAction("host:transfer", ({ userId } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    const target = room.users.find(
      (candidate) => candidate.id === userId && candidate.id !== user.id,
    );
    const targetSocket =
      target?.socketId && io.sockets.sockets.get(target.socketId);
    if (!target || !target.connected || !targetSocket)
      return emitError(socket, "Choose a connected player to become host.");
    const hostRecoveryToken = newCredential();
    room.hostRecoveryHash = credentialHash(hostRecoveryToken);
    room.hostId = target.id;
    user.isHost = false;
    target.isHost = true;
    room.lastNotice = {
      kind: "hostTransfer",
      text: `${target.name} is now the host.`,
    };
    targetSocket.emit("host:recoveryToken", { hostRecoveryToken });
    game.broadcast(io, room);
  });

  onAction("host:kickUser", ({ userId } = {}) => {
    const { room, user: host } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, host)) return;
    if (
      !["lobby", "auction", "auctionResults", "lineup"].includes(room.phase)
    ) {
      return emitError(
        socket,
        "Players can only be removed before the league simulation starts.",
      );
    }

    const target = room.users.find((u) => u.id === String(userId || ""));
    if (!target)
      return emitError(socket, "That player is no longer in this room.");
    if (target.id === host.id || target.id === room.hostId)
      return emitError(socket, "The host cannot remove themselves.");

    // Return any players bought by this user to the unsold pool so the group can auction them again.
    const recoveredSales = room.sold.filter(
      (sale) => sale.userId === target.id,
    );
    for (const sale of recoveredSales) {
      if (!room.unsold.some((entry) => entry.player?.id === sale.player.id)) {
        room.unsold.push({
          player: sale.player,
          basePrice: sale.player.basePrice,
          lotNumber: sale.lotNumber,
        });
      }
      const history = room.lotHistory.find(
        (entry) =>
          entry.lotNumber === sale.lotNumber &&
          entry.playerId === sale.player.id,
      );
      if (history) {
        history.result = "UNSOLD";
        history.teamName = null;
        history.price = null;
      }
    }
    room.sold = room.sold.filter((sale) => sale.userId !== target.id);
    const releasedRetentions = target.squad
      .filter((player) => player.retained)
      .map(
        ({ retained: _retained, purchasePrice: _price, ...player }) => player,
      );
    if (releasedRetentions.length) {
      room.auctionQueue.push(...releasedRetentions);
      room.totalLots += releasedRetentions.length;
      if (room.currentLot) room.currentLot.totalLots = room.totalLots;
    }

    // If the removed user was leading the current lot, cancel their bid and restart the clock.
    if (
      room.phase === "auction" &&
      room.currentLot?.currentBidderId === target.id
    ) {
      room.currentLot.currentBidderId = null;
      room.currentLot.currentBid = room.currentLot.basePrice;
      if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
      room.auctionTimeout = null;
      if (room.auctionPaused) {
        room.auctionRemainingMs = Math.max(
          1000,
          room.auctionRemainingMs || room.settings.bidSeconds * 1000,
        );
        room.auctionEndsAt = null;
      } else {
        room.auctionRemainingMs = room.settings.bidSeconds * 1000;
        room.auctionEndsAt = Date.now() + room.auctionRemainingMs;
        room.auctionTimeout = setTimeout(
          () => game.settleLot(io, room, false),
          room.auctionRemainingMs,
        );
      }
    }

    const removedSocketId = socketByUser.get(target.id);
    const removedSocket = removedSocketId
      ? io.sockets.sockets.get(removedSocketId)
      : null;
    if (removedSocket) {
      removedSocket.emit("room:kicked", {
        message: `The host removed ${target.name} from the room.`,
      });
      removedSocket.leave(room.code);
      removedSocket.data.roomCode = null;
      removedSocket.data.userId = null;
    }
    socketByUser.delete(target.id);

    const recoveredCount = recoveredSales.length + releasedRetentions.length;
    const wasLineupPhase = room.phase === "lineup";
    room.tradeOffers = (room.tradeOffers || []).filter(
      (offer) => offer.fromId !== target.id && offer.toId !== target.id,
    );
    room.users = room.users.filter((u) => u.id !== target.id);
    if (room.currentLot) game.refreshCurrentLotRtmHolder(room);
    if (room.currentLot?.outUserIds) {
      room.currentLot.outUserIds = room.currentLot.outUserIds.filter(
        (id) => id !== target.id,
      );
    }
    target.squad = [];
    target.lineup = [];
    target.bowlerIds = [];
    target.xiReady = false;

    // Removing a team during XI selection invalidates the previous readiness checks.
    // Return everyone to auction results, where the recovered players can be re-auctioned.
    if (room.phase === "lineup") {
      room.phase = "auctionResults";
      for (const remainingUser of room.users) {
        remainingUser.lineup = [];
        remainingUser.bowlerIds = [];
        remainingUser.xiReady = false;
      }
    }

    const recoveredMessage = recoveredCount
      ? ` ${recoveredCount} squad player${recoveredCount === 1 ? "" : "s"} returned to the auction pool.`
      : "";
    const lineupMessage = wasLineupPhase
      ? " The room returned to Auction Results and all remaining teams must select their XIs again."
      : "";
    room.lastNotice = {
      kind: "userRemoved",
      text: `${target.name} (${target.teamShort}) was removed by the host.${recoveredMessage}${lineupMessage}`,
    };
    if (
      room.phase === "auction" &&
      room.currentLot &&
      !room.currentLot.currentBidderId &&
      room.users.length > 0 &&
      room.users.every((roomUser) =>
        (room.currentLot.outUserIds || []).includes(roomUser.id),
      )
    ) {
      game.settleLot(io, room, false);
      return;
    }
    if (game.shouldFastSettleLot(room)) {
      game.settleLot(io, room, false, true);
      return;
    }
    game.broadcast(io, room);
  });

  onAction("lobby:ready", (ready) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== "lobby") return;
    user.ready = Boolean(ready);
    setNotice(room, {
      kind: "ready",
      text: `${user.name} ${user.ready ? "is ready" : "is not ready"}.`,
    });
    game.broadcast(io, room);
  });

  onAction("lobby:retain", ({ playerId, selected }) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || !hasSeatIdentity(socket, user))
      return emitError(socket, "Identify yourself to select retained players.");
    const result = game.setRetention(room, user, playerId, selected);
    if (result.error) return emitError(socket, result.error);
    game.broadcast(io, room, false, true);
  });

  onAction("host:settings", (patch = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== "lobby") return;
    if (typeof patch.identifiedOnly === "boolean") {
      if (!hasSeatIdentity(socket, user))
        return emitError(
          socket,
          "Identify yourself as the host to change room access.",
        );
      if (patch.identifiedOnly && room.users.some((entry) => !entry.identityId))
        return emitError(
          socket,
          "Remove guest seats before turning on identified-only access.",
        );
    }
    if (patch.retentionEnabled === true && room.previousSeason === undefined)
      room.previousSeason = seasonStore.latestRoster();
    if (typeof patch.identifiedOnly === "boolean")
      room.settings.identifiedOnly = patch.identifiedOnly;
    const { retentionEnabled, retentionLimit, includeLegends } = room.settings;
    if (Object.prototype.hasOwnProperty.call(patch, "recordSeason")) {
      if (patch.recordSeason === false) {
        room.settings.recordSeason = false;
        room.recordingOwnerIdentityId = null;
      } else if (patch.recordSeason === true && hasSeatIdentity(socket, user)) {
        room.settings.recordSeason = true;
        room.recordingOwnerIdentityId = user.identityId;
      }
    }
    const allowed = {
      bidSeconds: [5, 10, 15, 20, 30],
      startingPurse: [60, 80, 100, 120, 150, 200],
      includeLegends: [true, false],
      showRatings: [true, false],
      legendAuctionLimit: [4, 5, 6, 7, 8, "unlimited"],
      rtmEnabled: [true, false],
      rtmUses: [1, 2, 3, 4],
      rtmPublicStatus: [true, false],
      retentionEnabled: [true, false],
      retentionLimit: [1, 2, 3],
      tradesEnabled: [true, false],
      tradeLimit: [1, 2, 3, 4, 5, 6, 8, 10],
    };
    for (const [key, choices] of Object.entries(allowed)) {
      if (
        Object.prototype.hasOwnProperty.call(patch, key) &&
        choices.includes(patch[key])
      )
        room.settings[key] = patch[key];
    }
    if (Object.prototype.hasOwnProperty.call(patch, "bidMultipliers")) {
      const values = patch.bidMultipliers;
      if (
        Array.isArray(values) &&
        values.length <= 5 &&
        values.every((v) => game.AVAILABLE_BID_MULTIPLIERS.includes(v)) &&
        new Set(values).size === values.length
      ) {
        room.settings.bidMultipliers = game.AVAILABLE_BID_MULTIPLIERS.filter(
          (v) => values.includes(v),
        );
      }
    }
    if (
      Boolean(retentionEnabled) !== Boolean(room.settings.retentionEnabled) ||
      (room.settings.retentionEnabled &&
        (retentionLimit !== room.settings.retentionLimit ||
          includeLegends !== room.settings.includeLegends))
    )
      game.resetRetentionReadiness(room);
    for (const u of room.users) u.purse = room.settings.startingPurse;
    setNotice(room, { kind: "settings", text: "Auction settings updated." });
    game.broadcast(io, room);
  });

  onAction("host:startAuction", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    const result = game.startAuction(io, room, DB, seasonStore.latestRoster);
    if (result.error) return emitError(socket, result.error);
  });

  const handlerContext = {
    socket,
    onAction,
    io,
    game,
    getRoomAndUser,
    hasSeatIdentity,
    verifyHost,
    emitError,
    setNotice,
  };
  registerAuctionHandlers(handlerContext);
  registerTradeHandlers(handlerContext);
  registerLineupHandlers(handlerContext);
  registerTournamentHandlers(handlerContext);

  onAction("disconnect", () => {
    const { room, user } = getRoomAndUser(socket);
    if (socketByUser.get(socket.data.userId) === socket.id)
      socketByUser.delete(socket.data.userId);
    if (room && user && user.socketId === socket.id) {
      // A refresh or Wi-Fi drop should not delete a player's team.
      user.connected = false;
      if (user.socketId === socket.id) user.socketId = null;
      if (room.users.every((candidate) => !candidate.connected))
        room.emptySince = Date.now();
      if (game.shouldFastSettleLot(room)) {
        game.settleLot(io, room, false, true);
        return;
      }
      game.broadcast(io, room, false);
    }
  });
});

server.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`IPL Auction Arena running on http://localhost:${PORT}`);
  console.log(
    `Player database loaded: ${DB.players.length} players (${DB.players.filter((p) => p.legend).length} optional legends)`,
  );
});
