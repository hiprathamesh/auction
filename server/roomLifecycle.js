function expireInactiveRooms(
  rooms,
  { now, idleMs, cleanupTimers, removeCheckpoint },
) {
  const expired = [];
  for (const [code, room] of rooms) {
    if (
      !room.emptySince ||
      now - room.emptySince < idleMs ||
      room.users.some((user) => user.connected)
    )
      continue;
    room.destroyed = true;
    cleanupTimers(room);
    rooms.delete(code);
    removeCheckpoint(code);
    expired.push(code);
  }
  return expired;
}

module.exports = { expireInactiveRooms };
