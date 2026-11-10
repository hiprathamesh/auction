const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const game = require('./game');
const { makeDoubleRoundRobin } = require('./cricket');

const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 1e6 });
const rooms = new Map();
const socketByUser = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'IPL Auction Arena', playerCount: DB.players.length }));
app.get('/api/teams', (_req, res) => res.json(game.FRANCHISES));
app.get('/api/players/count', (_req, res) => res.json({ count: DB.players.length, legends: DB.players.filter((p) => p.legend).length, sets: DB.setOrder.length }));
app.use(express.static(path.join(ROOT, 'dist'), { maxAge: '1h', etag: true }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'dist', 'index.html'));
});

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function getRoomAndUser(socket) {
  const code = socket.data.roomCode;
  const room = code && rooms.get(code);
  const user = room && room.users.find((u) => u.id === socket.data.userId);
  return { room, user };
}
function emitError(socket, message) { socket.emit('app:error', { message }); }
function verifyHost(socket, room, user) {
  if (!room || !user) { emitError(socket, 'Your room session was not found. Rejoin with the room code.'); return false; }
  if (!game.hostCheck(room, user.id)) { emitError(socket, 'Only the host can do that.'); return false; }
  return true;
}
function joinSocket(socket, room, user) {
  game.assignUser(socket, room, user);
  socket.join(room.code);
  socketByUser.set(user.id, socket.id);
  socket.emit('room:joined', { roomCode: room.code, userId: user.id, hostId: room.hostId, isHost: user.id === room.hostId });
  game.broadcast(io, room);
}
function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').slice(0, 22);
}
function buildUser(name, teamId) {
  const franchise = game.FRANCHISES.find((f) => f.id === teamId);
  if (!franchise) return null;
  return {
    id: require('crypto').randomUUID(), name, teamId: franchise.id, teamName: franchise.name,
    teamShort: franchise.short, teamColor: franchise.color,
  };
}
function setNotice(room, notice) { room.lastNotice = notice; }

