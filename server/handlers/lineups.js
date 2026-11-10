module.exports = function registerHandlers({
  socket,
  onAction,
  io,
  game,
  getRoomAndUser,
  verifyHost,
  emitError,
  setNotice,
}) {
  onAction("host:startLineups", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== "auctionResults")
      return;
    const short = room.users.filter((u) => !game.findBestLegalXI(u.squad));
    if (short.length)
      return emitError(
        socket,
        `Every team needs a valid 11-player combination with no more than 4 overseas players and 4 legends. Still short: ${short.map((u) => `${u.teamShort} (${u.squad.length} players, ${u.squad.filter((p) => p.overseas).length} overseas, ${u.squad.filter((p) => p.legend).length} legends)`).join(", ")}.`,
      );
    room.tradeOffers = [];
    room.phase = "lineup";
    for (const u of room.users) {
      const selected = game.findBestLegalXI(u.squad) || [];
      // Begin with a sensible batting order, but let each user rearrange it.
      u.lineup = [...selected]
        .sort(
          (a, b) =>
            (b.batting || 0) - (a.batting || 0) || (b.ovr || 0) - (a.ovr || 0),
        )
        .map((p) => p.id);
      // The best five bowling ratings among the selected XI are the default bowling unit.
      const rolePriority = (player) =>
        player.role === "Bowler" ? 2 : player.role === "All-rounder" ? 1 : 0;
      u.bowlerIds = [...selected]
        .sort(
          (a, b) =>
            (b.bowling || 0) - (a.bowling || 0) ||
            (b.ovr || 0) - (a.ovr || 0) ||
            rolePriority(b) - rolePriority(a),
        )
        .slice(0, 5)
        .map((p) => p.id);
      u.xiReady = false;
    }
    room.lastNotice = { kind: "lineup", text: "Select your starting XI." };
    game.broadcast(io, room);
  });

  onAction("lineup:set", (payload, acknowledgement) => {
    const { room, user } = getRoomAndUser(socket);
    const reject = (message) => {
      emitError(socket, message);
      if (typeof acknowledgement === "function")
        acknowledgement({ ok: false, message });
    };
    if (!room || !user || room.phase !== "lineup")
      return reject("Playing XI selection is not open.");

    // Accept the old array payload during a rolling refresh, while the current UI
    // sends both the batting order and the five selected bowlers.
    const playerIds = Array.isArray(payload) ? payload : payload?.playerIds;
    if (!Array.isArray(playerIds)) return reject("Invalid playing XI.");
    const unique = [...new Set(playerIds.map(String))];
    if (unique.length !== 11 || playerIds.length !== 11)
      return reject("Select exactly 11 different players.");
    if (unique.some((id) => !user.squad.some((p) => p.id === id)))
      return reject("Your playing XI can only contain players in your squad.");
    const overseasCount = user.squad.filter(
      (p) => unique.includes(p.id) && p.overseas,
    ).length;
    if (overseasCount > 4)
      return reject(
        "An IPL playing XI can contain at most 4 overseas players.",
      );
    const legendCountInXI = user.squad.filter(
      (p) => unique.includes(p.id) && p.legend,
    ).length;
    if (legendCountInXI > game.MAX_LEGENDS_XI) {
      const purchaseLimit =
        room.settings.legendAuctionLimit === "unlimited"
          ? "any number of"
          : `up to ${game.getLegendAuctionLimit(room.settings)}`;
      return reject(
        `Your playing XI can contain at most ${game.MAX_LEGENDS_XI} legends. Your auction purchase limit is ${purchaseLimit} legends.`,
      );
    }

    const suppliedBowlerIds = Array.isArray(payload)
      ? null
      : payload?.bowlerIds;
    const fallbackBowlerIds = [...user.squad]
      .filter((p) => unique.includes(p.id))
      .sort(
        (a, b) =>
          (b.bowling || 0) - (a.bowling || 0) || (b.ovr || 0) - (a.ovr || 0),
      )
      .slice(0, 5)
      .map((p) => p.id);
    const bowlerIds = Array.isArray(suppliedBowlerIds)
      ? suppliedBowlerIds.map(String)
      : fallbackBowlerIds;
    const uniqueBowlers = [...new Set(bowlerIds)];
    if (bowlerIds.length !== 5 || uniqueBowlers.length !== 5)
      return reject("Choose exactly five bowlers.");
    if (uniqueBowlers.some((id) => !unique.includes(id)))
      return reject("Your bowling unit must be chosen from your playing XI.");

    const suppliedTactics =
      payload &&
      !Array.isArray(payload) &&
      payload.tactics &&
      typeof payload.tactics === "object"
        ? payload.tactics
        : {};
    const choose = (key, allowed, fallback) =>
      allowed.includes(suppliedTactics[key]) ? suppliedTactics[key] : fallback;
    user.lineup = unique;
    user.bowlerIds = uniqueBowlers;
    user.tactics = {
      fielding: choose(
        "fielding",
        ["aggressive", "balanced", "conservative"],
        game.DEFAULT_TACTICS.fielding,
      ),
      bowling: choose(
        "bowling",
        ["powerplay", "balanced", "death"],
        game.DEFAULT_TACTICS.bowling,
      ),
      batting: choose(
        "batting",
        ["powerplay", "buildup", "finish"],
        game.DEFAULT_TACTICS.batting,
      ),
    };
    user.xiReady = false;
    game.broadcast(io, room, false);
    if (typeof acknowledgement === "function") acknowledgement({ ok: true });
  });

  onAction("lineup:ready", (ready, acknowledgement) => {
    const { room, user } = getRoomAndUser(socket);
    const reject = (message) => {
      emitError(socket, message);
      if (typeof acknowledgement === "function")
        acknowledgement({ ok: false, message });
    };
    if (!room || !user || room.phase !== "lineup")
      return reject("Playing XI selection is not open.");
    if (ready) {
      if (user.lineup.length !== 11 || new Set(user.lineup).size !== 11)
        return reject("Select exactly 11 different players first.");
      if (
        user.squad.filter((p) => user.lineup.includes(p.id) && p.overseas)
          .length > 4
      )
        return reject(
          "An IPL playing XI can contain at most 4 overseas players.",
        );
      if (
        user.squad.filter((p) => user.lineup.includes(p.id) && p.legend)
          .length > game.MAX_LEGENDS_XI
      )
        return reject(
          `Your playing XI can contain at most ${game.MAX_LEGENDS_XI} legends.`,
        );
      if (
        !Array.isArray(user.bowlerIds) ||
        user.bowlerIds.length !== 5 ||
        new Set(user.bowlerIds).size !== 5 ||
        user.bowlerIds.some((id) => !user.lineup.includes(id))
      )
        return reject("Select exactly five bowlers from your playing XI.");
      const tactics = user.tactics || game.DEFAULT_TACTICS;
      if (
        !["aggressive", "balanced", "conservative"].includes(
          tactics.fielding,
        ) ||
        !["powerplay", "balanced", "death"].includes(tactics.bowling) ||
        !["powerplay", "buildup", "finish"].includes(tactics.batting)
      )
        return reject("Choose valid match tactics before getting ready.");
    }
    user.xiReady = Boolean(ready);
    game.broadcast(io, room);
    if (typeof acknowledgement === "function") acknowledgement({ ok: true });
  });
};
