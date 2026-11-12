const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ID_PATTERN = /^[a-z][a-z0-9]{3,31}$/;
const validPin = (pin) => typeof pin === "string" && /^\d{4}$/.test(pin);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "arena_session";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function createIdentityStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, pin_hash BLOB NOT NULL, salt BLOB NOT NULL,
      created_at INTEGER NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    PRAGMA foreign_keys=ON;`);
  let lastCleanup = 0;
  function cleanup() {
    if (Date.now() - lastCleanup < 60 * 60 * 1000) return;
    lastCleanup = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(lastCleanup);
  }
  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function verifyPin(row, pin, now, incorrectMessage) {
    if (row.locked_until > now)
      return {
        error: "Too many PIN attempts. Try again in 15 minutes.",
        status: 429,
      };
    const candidate = crypto.scryptSync(pin, row.salt, 64);
    if (!crypto.timingSafeEqual(candidate, row.pin_hash)) {
      const attempts = row.failed_attempts + 1;
      db.prepare(
        "UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?",
      ).run(
        attempts >= 5 ? 0 : attempts,
        attempts >= 5 ? now + 15 * 60 * 1000 : 0,
        row.id,
      );
      return { error: incorrectMessage, status: 401 };
    }
    return null;
  }
  function identify(id, pin) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) || !validPin(pin))
      return {
        error:
          "Use an ID starting with a letter (4–32 lowercase letters or digits) and a 4-digit PIN.",
        status: 400,
      };
    cleanup();
    return transaction(() => {
      const now = Date.now();
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (row) {
        const failure = verifyPin(row, pin, now, "ID or PIN is incorrect.");
        if (failure) return failure;
        db.prepare(
          "UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=?",
        ).run(id);
      } else {
        const salt = crypto.randomBytes(32);
        const pinHash = crypto.scryptSync(pin, salt, 64);
        db.prepare(
          "INSERT INTO users (id,pin_hash,salt,created_at) VALUES (?,?,?,?)",
        ).run(id, pinHash, salt, now);
      }
      const token = crypto.randomBytes(32).toString("base64url");
      db.prepare(
        "INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)",
      ).run(hash(token), id, now, now + SESSION_MS);
      return { id, token };
    });
  }
  function changePin(id, currentPin, newPin) {
    if (!validPin(currentPin) || !validPin(newPin))
      return { error: "Enter a four-digit PIN in both fields.", status: 400 };
    return transaction(() => {
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      if (!row) return { error: "Identify yourself to continue.", status: 401 };
      const failure = verifyPin(
        row,
        currentPin,
        Date.now(),
        "Current PIN is incorrect.",
      );
      if (failure) return failure;
      const salt = crypto.randomBytes(32);
      const pinHash = crypto.scryptSync(newPin, salt, 64);
      db.prepare(
        "UPDATE users SET pin_hash=?, salt=?, failed_attempts=0, locked_until=0 WHERE id=?",
      ).run(pinHash, salt, id);
      return { ok: true };
    });
  }
  function tokenFromCookie(header = "") {
    return (
      header
        .split(";")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1) || ""
    );
  }
  function session(header = "") {
    const token = tokenFromCookie(header);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    cleanup();
    const row = db
      .prepare(
        "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(hash(token), Date.now());
    return row?.user_id || null;
  }
  function logout(header = "") {
    const token = tokenFromCookie(header);
    if (token)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
  }
  function exists(id) {
    return Boolean(db.prepare("SELECT 1 FROM users WHERE id=?").get(id));
  }
  return {
    identify,
    changePin,
    session,
    logout,
    exists,
    close: () => db.close(),
  };
}

module.exports = { createIdentityStore, COOKIE, SESSION_MS, ID_PATTERN };