io.on('connection', (socket) => {
  socket.emit('app:connected', { ok: true });

  socket.on('room:create', ({ name: rawName, teamId } = {}) => {
    const name = normalizeName(rawName);
    if (name.length < 2) return emitError(socket, 'Choose a display name with at least 2 characters.');
    const user = buildUser(name, teamId);
    if (!user) return emitError(socket, 'Choose an IPL franchise first.');
    const code = makeCode();
    const room = game.createRoom(code, user, DB);
    rooms.set(code, room);
    joinSocket(socket, room, user);
  });

  socket.on('room:join', ({ code: rawCode, name: rawName, teamId, resumeUserId } = {}) => {
    const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (!room) return emitError(socket, 'Room not found. Check the code and make sure the host server is running.');
    if (resumeUserId) {
      const existing = room.users.find((u) => u.id === resumeUserId);
      if (existing) {
        existing.connected = true;
        joinSocket(socket, room, existing);
        return;
      }
    }
    const name = normalizeName(rawName);
    if (name.length < 2) return emitError(socket, 'Choose a display name with at least 2 characters.');
    const user = buildUser(name, teamId);
    if (!user) return emitError(socket, 'Choose an IPL franchise first.');
    const result = game.addUser(room, user);
    if (result.error) return emitError(socket, result.error);
    if (room.phase === 'auction') {
      game.refreshCurrentLotRtmHolder(room);
      setNotice(room, { kind: 'join', text: `${user.name} joined the room mid-auction.` });
    }
    joinSocket(socket, room, user);
  });

  socket.on('room:rejoin', ({ code, userId } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const user = room && room.users.find((u) => u.id === userId);
    if (!room || !user) return emitError(socket, 'Saved session not found. Create a new room or join using the room code.');
    user.connected = true;
    joinSocket(socket, room, user);
  });

  socket.on('host:kickUser', ({ userId } = {}) => {
    const { room, user: host } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, host)) return;
    if (!['lobby', 'auction', 'auctionResults', 'lineup'].includes(room.phase)) {
      return emitError(socket, 'Players can only be removed before the league simulation starts.');
    }

    const target = room.users.find((u) => u.id === String(userId || ''));
    if (!target) return emitError(socket, 'That player is no longer in this room.');
    if (target.id === host.id || target.id === room.hostId) return emitError(socket, 'The host cannot remove themselves.');

    // Return any players bought by this user to the unsold pool so the group can auction them again.
    const recoveredSales = room.sold.filter((sale) => sale.userId === target.id);
    for (const sale of recoveredSales) {
      if (!room.unsold.some((entry) => entry.player?.id === sale.player.id)) {
        room.unsold.push({ player: sale.player, basePrice: sale.player.basePrice, lotNumber: sale.lotNumber });
      }
      const history = room.lotHistory.find((entry) => entry.lotNumber === sale.lotNumber && entry.playerId === sale.player.id);
      if (history) {
        history.result = 'UNSOLD';
        history.teamName = null;
        history.price = null;
      }
    }
    room.sold = room.sold.filter((sale) => sale.userId !== target.id);

    // If the removed user was leading the current lot, cancel their bid and restart the clock.
    if (room.phase === 'auction' && room.currentLot?.currentBidderId === target.id) {
      room.currentLot.currentBidderId = null;
      room.currentLot.currentBid = room.currentLot.basePrice;
      if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
      room.auctionTimeout = null;
      if (room.auctionPaused) {
        room.auctionRemainingMs = Math.max(1000, room.auctionRemainingMs || room.settings.bidSeconds * 1000);
        room.auctionEndsAt = null;
      } else {
        room.auctionRemainingMs = room.settings.bidSeconds * 1000;
        room.auctionEndsAt = Date.now() + room.auctionRemainingMs;
        room.auctionTimeout = setTimeout(() => game.settleLot(io, room, false), room.auctionRemainingMs);
      }
    }

    const removedSocketId = socketByUser.get(target.id);
    const removedSocket = removedSocketId ? io.sockets.sockets.get(removedSocketId) : null;
    if (removedSocket) {
      removedSocket.emit('room:kicked', { message: `The host removed ${target.name} from the room.` });
      removedSocket.leave(room.code);
      removedSocket.data.roomCode = null;
      removedSocket.data.userId = null;
    }
    socketByUser.delete(target.id);

    const recoveredCount = recoveredSales.length;
    const wasLineupPhase = room.phase === 'lineup';
    room.tradeOffers = (room.tradeOffers || []).filter((offer) => offer.fromId !== target.id && offer.toId !== target.id);
    room.users = room.users.filter((u) => u.id !== target.id);
    if (room.currentLot) game.refreshCurrentLotRtmHolder(room);
    if (room.currentLot?.outUserIds) {
      room.currentLot.outUserIds = room.currentLot.outUserIds.filter((id) => id !== target.id);
    }
    target.squad = [];
    target.lineup = [];
    target.bowlerIds = [];
    target.xiReady = false;

    // Removing a team during XI selection invalidates the previous readiness checks.
    // Return everyone to auction results, where the recovered players can be re-auctioned.
    if (room.phase === 'lineup') {
      room.phase = 'auctionResults';
      for (const remainingUser of room.users) {
        remainingUser.lineup = [];
        remainingUser.bowlerIds = [];
        remainingUser.xiReady = false;
      }
    }

    const recoveredMessage = recoveredCount
      ? ` ${recoveredCount} purchased player${recoveredCount === 1 ? '' : 's'} returned to the unsold pool.`
      : '';
    const lineupMessage = wasLineupPhase
      ? ' The room returned to Auction Results and all remaining teams must select their XIs again.'
      : '';
    room.lastNotice = {
      kind: 'userRemoved',
      text: `${target.name} (${target.teamShort}) was removed by the host.${recoveredMessage}${lineupMessage}`,
    };
    if (room.phase === 'auction' && room.currentLot && !room.currentLot.currentBidderId
      && room.users.length > 0
      && room.users.every((roomUser) => (room.currentLot.outUserIds || []).includes(roomUser.id))) {
      game.settleLot(io, room, false);
      return;
    }
    if (game.shouldFastSettleLot(room)) {
      game.settleLot(io, room, false, true);
      return;
    }
    game.broadcast(io, room);
  });

  socket.on('lobby:ready', (ready) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== 'lobby') return;
    user.ready = Boolean(ready);
    setNotice(room, { kind: 'ready', text: `${user.name} ${user.ready ? 'is ready' : 'is not ready'}.` });
    game.broadcast(io, room);
  });

  socket.on('host:settings', (patch = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'lobby') return;
    const allowed = {
      bidSeconds: [5, 10, 15, 20, 30],
      startingPurse: [60, 80, 100, 120, 150, 200],
      includeLegends: [true, false],
      showRatings: [true, false],
      legendAuctionLimit: [4, 5, 6, 7, 8, 'unlimited'],
      rtmEnabled: [true, false],
      rtmUses: [1, 2, 3, 4],
      rtmPublicStatus: [true, false],
      tradesEnabled: [true, false],
      tradeLimit: [1, 2, 3, 4, 5, 6, 8, 10],
    };
    for (const [key, choices] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && choices.includes(patch[key])) room.settings[key] = patch[key];
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'bidMultipliers')) {
      const values = patch.bidMultipliers;
      if (Array.isArray(values) && values.length <= 5 && values.every((v) => game.AVAILABLE_BID_MULTIPLIERS.includes(v)) && new Set(values).size === values.length) {
        room.settings.bidMultipliers = game.AVAILABLE_BID_MULTIPLIERS.filter((v) => values.includes(v));
      }
    }
    for (const u of room.users) u.purse = room.settings.startingPurse;
    setNotice(room, { kind: 'settings', text: 'Auction settings updated.' });
    game.broadcast(io, room);
  });

  socket.on('host:startAuction', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    const result = game.startAuction(io, room, DB);
    if (result.error) return emitError(socket, result.error);
  });

  socket.on('auction:bid', ({ multiplier: requestedMultiplier = 1 } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user) return emitError(socket, 'Rejoin the room to bid.');
    if (room.phase !== 'auction' || room.auctionPaused || !room.currentLot) return emitError(socket, 'Bidding is not open right now.');
    const lot = room.currentLot;
    if (lot.currentBidderId === user.id) return emitError(socket, 'You are already the highest bidder.');
    if ((lot.outUserIds || []).includes(user.id)) return emitError(socket, 'You are out for this player and cannot bid again until the next lot.');
    if (user.squad.length >= game.MAX_SQUAD) return emitError(socket, 'Your squad is full (25 players).');
    if (lot.player.legend && user.squad.filter((p) => p.legend).length >= game.getLegendAuctionLimit(room.settings)) { const limit = room.settings.legendAuctionLimit === 'unlimited' ? 'unlimited' : game.getLegendAuctionLimit(room.settings); return emitError(socket, `Your squad has reached the ${limit}-legend auction limit.`); }
    if (lot.player.overseas && user.squad.filter((p) => p.overseas).length >= game.MAX_OVERSEAS) return emitError(socket, 'Your squad has reached the 8-player overseas limit.');
    const multiplier = Number(requestedMultiplier);
    if (multiplier !== 1 && !(room.settings.bidMultipliers || []).includes(multiplier)) return emitError(socket, 'This bid multiplier is not enabled by the host.');
    const bid = game.calculateBidAmount(lot, multiplier);
    if (lot.currentBidderId ? bid <= lot.currentBid : bid < lot.basePrice) return emitError(socket, 'Your bid must be at least the base price and higher than any existing bid.');
    if (user.purse + 1e-6 < bid) return emitError(socket, `You need ₹${bid.toFixed(2)} Cr to bid at ${multiplier}x.`);
    lot.currentBid = bid;
    lot.currentBidderId = user.id;
    let rtmInvalidated = false;
    if (lot.rtmOptInUserId) {
      const rtmHolder = room.users.find((candidate) => candidate.id === lot.rtmOptInUserId);
      if (!rtmHolder || !game.canUserAcquirePlayer(rtmHolder, lot.player, bid, room.settings)) {
        lot.rtmOptInUserId = null;
        rtmInvalidated = true;
      }
    }
    if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
    room.auctionEndsAt = Date.now() + room.settings.bidSeconds * 1000;
    room.auctionRemainingMs = room.settings.bidSeconds * 1000;
    room.auctionTimeout = setTimeout(() => game.settleLot(io, room, false), room.settings.bidSeconds * 1000);
    const rtmInvalidatedText = rtmInvalidated && room.settings.rtmPublicStatus !== false
      ? ' Right to Match was switched off because the RTM holder can no longer afford the new price.'
      : '';
    setNotice(room, { kind: 'bid', text: `${user.teamName} bid ₹${bid.toFixed(2)} Cr for ${lot.player.name}${multiplier > 1 ? ` (${multiplier}x bid)` : ''}.${rtmInvalidatedText}`, playerName: lot.player.name, teamName: user.teamName, price: bid });
    if (game.shouldFastSettleLot(room)) {
      game.settleLot(io, room, false, true);
      return;
    }
    game.broadcast(io, room, true, true);
  });

  socket.on('auction:rtmToggle', ({ enabled } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user) return emitError(socket, 'Rejoin the room to use Right to Match.');
    if (room.phase !== 'auction' || !room.currentLot) return emitError(socket, 'Right to Match is only available while a player is being auctioned.');
    if (!room.auctionPaused && room.auctionEndsAt && Date.now() >= room.auctionEndsAt) return emitError(socket, 'This lot has closed; Right to Match can no longer be changed.');
    if (!room.settings.rtmEnabled) return emitError(socket, 'Right to Match is disabled for this auction.');
    const lot = room.currentLot;
    if (!lot.rtmHolderUserId || lot.rtmHolderUserId !== user.id || user.teamId !== lot.player.rtmTeamId) {
      return emitError(socket, 'Your franchise does not hold the Right to Match for this player.');
    }
    const currentState = lot.rtmOptInUserId === user.id;
    const nextState = Boolean(enabled);
    const hasOptedOut = Array.isArray(lot.outUserIds) && lot.outUserIds.includes(user.id);
    // Opting out is a final decision for this lot. An opted-out user may turn
    // a stale RTM state OFF, but can never arm RTM again until the next player.
    if (nextState && hasOptedOut) {
      return emitError(socket, 'You are already OUT for this player. You cannot activate Right to Match again until the next lot.');
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
    if (game.roomRtmUsesRemaining(user, room.settings) <= 0) return emitError(socket, 'Your team has used all its Right to Match opportunities.');
    if (!game.canUserAcquirePlayer(user, lot.player, lot.currentBid, room.settings)) {
      return emitError(socket, 'Your team cannot currently afford or legally acquire this player at the current bid.');
    }
    lot.rtmOptInUserId = user.id;
    room.lastNotice = null;
    game.broadcast(io, room, false, true);
  });

  socket.on('auction:out', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user) return emitError(socket, 'Rejoin the room to use this action.');
    if (room.phase !== 'auction' || room.auctionPaused || !room.currentLot) {
      return emitError(socket, 'You can only opt out while bidding is open.');
    }

    const lot = room.currentLot;
    if (lot.currentBidderId === user.id) {
      return emitError(socket, 'You cannot opt out while you are the highest bidder.');
    }
    if (lot.rtmOptInUserId === user.id) {
      return emitError(socket, 'Your Right to Match is ON. Turn it OFF before opting out.');
    }
    if (!Array.isArray(lot.outUserIds)) lot.outUserIds = [];
    if (lot.outUserIds.includes(user.id)) {
      return emitError(socket, 'You are already out for this player.');
    }

    lot.outUserIds.push(user.id);
    const allTeamsOutWithoutABid = !lot.currentBidderId
      && room.users.length > 0
      && room.users.every((roomUser) => lot.outUserIds.includes(roomUser.id));

    if (allTeamsOutWithoutABid) {
      // Settle now instead of leaving an entirely unwanted player on the timer.
      game.settleLot(io, room, false);
      return;
    }

    setNotice(room, {
      kind: 'out',
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

  socket.on('host:pauseAuction', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'auction' || room.auctionPaused) return;
    room.auctionRemainingMs = Math.max(0, (room.auctionEndsAt || Date.now()) - Date.now());
    if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.auctionTimeout = null; room.tickInterval = null; room.auctionPaused = true;
    setNotice(room, { kind: 'pause', text: 'Auction paused by host.' });
    game.broadcast(io, room);
  });

  socket.on('host:resumeAuction', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'auction' || !room.auctionPaused) return;
    room.auctionPaused = false;
    if (room.currentLot) {
      const remaining = Math.max(0, room.auctionRemainingMs || 0);
      room.auctionEndsAt = Date.now() + remaining;
      room.auctionTimeout = setTimeout(() => game.settleLot(io, room, false), remaining);
      room.tickInterval = setInterval(() => {
        if (room.phase === 'auction' && !room.auctionPaused) {
          room.auctionRemainingMs = Math.max(0, room.auctionEndsAt - Date.now());
          game.broadcast(io, room, false);
        }
      }, 350);
    } else {
      game.openNextLot(io, room);
    }
    setNotice(room, { kind: 'resume', text: 'Auction resumed.' });
    if (room.currentLot && game.shouldFastSettleLot(room)) {
      game.settleLot(io, room, false, true);
      return;
    }
    game.broadcast(io, room);
  });

  socket.on('host:endAuction', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'auction') return;
    if (room.nextLotTimeout) clearTimeout(room.nextLotTimeout);
    if (room.currentLot) game.settleLot(io, room, true);
    if (room.auctionTimeout) clearTimeout(room.auctionTimeout);
    if (room.tickInterval) clearInterval(room.tickInterval);
    room.auctionPaused = false;
    room.phase = 'auctionResults';
    room.lastNotice = { kind: 'auctionStopped', text: 'The host ended the auction.' };
    game.broadcast(io, room);
  });

  socket.on('host:continueAuction', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'auctionResults') return;
    if (!room.auctionQueue.length && room.unsold.length) {
      room.auctionQueue = require('./cricket').shuffle(room.unsold.map((x) => x.player));
      room.unsold = [];
      room.totalLots += room.auctionQueue.length;
    }
    if (!room.auctionQueue.length) return emitError(socket, 'There are no remaining or unsold players to auction.');
    room.tradeOffers = [];
    room.phase = 'auction'; room.currentLot = null; room.auctionPaused = false;
    room.lastNotice = { kind: 'resume', text: 'The auction has resumed.' };
    game.openNextLot(io, room);
  });


  // Post-auction trading. Offers cannot move a player without the receiving
  // manager explicitly accepting. Every accepted one-for-one swap consumes
  // one successful-trade slot for BOTH teams, not just the proposer.
  socket.on('trade:propose', ({ toUserId, myPlayerId, theirPlayerId } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== 'auctionResults' || !room.settings.tradesEnabled) return emitError(socket, 'Trading is not open.');
    const other = room.users.find((u) => u.id === toUserId && u.id !== user.id);
    if (!other) return emitError(socket, 'Choose another team to trade with.');
    if (!other.connected) return emitError(socket, 'That team is offline.');
    if ((user.tradesUsed || 0) >= room.settings.tradeLimit || (other.tradesUsed || 0) >= room.settings.tradeLimit) return emitError(socket, 'One team has reached its completed-trade limit.');
    if (!user.squad.some((p) => p.id === myPlayerId) || !other.squad.some((p) => p.id === theirPlayerId)) return emitError(socket, 'One of these players is no longer owned by the selected team.');
    if (room.tradeOffers.some((o) => o.status === 'pending' && (o.fromId === user.id || o.toId === user.id || o.fromId === other.id || o.toId === other.id))) return emitError(socket, 'One of the teams already has a pending trade. Respond to or cancel that offer first.');
    room.tradeOffers.push({ id: require('crypto').randomUUID(), fromId: user.id, toId: other.id, myPlayerId, theirPlayerId, status: 'pending', createdAt: Date.now() });
    room.lastNotice = { kind: 'tradeOffer', text: `${user.teamShort} proposed a player trade to ${other.teamShort}.` };
    game.broadcast(io, room);
  });

  socket.on('trade:respond', ({ offerId, accept } = {}) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== 'auctionResults') return emitError(socket, 'Trading is not open.');
    const offer = room.tradeOffers.find((o) => o.id === offerId && o.status === 'pending');
    if (!offer || (user.id !== offer.toId && user.id !== offer.fromId)) return emitError(socket, 'Trade offer not found or not addressed to you.');
    if (user.id === offer.fromId && accept) return emitError(socket, 'Only the receiving team can accept a trade.');
    const proposer = room.users.find((u) => u.id === offer.fromId);
    const receiver = room.users.find((u) => u.id === offer.toId);
    if (!accept) {
      room.tradeOffers = room.tradeOffers.filter((o) => o.id !== offer.id);
      room.lastNotice = { kind: 'tradeDeclined', text: `${user.teamShort} ${user.id === offer.fromId ? 'cancelled' : 'declined'} a trade offer.` };
      return game.broadcast(io, room);
    }
    if (!room.settings.tradesEnabled || !proposer || !receiver) return emitError(socket, 'This trade is no longer available.');
    if ((proposer.tradesUsed || 0) >= room.settings.tradeLimit || (receiver.tradesUsed || 0) >= room.settings.tradeLimit) return emitError(socket, 'A team has reached the trade limit.');
    const mine = proposer.squad.find((p) => p.id === offer.myPlayerId);
    const theirs = receiver.squad.find((p) => p.id === offer.theirPlayerId);
    if (!mine || !theirs) { room.tradeOffers = room.tradeOffers.filter((o) => o.id !== offer.id); return emitError(socket, 'The proposed players are no longer available.'); }
    const newProposerSquad = proposer.squad.filter((p) => p.id !== mine.id).concat(theirs);
    const newReceiverSquad = receiver.squad.filter((p) => p.id !== theirs.id).concat(mine);
    const legalSquad = (squad) => squad.length <= game.MAX_SQUAD && squad.filter((p) => p.overseas).length <= game.MAX_OVERSEAS && squad.filter((p) => p.legend).length <= game.getLegendAuctionLimit(room.settings) && Boolean(game.findBestLegalXI(squad));
    if (!legalSquad(newProposerSquad) || !legalSquad(newReceiverSquad)) return emitError(socket, 'The exchange would leave a team without a legal XI or exceed its squad, overseas, or legend limit.');
    // Atomic swap: update both squads only after every condition passes.
    proposer.squad = newProposerSquad;
    receiver.squad = newReceiverSquad;
    // Update current ownership in sales records. Host removal/re-auction uses
    // these records, so it must recover who owns a player NOW after exchanges.
    for (const sale of room.sold) {
      if (sale.player.id === mine.id) { sale.userId = receiver.id; sale.teamName = receiver.teamName; }
      else if (sale.player.id === theirs.id) { sale.userId = proposer.id; sale.teamName = proposer.teamName; }
    }
    proposer.tradesUsed = (proposer.tradesUsed || 0) + 1;
    receiver.tradesUsed = (receiver.tradesUsed || 0) + 1;
    room.tradeOffers = room.tradeOffers.filter((o) => o.id !== offer.id);
    room.trades.push({ id: offer.id, fromId: proposer.id, toId: receiver.id, fromTeam: proposer.teamShort, toTeam: receiver.teamShort, fromPlayer: mine.name, toPlayer: theirs.name });
    room.lastNotice = { kind: 'tradeAccepted', text: `${proposer.teamShort} traded ${mine.name} to ${receiver.teamShort} for ${theirs.name}.` };
    game.broadcast(io, room);
  });

  socket.on('host:startLineups', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'auctionResults') return;
    const short = room.users.filter((u) => !game.findBestLegalXI(u.squad));
    if (short.length) return emitError(socket, `Every team needs a valid 11-player combination with no more than 4 overseas players and 4 legends. Still short: ${short.map((u) => `${u.teamShort} (${u.squad.length} players, ${u.squad.filter((p) => p.overseas).length} overseas, ${u.squad.filter((p) => p.legend).length} legends)`).join(', ')}.`);
    room.tradeOffers = [];
    room.phase = 'lineup';
    for (const u of room.users) {
      const selected = game.findBestLegalXI(u.squad) || [];
      // Begin with a sensible batting order, but let each user rearrange it.
      u.lineup = [...selected]
        .sort((a, b) => (b.batting || 0) - (a.batting || 0) || (b.ovr || 0) - (a.ovr || 0))
        .map((p) => p.id);
      // The best five bowling ratings among the selected XI are the default bowling unit.
      const rolePriority = (player) => player.role === 'Bowler' ? 2 : player.role === 'All-rounder' ? 1 : 0;
      u.bowlerIds = [...selected]
        .sort((a, b) => (b.bowling || 0) - (a.bowling || 0) || (b.ovr || 0) - (a.ovr || 0) || rolePriority(b) - rolePriority(a))
        .slice(0, 5)
        .map((p) => p.id);
      u.xiReady = false;
    }
    room.lastNotice = { kind: 'lineup', text: 'Select your starting XI.' };
    game.broadcast(io, room);
  });

  socket.on('lineup:set', (payload) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== 'lineup') return;

    // Accept the old array payload during a rolling refresh, while the current UI
    // sends both the batting order and the five selected bowlers.
    const playerIds = Array.isArray(payload) ? payload : payload?.playerIds;
    if (!Array.isArray(playerIds)) return emitError(socket, 'Invalid playing XI.');
    const unique = [...new Set(playerIds.map(String))];
    if (unique.length !== 11 || playerIds.length !== 11) return emitError(socket, 'Select exactly 11 different players.');
    if (unique.some((id) => !user.squad.some((p) => p.id === id))) return emitError(socket, 'Your playing XI can only contain players in your squad.');
    const overseasCount = user.squad.filter((p) => unique.includes(p.id) && p.overseas).length;
    if (overseasCount > 4) return emitError(socket, 'An IPL playing XI can contain at most 4 overseas players.');
    const legendCountInXI = user.squad.filter((p) => unique.includes(p.id) && p.legend).length;
    if (legendCountInXI > game.MAX_LEGENDS_XI) { const purchaseLimit = room.settings.legendAuctionLimit === 'unlimited' ? 'any number of' : `up to ${game.getLegendAuctionLimit(room.settings)}`; return emitError(socket, `Your playing XI can contain at most ${game.MAX_LEGENDS_XI} legends. Your auction purchase limit is ${purchaseLimit} legends.`); }

    const suppliedBowlerIds = Array.isArray(payload) ? null : payload?.bowlerIds;
    const fallbackBowlerIds = [...user.squad]
      .filter((p) => unique.includes(p.id))
      .sort((a, b) => (b.bowling || 0) - (a.bowling || 0) || (b.ovr || 0) - (a.ovr || 0))
      .slice(0, 5)
      .map((p) => p.id);
    const bowlerIds = Array.isArray(suppliedBowlerIds) ? suppliedBowlerIds.map(String) : fallbackBowlerIds;
    const uniqueBowlers = [...new Set(bowlerIds)];
    if (bowlerIds.length !== 5 || uniqueBowlers.length !== 5) return emitError(socket, 'Choose exactly five bowlers.');
    if (uniqueBowlers.some((id) => !unique.includes(id))) return emitError(socket, 'Your bowling unit must be chosen from your playing XI.');

    const suppliedTactics = payload && !Array.isArray(payload) && payload.tactics && typeof payload.tactics === 'object'
      ? payload.tactics : {};
    const choose = (key, allowed, fallback) => allowed.includes(suppliedTactics[key]) ? suppliedTactics[key] : fallback;
    user.lineup = unique;
    user.bowlerIds = uniqueBowlers;
    user.tactics = {
      fielding: choose('fielding', ['aggressive', 'balanced', 'conservative'], game.DEFAULT_TACTICS.fielding),
      bowling: choose('bowling', ['powerplay', 'balanced', 'death'], game.DEFAULT_TACTICS.bowling),
      batting: choose('batting', ['powerplay', 'buildup', 'finish'], game.DEFAULT_TACTICS.batting),
    };
    user.xiReady = false;
    game.broadcast(io, room, false);
  });

  socket.on('lineup:ready', (ready) => {
    const { room, user } = getRoomAndUser(socket);
    if (!room || !user || room.phase !== 'lineup') return;
    if (ready) {
      if (user.lineup.length !== 11 || new Set(user.lineup).size !== 11) return emitError(socket, 'Select exactly 11 different players first.');
      if (user.squad.filter((p) => user.lineup.includes(p.id) && p.overseas).length > 4) return emitError(socket, 'An IPL playing XI can contain at most 4 overseas players.');
      if (user.squad.filter((p) => user.lineup.includes(p.id) && p.legend).length > game.MAX_LEGENDS_XI) return emitError(socket, `Your playing XI can contain at most ${game.MAX_LEGENDS_XI} legends.`);
      if (!Array.isArray(user.bowlerIds) || user.bowlerIds.length !== 5 || new Set(user.bowlerIds).size !== 5 || user.bowlerIds.some((id) => !user.lineup.includes(id))) return emitError(socket, 'Select exactly five bowlers from your playing XI.');
      const tactics = user.tactics || game.DEFAULT_TACTICS;
      if (!['aggressive', 'balanced', 'conservative'].includes(tactics.fielding) || !['powerplay', 'balanced', 'death'].includes(tactics.bowling) || !['powerplay', 'buildup', 'finish'].includes(tactics.batting)) return emitError(socket, 'Choose valid match tactics before getting ready.');
    }
    user.xiReady = Boolean(ready);
    game.broadcast(io, room);
  });

  socket.on('host:startLeague', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'lineup') return;
    if (room.users.length < 2) return emitError(socket, 'At least two teams are required to start a league.');
    const notReady = room.users.filter((u) => !u.xiReady || !Array.isArray(u.lineup) || u.lineup.length !== 11 || new Set(u.lineup).size !== 11 || u.squad.filter((p) => u.lineup.includes(p.id) && p.legend).length > game.MAX_LEGENDS_XI || !Array.isArray(u.bowlerIds) || u.bowlerIds.length !== 5 || new Set(u.bowlerIds).size !== 5 || u.bowlerIds.some((id) => !u.lineup.includes(id)) || !u.tactics || !['aggressive', 'balanced', 'conservative'].includes(u.tactics.fielding) || !['powerplay', 'balanced', 'death'].includes(u.tactics.bowling) || !['powerplay', 'buildup', 'finish'].includes(u.tactics.batting));
    if (notReady.length) return emitError(socket, `Waiting for playing XIs: ${notReady.map((u) => u.teamShort).join(', ')}.`);
    room.phase = 'league';
    room.fixtures = makeDoubleRoundRobin(room.users);
    room.matchResults = []; room.standings = []; room.playerStats = {};
    room.playoff = { round: null, q1WinnerId: null, q1LoserId: null, eliminatorWinnerId: null, finalists: [] };
    room.championId = null; room.currentMatch = null;
    room.lastNotice = { kind: 'leagueStart', text: `The league is underway: ${room.fixtures.length} matches.` };
    game.broadcast(io, room);
    const first = room.fixtures.find((f) => f.type === 'league' && !f.played);
    if (first) game.startLiveMatch(io, room, first);
  });

  socket.on('host:startPlayoffs', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    const result = game.startPlayoffs(io, room);
    if (result.error) emitError(socket, result.error);
  });

  socket.on('host:startFinal', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== 'finalReady') return;
    const [first, second] = room.playoff.finalists;
    if (!first || !second) return emitError(socket, 'Finalists are not ready.');
    room.phase = 'final';
    room.playoff.round = 'Final';
    room.lastNotice = { kind: 'finalStart', text: 'The final starts now.' };
    game.broadcast(io, room);
    game.startLiveMatch(io, room, { id: 'final', type: 'final', round: 'Final', homeId: first, awayId: second, played: false });
  });

  socket.on('host:skipMatch', () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || !room.currentMatch || !room.liveResult) return;
    room.liveTimeouts.forEach(clearTimeout); room.liveTimeouts = [];
    room.liveEventIndex = room.liveEvents.length;
    // The already-generated deterministic result is retained; only its visual delivery is skipped.
    room.currentMatch.live = false;
    const match = { ...room.currentMatch, ...room.liveResult, played: true, live: false };
    delete match.liveScore; delete match.inningsIndex; delete match.target;
    game.updateStandingsAndStats(room, match);
    room.currentMatch = { ...match, live: false };
    room.lastNotice = { kind: 'matchEnd', winnerId: match.winnerId, margin: match.margin, tied: match.tied };
    io.to(room.code).emit('simulation:matchEnd', game.publicRoom(room, user.id).currentMatch?.result || { winnerId: match.winnerId, margin: match.margin });
    room.liveResult = null; room.liveEvents = []; room.liveEventIndex = 0;
    game.broadcast(io, room);
    // Reuse the normal advance logic without re-counting this match.
    const delay = setTimeout(() => {
      room.currentMatch = null;
      if (room.phase === 'league') {
        const remaining = room.fixtures.find((f) => f.type === 'league' && !f.played);
        if (remaining) game.startLiveMatch(io, room, remaining);
        else game.finishLeaguePhase(io, room);
      } else if (room.phase === 'playoffs') {
        // Trigger the same bracket transition from the match's already-set result.
        const round = match.round;
        if (round === 'Qualifier 1') {
          room.playoff.q1WinnerId = match.winnerId; room.playoff.q1LoserId = match.homeId === match.winnerId ? match.awayId : match.homeId;
          room.playoff.round = 'Eliminator';
          const t3 = room.standings[2].userId; const t4 = room.standings[3].userId;
          game.startLiveMatch(io, room, { id: 'playoff-eliminator', type: 'playoff', round: 'Eliminator', homeId: t3, awayId: t4, played: false });
        } else if (round === 'Eliminator') {
          room.playoff.eliminatorWinnerId = match.winnerId; room.playoff.round = 'Qualifier 2';
          game.startLiveMatch(io, room, { id: 'playoff-q2', type: 'playoff', round: 'Qualifier 2', homeId: room.playoff.q1LoserId, awayId: match.winnerId, played: false });
        } else {
          room.playoff.finalists = [room.playoff.q1WinnerId, match.winnerId]; room.phase = 'finalReady'; room.playoff.round = 'Finalists confirmed'; room.lastNotice = { kind: 'finalists', text: 'The finalists are confirmed.' }; game.broadcast(io, room);
        }
      } else if (room.phase === 'final') {
        room.phase = 'complete'; room.championId = match.winnerId; room.lastNotice = { kind: 'champion', winnerId: match.winnerId, text: `${room.users.find((u) => u.id === match.winnerId)?.teamName || 'Champion'} wins the IPL Auction League!` }; game.broadcast(io, room);
        io.to(room.code).emit('simulation:champion', { winnerId: room.championId, name: room.users.find((u) => u.id === room.championId)?.teamName });
      }
    }, 700);
    room.liveTimeouts.push(delay);
  });

  socket.on('disconnect', () => {
    const { room, user } = getRoomAndUser(socket);
    if (socketByUser.get(socket.data.userId) === socket.id) socketByUser.delete(socket.data.userId);
    if (room && user) {
      // A refresh or Wi-Fi drop should not delete a player's team.
      user.connected = false;
      if (user.socketId === socket.id) user.socketId = null;
      if (game.shouldFastSettleLot(room)) {
        game.settleLot(io, room, false, true);
        return;
      }
      game.broadcast(io, room, false);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`IPL Auction Arena running on http://localhost:${PORT}`);
  console.log(`Player database loaded: ${DB.players.length} players (${DB.players.filter((p) => p.legend).length} optional legends)`);
});
