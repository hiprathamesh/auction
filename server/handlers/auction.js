module.exports = function registerHandlers({
  socket,
  onAction,
  io,
  game,
  getRoomAndUser,
  hasSeatIdentity,
  verifyHost,
  emitError,
  setNotice,
}) {
  onAction(
    "auction:bid",
    (
      {
        multiplier: requestedMultiplier = 1,
        lotId,
        expectedBid,
        actionId,
      } = {},
      acknowledgement,
    ) => {
      const { room, user } = getRoomAndUser(socket);
      const reject = (message) => {
        emitError(socket, message);
        if (typeof acknowledgement === "function")
          acknowledgement({ ok: false, message });
      };
      if (!room || !user) return reject("Rejoin the room to bid.");
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(actionId))
        return reject("Invalid bid action.");
      room.recentBidActions ||= new Map();
      const actionKey = `${user.id}:${actionId}`;
      if (room.recentBidActions.has(actionKey)) {
        if (typeof acknowledgement === "function")
          acknowledgement(room.recentBidActions.get(actionKey));
        return;
      }
      if (room.phase !== "auction" || room.auctionPaused || !room.currentLot)
        return reject("Bidding is not open right now.");
      const lot = room.currentLot;
      if (lot.id !== lotId)
        return reject(
          "The auction lot has changed. Review the current player before bidding.",
        );
      if (!room.auctionEndsAt || Date.now() >= room.auctionEndsAt)
        return reject("This lot has closed.");
      if (lot.currentBidderId === user.id)
        return reject("You are already the highest bidder.");
      if ((lot.outUserIds || []).includes(user.id))
        return reject(
          "You are out for this player and cannot bid again until the next lot.",
        );
      if (user.squad.length >= game.MAX_SQUAD)
        return reject("Your squad is full (25 players).");
      if (
        lot.player.legend &&
        user.squad.filter((p) => p.legend).length >=
          game.getLegendAuctionLimit(room.settings)
      ) {
        const limit =
          room.settings.legendAuctionLimit === "unlimited"
            ? "unlimited"
            : game.getLegendAuctionLimit(room.settings);
        return reject(
          `Your squad has reached the ${limit}-legend auction limit.`,
        );
      }
      if (
        lot.player.overseas &&
        user.squad.filter((p) => p.overseas).length >= game.MAX_OVERSEAS
      )
        return reject("Your squad has reached the 8-player overseas limit.");
      const multiplier = Number(requestedMultiplier);
      if (
        multiplier !== 1 &&
        !(room.settings.bidMultipliers || []).includes(multiplier)
      )
        return reject("This bid multiplier is not enabled by the host.");
      const bid = game.calculateBidAmount(lot, multiplier);
      if (Math.abs(bid - expectedBid) > 1e-6)
        return reject(
          "The bid price changed. Review the updated amount and bid again.",
        );
      if (lot.currentBidderId ? bid <= lot.currentBid : bid < lot.basePrice)
        return reject(
          "Your bid must be at least the base price and higher than any existing bid.",
        );
      if (user.purse + 1e-6 < bid)
        return reject(
          `You need ₹${bid.toFixed(2)} Cr to bid at ${multiplier}x.`,
        );
      lot.currentBid = bid;
      lot.currentBidderId = user.id;
      const accepted = { ok: true, lotId: lot.id, amount: bid };
      room.recentBidActions.set(actionKey, accepted);
      if (room.recentBidActions.size > 256)
        room.recentBidActions.delete(room.recentBidActions.keys().next().value);
      let rtmInvalidated = false;
      if (lot.rtmOptInUserId) {
        const rtmHolder = room.users.find(
          (candidate) => candidate.id === lot.rtmOptInUserId,
        );
        if (
          !rtmHolder ||
          !game.canUserAcquirePlayer(rtmHolder, lot.player, bid, room.settings)
        ) {
          lot.rtmOptInUserId = null;
          rtmInvalidated = true;
        }
      }
      if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
      room.auctionEndsAt = Date.now() + room.settings.bidSeconds * 1000;
      room.auctionRemainingMs = room.settings.bidSeconds * 1000;
      room.auctionTimeout = setTimeout(
        () => game.settleLot(io, room, false),
        room.settings.bidSeconds * 1000,
      );
      const rtmInvalidatedText =
        rtmInvalidated && room.settings.rtmPublicStatus !== false
          ? " Right to Match was switched off because the RTM holder can no longer afford the new price."
          : "";
      setNotice(room, {
        kind: "bid",
        text: `${user.teamName} bid ₹${bid.toFixed(2)} Cr for ${lot.player.name}${multiplier > 1 ? ` (${multiplier}x bid)` : ""}.${rtmInvalidatedText}`,
        playerName: lot.player.name,
        teamName: user.teamName,
        price: bid,
      });
      if (game.shouldFastSettleLot(room)) {
        game.settleLot(io, room, false, true);
        if (typeof acknowledgement === "function") acknowledgement(accepted);
        return;
      }
      game.broadcast(io, room, true, true);
      if (typeof acknowledgement === "function") acknowledgement(accepted);
    },
  );

  onAction("auction:rtmToggle", ({ enabled, lotId } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user)
      return emitError(socket, "Rejoin the room to use Right to Match.");
    if (room.phase !== "auction" || !room.currentLot)
      return emitError(
        socket,
        "Right to Match is only available while a player is being auctioned.",
      );
    if (
      !room.auctionPaused &&
      room.auctionEndsAt &&
      Date.now() >= room.auctionEndsAt
    )
      return emitError(
        socket,
        "This lot has closed; Right to Match can no longer be changed.",
      );
    if (!room.settings.rtmEnabled)
      return emitError(socket, "Right to Match is disabled for this auction.");
    const lot = room.currentLot;
    if (lot.id !== lotId)
      return emitError(socket, "The auction lot has changed.");
    if (
      lot.rtmHolderUserId !== user.id ||
      !game.hasRtmRight(room, user, lot.player)
    ) {
      return emitError(
        socket,
        "You do not hold the Right to Match for this player.",
      );
    }
    if (room.previousSeason !== undefined && !hasSeatIdentity(socket, user))
      return emitError(socket, "Identify yourself to use Right to Match.");
    const currentState = lot.rtmOptInUserId === user.id;
    const nextState = Boolean(enabled);
    const hasOptedOut =
      Array.isArray(lot.outUserIds) && lot.outUserIds.includes(user.id);
    // Opting out is a final decision for this lot. An opted-out user may turn
    // a stale RTM state OFF, but can never arm RTM again until the next player.
    if (nextState && hasOptedOut) {
      return emitError(
        socket,
        "You are already OUT for this player. You cannot activate Right to Match again until the next lot.",
      );
    }
    if (!nextState) {
      if (currentState) {
        lot.rtmOptInUserId = null;
        room.lastNotice = null;
        game.broadcast(io, room, false, true);
      }
      return;
    }
    if (currentState) return;
    if (game.roomRtmUsesRemaining(user, room.settings) <= 0)
      return emitError(
        socket,
        "Your team has used all its Right to Match opportunities.",
      );
    if (
      !game.canUserAcquirePlayer(
        user,
        lot.player,
        lot.currentBid,
        room.settings,
      )
    ) {
      return emitError(
        socket,
        "Your team cannot currently afford or legally acquire this player at the current bid.",
      );
    }
    lot.rtmOptInUserId = user.id;
    room.lastNotice = null;
    game.broadcast(io, room, false, true);
  });

  onAction("auction:out", ({ lotId } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user)
      return emitError(socket, "Rejoin the room to use this action.");
    if (room.phase !== "auction" || room.auctionPaused || !room.currentLot) {
      return emitError(socket, "You can only opt out while bidding is open.");
    }

    const lot = room.currentLot;
    if (lot.id !== lotId)
      return emitError(socket, "The auction lot has changed.");
    if (!room.auctionEndsAt || Date.now() >= room.auctionEndsAt)
      return emitError(socket, "This lot has closed.");
    if (lot.currentBidderId === user.id) {
      return emitError(
        socket,
        "You cannot opt out while you are the highest bidder.",
      );
    }
    if (lot.rtmOptInUserId === user.id) {
      return emitError(
        socket,
        "Your Right to Match is ON. Turn it OFF before opting out.",
      );
    }
    if (!Array.isArray(lot.outUserIds)) lot.outUserIds = [];
    if (lot.outUserIds.includes(user.id)) {
      return emitError(socket, "You are already out for this player.");
    }

    lot.outUserIds.push(user.id);
    const allTeamsOutWithoutABid =
      !lot.currentBidderId &&
      room.users.length > 0 &&
      room.users.every((roomUser) => lot.outUserIds.includes(roomUser.id));

    if (allTeamsOutWithoutABid) {
      // Settle now instead of leaving an entirely unwanted player on the timer.
      game.settleLot(io, room, false);
      return;
    }

    setNotice(room, {
      kind: "out",
      text: `${user.teamName} is out of bidding for ${lot.player.name}.`,
      playerName: lot.player.name,
      teamName: user.teamName,
    });
    if (game.shouldFastSettleLot(room)) {
      game.settleLot(io, room, false, true);
      return;
    }
    game.broadcast(io, room);
  });

  onAction("host:pauseAuction", () => {
    const { room, user } = getRoomAndUser(socket);
    if (
      !verifyHost(socket, room, user) ||
      room.phase !== "auction" ||
      room.auctionPaused
    )
      return;
    room.auctionRemainingMs = Math.max(
      0,
      (room.auctionEndsAt || Date.now()) - Date.now(),
    );
    if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
    if (room.tickInterval) clearInterval(room.tickInterval);
    if (room.nextLotTimeout) clearTimeout(room.nextLotTimeout);
    room.auctionTimeout = null;
    room.tickInterval = null;
    room.nextLotTimeout = null;
    room.auctionPaused = true;
    setNotice(room, { kind: "pause", text: "Auction paused by host." });
    game.broadcast(io, room);
  });

  onAction("host:resumeAuction", () => {
    const { room, user } = getRoomAndUser(socket);
    if (
      !verifyHost(socket, room, user) ||
      room.phase !== "auction" ||
      !room.auctionPaused
    )
      return;
    room.auctionPaused = false;
    if (room.currentLot) {
      const remaining = Math.max(0, room.auctionRemainingMs || 0);
      room.auctionEndsAt = Date.now() + remaining;
      room.auctionTimeout = setTimeout(
        () => game.settleLot(io, room, false),
        remaining,
      );
    } else {
      game.openNextLot(io, room);
    }
    setNotice(room, { kind: "resume", text: "Auction resumed." });
    if (room.currentLot && game.shouldFastSettleLot(room)) {
      game.settleLot(io, room, false, true);
      return;
    }
    game.broadcast(io, room);
  });

  onAction("host:endAuction", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== "auction") return;
    if (room.nextLotTimeout) clearTimeout(room.nextLotTimeout);
    if (room.currentLot) game.settleLot(io, room, true);
    if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.auctionPaused = false;
    room.phase = "auctionResults";
    room.lastNotice = {
      kind: "auctionStopped",
      text: "The host ended the auction.",
    };
    game.broadcast(io, room);
  });

  onAction("host:continueAuction", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== "auctionResults")
      return;
    if (!room.auctionQueue.length && room.unsold.length) {
      room.auctionQueue = require("../cricket").shuffle(
        room.unsold.map((x) => x.player),
      );
      room.unsold = [];
      room.totalLots += room.auctionQueue.length;
    }
    if (!room.auctionQueue.length)
      return emitError(
        socket,
        "There are no remaining or unsold players to auction.",
      );
    room.tradeOffers = [];
    room.phase = "auction";
    room.currentLot = null;
    room.auctionPaused = false;
    room.lastNotice = { kind: "resume", text: "The auction has resumed." };
    game.openNextLot(io, room);
  });

  // Post-auction trading. Offers cannot move a player without the receiving
  // manager explicitly accepting. Every accepted one-for-one swap consumes
  // one successful-trade slot for BOTH teams, not just the proposer.
};
