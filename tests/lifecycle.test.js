const { test } = require("node:test");
const assert = require("node:assert/strict");
const { expireInactiveRooms } = require("../server/roomLifecycle");

test("only disconnected rooms past the grace period expire", () => {
  const old = { users: [{ connected: false }], emptySince: 100 };
  const recent = { users: [{ connected: false }], emptySince: 950 };
  const active = { users: [{ connected: true }], emptySince: 100 };
  const rooms = new Map([
    ["OLD", old],
    ["RECENT", recent],
    ["ACTIVE", active],
  ]);
  const cleaned = [];
  const removed = [];
  const expired = expireInactiveRooms(rooms, {
    now: 1000,
    idleMs: 500,
    cleanupTimers: (room) => cleaned.push(room),
    removeCheckpoint: (code) => removed.push(code),
  });
  assert.deepEqual(expired, ["OLD"]);
  assert.equal(old.destroyed, true);
  assert.deepEqual(cleaned, [old]);
  assert.deepEqual(removed, ["OLD"]);
  assert.ok(rooms.has("RECENT") && rooms.has("ACTIVE"));
});
