function readStorage(type, key) {
  try {
    return window[type].getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(type, key, value) {
  try {
    if (value === null) window[type].removeItem(key);
    else window[type].setItem(key, value);
  } catch {
    // The room remains recoverable by a verified identity if storage is blocked.
  }
}

const sessionKey = (code) => `iplRoomSession:${code}`;
const replacementKey = (code) => `iplRoomReplaced:${code}`;
const hasSeatCredentials = (session) =>
  typeof session?.userId === "string" &&
  session.userId.length > 0 &&
  typeof session.reconnectToken === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(session.reconnectToken);

function storedRoomSession(storage, code) {
  try {
    const session = JSON.parse(readStorage(storage, sessionKey(code)));
    return hasSeatCredentials(session) ? session : null;
  } catch {
    return null;
  }
}

export function initialRoomCode() {
  const urlCode = new URLSearchParams(window.location.search).get("room");
  return (
    urlCode ||
    readStorage("sessionStorage", "iplRoomCode") ||
    readStorage("localStorage", "iplRoomCode") ||
    ""
  )
    .trim()
    .toUpperCase();
}

export function readRoomSession(code) {
  for (const storage of ["localStorage", "sessionStorage"]) {
    const session = storedRoomSession(storage, code);
    if (session) return session;
  }
  if (readStorage("localStorage", "iplRoomCode") === code) {
    const userId = readStorage("localStorage", "iplUserId");
    const reconnectToken = readStorage("localStorage", "iplReconnectToken");
    if (hasSeatCredentials({ userId, reconnectToken }))
      return {
        userId,
        reconnectToken,
        hostRecoveryToken:
          readStorage("localStorage", "iplHostRecoveryToken") || undefined,
      };
  }
  return null;
}

export function saveRoomSession(code, session) {
  for (const storage of ["sessionStorage", "localStorage"]) {
    writeStorage(storage, "iplRoomCode", code);
    writeStorage(storage, sessionKey(code), JSON.stringify(session));
  }
  // Keep the legacy fields available for clients and releases using the old format.
  writeStorage("localStorage", "iplUserId", session.userId);
  writeStorage("localStorage", "iplReconnectToken", session.reconnectToken);
  writeStorage(
    "localStorage",
    "iplHostRecoveryToken",
    session.hostRecoveryToken || null,
  );
  writeStorage("sessionStorage", replacementKey(code), null);
}

export function forgetRoomSession(code, userId) {
  for (const storage of ["localStorage", "sessionStorage"]) {
    const saved = storedRoomSession(storage, code);
    if (saved?.userId === userId) writeStorage(storage, sessionKey(code), null);
    if (
      (!saved || saved.userId === userId) &&
      readStorage(storage, "iplRoomCode") === code
    )
      writeStorage(storage, "iplRoomCode", null);
  }
  if (readStorage("localStorage", "iplUserId") === userId) {
    writeStorage("localStorage", "iplUserId", null);
    writeStorage("localStorage", "iplReconnectToken", null);
    writeStorage("localStorage", "iplHostRecoveryToken", null);
  }
}

export function markSeatReplaced(code) {
  writeStorage("sessionStorage", replacementKey(code), "1");
}

export function wasSeatReplaced(code) {
  return readStorage("sessionStorage", replacementKey(code)) === "1";
}

export function setRoomUrl(code) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  url.searchParams.delete("identity");
  if (url.href !== window.location.href)
    window.history.replaceState(null, "", url);
}
