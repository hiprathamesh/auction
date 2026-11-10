const { test } = require("node:test");
const assert = require("node:assert/strict");
const game = require("../server/game");
const database = require("../data/players.json");

test("an ordinary bid update is much smaller than a late-auction snapshot", (t) => {
  const room = game.createRoom(
    "TEST1",
    { id: "u0", name: "Host", teamId: "CSK" },
    database,
  );
  room.users = game.FRANCHISES.map((team, index) => ({
    id: `u${index}`,
    name: `User ${index}`,
    teamId: team.id,
    teamName: team.name,
    teamShort: team.short,
    teamColor: team.color,
    squad: database.players.slice(index * 25, index * 25 + 25),
    purse: 10,
    lineup: [],
    bowlerIds: [],
    connected: true,
  }));
  room.phase = "auction";
  room.auctionEndsAt = Date.now() + 10000;
  room.currentLot = {
    id: "lot-1",
    player: database.players[300],
    set: database.players[300].set,
    basePrice: 1,
    currentBid: 1,
    currentBidderId: null,
    lotNumber: 251,
    totalLots: 340,
  };
  room.sold = room.users.flatMap((manager) =>
    manager.squad.map((player, index) => ({
      player,
      price: 1,
      userId: manager.id,
      teamName: manager.teamName,
      lotNumber: index + 1,
    })),
  );
  const events = [];
  const io = {
    to: () => ({ emit: (name, value) => events.push({ name, value }) }),
  };
  game.broadcast(io, room, false);
  const full = events.find((event) => event.name === "room:update");
  room.currentLot.currentBidderId = "u0";
  room.currentLot.currentBid = 1.5;
  game.broadcast(io, room, false);
  const patch = events.find((event) => event.name === "room:patch");
  const fullBytes = Buffer.byteLength(JSON.stringify(full.value));
  const patchBytes = Buffer.byteLength(JSON.stringify(patch.value));
  t.diagnostic(
    `Synthetic ten-team snapshot: ${fullBytes} bytes; bid patch: ${patchBytes} bytes.`,
  );
  assert.ok(
    patchBytes < fullBytes / 10,
    `snapshot ${fullBytes} bytes, patch ${patchBytes} bytes`,
  );
});
