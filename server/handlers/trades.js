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
  onAction("trade:propose", ({ toUserId, myPlayerId, theirPlayerId } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (
      !room ||
      !user ||
      room.phase !== "auctionResults" ||
      !room.settings.tradesEnabled
    )
      return emitError(socket, "Trading is not open.");
    const other = room.users.find((u) => u.id === toUserId && u.id !== user.id);
    if (!other) return emitError(socket, "Choose another team to trade with.");
    if (!other.connected) return emitError(socket, "That team is offline.");
    if (
      (user.tradesUsed || 0) >= room.settings.tradeLimit ||
      (other.tradesUsed || 0) >= room.settings.tradeLimit
    )
      return emitError(
        socket,
        "One team has reached its completed-trade limit.",
      );
    if (
      !user.squad.some((p) => p.id === myPlayerId) ||
      !other.squad.some((p) => p.id === theirPlayerId)
    )
      return emitError(
        socket,
        "One of these players is no longer owned by the selected team.",
      );
    if (
      room.tradeOffers.some(
        (o) =>
          o.status === "pending" &&
          (o.fromId === user.id ||
            o.toId === user.id ||
            o.fromId === other.id ||
            o.toId === other.id),
      )
    )
      return emitError(
        socket,
        "One of the teams already has a pending trade. Respond to or cancel that offer first.",
      );
    room.tradeOffers.push({
      id: require("crypto").randomUUID(),
      fromId: user.id,
      toId: other.id,
      myPlayerId,
      theirPlayerId,
      status: "pending",
      createdAt: Date.now(),
    });
    room.lastNotice = {
      kind: "tradeOffer",
      text: `${user.teamShort} proposed a player trade to ${other.teamShort}.`,
    };
    game.broadcast(io, room);
  });

  onAction("trade:respond", ({ offerId, accept } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== "auctionResults")
      return emitError(socket, "Trading is not open.");
    const offer = room.tradeOffers.find(
      (o) => o.id === offerId && o.status === "pending",
    );
    if (!offer || (user.id !== offer.toId && user.id !== offer.fromId))
      return emitError(
        socket,
        "Trade offer not found or not addressed to you.",
      );
    if (user.id === offer.fromId && accept)
      return emitError(socket, "Only the receiving team can accept a trade.");
    const proposer = room.users.find((u) => u.id === offer.fromId);
    const receiver = room.users.find((u) => u.id === offer.toId);
    if (!accept) {
      room.tradeOffers = room.tradeOffers.filter((o) => o.id !== offer.id);
      room.lastNotice = {
        kind: "tradeDeclined",
        text: `${user.teamShort} ${user.id === offer.fromId ? "cancelled" : "declined"} a trade offer.`,
      };
      return game.broadcast(io, room);
    }
    if (!room.settings.tradesEnabled || !proposer || !receiver)
      return emitError(socket, "This trade is no longer available.");
    if (
      (proposer.tradesUsed || 0) >= room.settings.tradeLimit ||
      (receiver.tradesUsed || 0) >= room.settings.tradeLimit
    )
      return emitError(socket, "A team has reached the trade limit.");
    const mine = proposer.squad.find((p) => p.id === offer.myPlayerId);
    const theirs = receiver.squad.find((p) => p.id === offer.theirPlayerId);
    if (!mine || !theirs) {
      room.tradeOffers = room.tradeOffers.filter((o) => o.id !== offer.id);
      return emitError(socket, "The proposed players are no longer available.");
    }
    const newProposerSquad = proposer.squad
      .filter((p) => p.id !== mine.id)
      .concat(theirs);
    const newReceiverSquad = receiver.squad
      .filter((p) => p.id !== theirs.id)
      .concat(mine);
    const legalSquad = (squad) =>
      squad.length <= game.MAX_SQUAD &&
      squad.filter((p) => p.overseas).length <= game.MAX_OVERSEAS &&
      squad.filter((p) => p.legend).length <=
        game.getLegendAuctionLimit(room.settings) &&
      Boolean(game.findBestLegalXI(squad));
    if (!legalSquad(newProposerSquad) || !legalSquad(newReceiverSquad))
      return emitError(
        socket,
        "The exchange would leave a team without a legal XI or exceed its squad, overseas, or legend limit.",
      );
    // Atomic swap: update both squads only after every condition passes.
    proposer.squad = newProposerSquad;
    receiver.squad = newReceiverSquad;
    // Update current ownership in sales records. Host removal/re-auction uses
    // these records, so it must recover who owns a player NOW after exchanges.
    for (const sale of room.sold) {
      if (sale.player.id === mine.id) {
        sale.userId = receiver.id;
        sale.teamName = receiver.teamName;
      } else if (sale.player.id === theirs.id) {
        sale.userId = proposer.id;
        sale.teamName = proposer.teamName;
      }
    }
    proposer.tradesUsed = (proposer.tradesUsed || 0) + 1;
    receiver.tradesUsed = (receiver.tradesUsed || 0) + 1;
    room.tradeOffers = room.tradeOffers.filter((o) => o.id !== offer.id);
    room.trades.push({
      id: offer.id,
      fromId: proposer.id,
      toId: receiver.id,
      fromTeam: proposer.teamShort,
      toTeam: receiver.teamShort,
      fromPlayer: mine.name,
      toPlayer: theirs.name,
    });
    room.lastNotice = {
      kind: "tradeAccepted",
      text: `${proposer.teamShort} traded ${mine.name} to ${receiver.teamShort} for ${theirs.name}.`,
    };
    game.broadcast(io, room);
  });
};
