const fs = require("node:fs");
const path = require("node:path");

// Checkpoints are optional and local. Only serializable game state is stored;
// timers, open sockets, and cached network snapshots are reconstructed on load.
function createCheckpointStore({ enabled, directory }) {
  function fileFor(code) {
    if (!/^[A-Z2-9]{5}$/.test(code))
      throw new Error("Invalid checkpoint room code");
    return path.join(directory, `${code}.json`);
  }

  function save(room) {
    if (!enabled || room.destroyed) return true;
    const savedAt = Date.now();
    const data = { ...room };
    for (const key of [
      "auctionTimeout",
      "nextLotTimeout",
      "tickInterval",
      "liveTimeouts",
      "saveCheckpoint",
      "publicFieldVersions",
    ])
      delete data[key];
    data.users = room.users.map(({ socketId, ...user }) => ({
      ...user,
      connected: false,
    }));
    data.recentBidActions = [...(room.recentBidActions || new Map())];
    data.publicVersion = 0;
    if (room.phase === "auction" && !room.auctionPaused && room.currentLot) {
      data.auctionRemainingMs = Math.max(
        0,
        (room.auctionEndsAt || savedAt) - savedAt,
      );
    }
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const target = fileFor(room.code);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, savedAt, room: data }),
        { mode: 0o600 },
      );
      fs.renameSync(temporary, target);
      return true;
    } catch (error) {
      console.error(
        `Checkpoint for room ${room.code} could not be saved: ${error.message}`,
      );
      return false;
    }
  }

  function remove(code) {
    if (!enabled) return;
    try {
      fs.rmSync(fileFor(code), { force: true });
    } catch (error) {
      console.error(
        `Checkpoint for room ${code} could not be removed: ${error.message}`,
      );
    }
  }

  function load(maxAgeMs) {
    if (!enabled || !fs.existsSync(directory)) return [];
    const result = [];
    for (const name of fs.readdirSync(directory)) {
      if (!/^[A-Z2-9]{5}\.json$/.test(name)) continue;
      try {
        const saved = JSON.parse(
          fs.readFileSync(path.join(directory, name), "utf8"),
        );
        if (
          saved.version !== 1 ||
          !saved.room ||
          saved.room.code !== name.slice(0, 5) ||
          !Array.isArray(saved.room.users)
        )
          throw new Error("Invalid checkpoint");
        if (
          !Number.isFinite(saved.savedAt) ||
          Date.now() - saved.savedAt > maxAgeMs
        ) {
          remove(saved.room.code);
          continue;
        }
        const room = saved.room;
        room.users = room.users.map((user) => ({
          ...user,
          connected: false,
          socketId: null,
        }));
        room.recentBidActions = new Map(
          Array.isArray(room.recentBidActions) ? room.recentBidActions : [],
        );
        room.auctionTimeout = null;
        room.nextLotTimeout = null;
        room.tickInterval = null;
        room.liveTimeouts = [];
        room.publicVersion = 0;
        room.publicFieldVersions = null;
        room.emptySince = Date.now();
        room.destroyed = false;
        if (room.phase === "auction") {
          room.auctionPaused = true;
          room.auctionEndsAt = null;
          room.lastNotice = {
            kind: "recovered",
            text: "The auction was restored and paused. The host can resume it.",
          };
        }
        if (["league", "playoffs", "final"].includes(room.phase)) {
          room.simulationPaused = true;
          room.lastNotice = {
            kind: "recovered",
            text: "The tournament was restored. The host can resume the simulation.",
          };
        }
        result.push(room);
      } catch (error) {
        console.error(`Skipping checkpoint ${name}: ${error.message}`);
      }
    }
    return result;
  }
  return { enabled, save, remove, load };
}

module.exports = { createCheckpointStore };
