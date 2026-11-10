import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });
const initialTeams = [
  { id: 'CSK', name: 'Chennai Super Kings', short: 'CSK', color: '#f8cd45' },
  { id: 'MI', name: 'Mumbai Indians', short: 'MI', color: '#4b91ff' },
  { id: 'RCB', name: 'Royal Challengers Bengaluru', short: 'RCB', color: '#ff646e' },
  { id: 'KKR', name: 'Kolkata Knight Riders', short: 'KKR', color: '#b8a2ff' },
  { id: 'SRH', name: 'Sunrisers Hyderabad', short: 'SRH', color: '#ffa44b' },
  { id: 'RR', name: 'Rajasthan Royals', short: 'RR', color: '#ff8fc7' },
  { id: 'DC', name: 'Delhi Capitals', short: 'DC', color: '#70b4ff' },
  { id: 'PBKS', name: 'Punjab Kings', short: 'PBKS', color: '#ff7a8a' },
  { id: 'GT', name: 'Gujarat Titans', short: 'GT', color: '#8cb6c5' },
  { id: 'LSG', name: 'Lucknow Super Giants', short: 'LSG', color: '#85d8ce' },
];
const roleShort = { Batter: 'BAT', Bowler: 'BOWL', 'All-rounder': 'AR', Wicketkeeper: 'WK' };
const DEFAULT_AUCTION_LEGEND_LIMIT = 6;
const MAX_XI_LEGENDS = 4;
const isBattingCapable = (player) => ['Batter', 'Wicketkeeper', 'All-rounder'].includes(player?.role);
const preferredPositions = (player) => isBattingCapable(player) && Array.isArray(player?.preferredBattingPositions) ? player.preferredBattingPositions.filter((n) => Number.isInteger(n) && n >= 1 && n <= 11).sort((a, b) => a - b) : [];
const formatPreferredPositions = (positions) => { const list = [...new Set(positions || [])].sort((a, b) => a - b); if (!list.length) return ''; const contiguous = list.every((n, i) => i === 0 || n === list[i - 1] + 1); return contiguous && list.length > 1 ? `${list[0]}–${list[list.length - 1]}` : list.join(', '); };
const canBuildLegalXI = (squad = []) => {
  const players = Array.isArray(squad) ? squad : [];
  const indianNonLegends = players.filter((p) => !p.overseas && !p.legend).length;
  const indianLegends = players.filter((p) => !p.overseas && p.legend).length;
  const overseasNonLegends = players.filter((p) => p.overseas && !p.legend).length;
  const overseasLegends = players.filter((p) => p.overseas && p.legend).length;
  let maximum = 0;
  for (let overseasLegendsPicked = 0; overseasLegendsPicked <= Math.min(4, overseasLegends); overseasLegendsPicked++) {
    maximum = Math.max(maximum,
      indianNonLegends
      + Math.min(indianLegends, MAX_XI_LEGENDS - overseasLegendsPicked)
      + Math.min(overseasNonLegends, 4 - overseasLegendsPicked)
      + overseasLegendsPicked);
  }
  return maximum >= 11;
};
const TACTIC_OPTIONS = {
  fielding: {
    title: 'FIELDING STRATEGY', question: 'How do you set the field?',
    options: [
      { id: 'aggressive', label: 'Aggressive', pro: 'PRO · Fewer easy singles', con: 'CON · More boundary risk', description: 'Attack the batters with a tighter, more aggressive field.' },
      { id: 'balanced', label: 'Balanced', pro: 'PRO · Reliable mix', con: 'CON · No phase-specific edge', description: 'A flexible field with no deliberate bias.' },
      { id: 'conservative', label: 'Conservative', pro: 'PRO · Better catching chances', con: 'CON · More singles and twos', description: 'Protect the rope and prioritize safe catching positions.' },
    ],
  },
  bowling: {
    title: 'BOWLING PLAN', question: 'When do your best bowlers attack?',
    options: [
      { id: 'powerplay', label: 'Best in Powerplay', pro: 'PRO · Strong first six overs', con: 'CON · Less firepower saved for the end', description: 'Your top two bowlers target two overs each in the first six when possible.' },
      { id: 'balanced', label: 'Balanced', pro: 'PRO · Even workload', con: 'CON · No phase-specific edge', description: 'Distribute the five-bowler unit across the innings.' },
      { id: 'death', label: 'Best at Death', pro: 'PRO · Strong last five overs', con: 'CON · Supporting bowlers carry more early overs', description: 'Your top two bowlers target two overs each in the final five when possible.' },
    ],
  },
  batting: {
    title: 'BATTING STRATEGY', question: 'How do you build the innings?',
    options: [
      { id: 'powerplay', label: 'Aggressive Powerplay', pro: 'PRO · More early boundaries', con: 'CON · Slightly more wicket risk', description: 'Take more attacking options in the first six overs.' },
      { id: 'buildup', label: 'Build-up', pro: 'PRO · Safer start', con: 'CON · Fewer early boundaries', description: 'Prioritize steady scoring early and let player ratings drive the contest.' },
      { id: 'finish', label: 'Strong Finish', pro: 'PRO · More late hitting', con: 'CON · May start slower', description: 'Preserve a little more early and attack harder in the final five overs.' },
    ],
  },
};
const DEFAULT_TACTICS = { fielding: 'balanced', bowling: 'balanced', batting: 'buildup' };
const money = (n) => `₹${Number(n || 0).toFixed(2).replace(/\.00$/, '')} Cr`;
const overs = (balls) => `${Math.floor((balls || 0) / 6)}.${(balls || 0) % 6}`;
const getTeam = (room, id) => room?.users?.find((u) => u.id === id);
const sortPlayer = (a, b, showRatings) => showRatings ? (b.ovr || 0) - (a.ovr || 0) : a.name.localeCompare(b.name);
const bidIncrement = (price) => {
  if (price < 1) return 0.05;
  if (price < 2) return 0.10;
  if (price < 5) return 0.20;
  if (price < 10) return 0.25;
  return 0.50;
};
const bidAmount = (lot, multiplier = 1) => {
  if (!lot) return 0;
  const current = lot.currentBidderId ? Number(lot.currentBid) : Number(lot.basePrice);
  if (!lot.currentBidderId) return Number((current * multiplier).toFixed(2));
  let amount = current;
  for (let step = 0; step < multiplier; step++) amount = Number((amount + bidIncrement(amount)).toFixed(2));
  return amount;
};
const nextBid = (lot) => bidAmount(lot, 1);

const teamLogoFile = (teamKey) => String(teamKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function TeamLogo({ teamKey, short, className = '', title }) {
  const [format, setFormat] = useState('avif');
  const [failed, setFailed] = useState(false);
  const file = teamLogoFile(teamKey || short);
  if (failed || !file) return <span className={className} title={title || short}>{short || teamKey || '?'}</span>;
  return <span className={`${className} logo-image-wrap`} title={title || short} aria-label={title || short}>
    <img src={`/logos/${file}.${format}`} alt={title || short || 'IPL team'} onError={() => { if (format === 'avif') setFormat('webp'); else setFailed(true); }} />
  </span>;
}
function IplBrandLogo() {
  const [format, setFormat] = useState('avif');
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="brand-mark brand-mark-fallback"><span>IP</span><span>L</span></div>;
  return <div className="brand-mark brand-mark-image"><img src={`/logos/ipl.${format}`} alt="IPL" onError={() => { if (format === 'avif') setFormat('webp'); else setFailed(true); }} /></div>;
}

function App() {
  const [room, setRoom] = useState(null);
  const [meId, setMeId] = useState(localStorage.getItem('iplUserId') || null);
  const [roomCode, setRoomCode] = useState(new URLSearchParams(window.location.search).get('room') || localStorage.getItem('iplRoomCode') || '');
  const [displayName, setDisplayName] = useState('');
  const [teamId, setTeamId] = useState('MI');
  const [teamChoices, setTeamChoices] = useState(initialTeams);
  const [view, setView] = useState(new URLSearchParams(window.location.search).get('room') ? 'join' : 'create');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [auctionToast, setAuctionToast] = useState('');
  // Private per-viewer RTM state is delivered separately from the shared room snapshot.
  // Keeping an explicit default prevents the RTM holder's render from referencing
  // an undeclared value when private activation is enabled.
  const [privateRtmState, setPrivateRtmState] = useState({ playerId: null, isHolder: false, isOn: false });
  const [ownSquadOvrs, setOwnSquadOvrs] = useState({});
  const [expandedBidderId, setExpandedBidderId] = useState(null);
  const [tradeTarget, setTradeTarget] = useState('');
  const [tradeOwnPlayer, setTradeOwnPlayer] = useState('');
  const [tradeTheirPlayer, setTradeTheirPlayer] = useState('');
  const [modal, setModal] = useState(null);
  const [modalTab, setModalTab] = useState('orangeCap');
  const [lineupSelection, setLineupSelection] = useState([]);
  const [bowlerSelection, setBowlerSelection] = useState([]);
  const [bowlerSelectionManual, setBowlerSelectionManual] = useState(false);
  const [tacticsSelection, setTacticsSelection] = useState(DEFAULT_TACTICS);
  const [lineupHydrated, setLineupHydrated] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [currentBall, setCurrentBall] = useState(null);
  const [ballTrail, setBallTrail] = useState([]);
  const [fx, setFx] = useState({ kind: '', token: 0 });
  const [matchBanner, setMatchBanner] = useState(null);
  const [appOnline, setAppOnline] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const me = useMemo(() => room?.users?.find((u) => u.id === meId) || null, [room, meId]);
  const isHost = Boolean(me && me.id === room?.hostId);
  const allReady = Boolean(room?.users?.length && room.users.every((u) => u.ready));
  const allXIsReady = Boolean(room?.users?.length && room.users.every((u) => u.xiReady && u.lineup?.length === 11 && u.bowlerIds?.length === 5 && u.bowlerIds.every((id) => u.lineup.includes(id)) && u.squad.filter((p) => u.lineup.includes(p.id) && p.legend).length <= MAX_XI_LEGENDS));
  const allSquadsHaveXI = Boolean(room?.users?.length && room.users.every((u) => canBuildLegalXI(u.squad)));
  const selectedTeam = teamChoices.find((t) => t.id === teamId) || initialTeams.find((t) => t.id === teamId);
  const currentMatch = room?.currentMatch;
  const currentLot = room?.currentLot;

  const flashFx = useCallback((kind) => {
    setFx((old) => ({ kind, token: old.token + 1 }));
    window.setTimeout(() => setFx((old) => old.kind === kind ? { ...old, kind: '' } : old), kind === 'win' ? 2100 : 950);
  }, []);

  useEffect(() => {
    const onConnected = () => {
      setAppOnline(true);
      const storedId = localStorage.getItem('iplUserId');
      const storedCode = localStorage.getItem('iplRoomCode');
      const urlRoom = new URLSearchParams(window.location.search).get('room');
      if (storedId && storedCode && (!urlRoom || urlRoom.toUpperCase() === storedCode.toUpperCase())) socket.emit('room:rejoin', { code: storedCode, userId: storedId });
      else if (urlRoom) { setRoomCode(urlRoom.toUpperCase()); setView('join'); }
    };
    const onDisconnected = () => setAppOnline(false);
    const onJoined = ({ roomCode: code, userId, isHost: host }) => {
      setRoomCode(code);
      setMeId(userId);
      setPrivateRtmState({ playerId: null, isHolder: false, isOn: false });
      setOwnSquadOvrs({});
      localStorage.setItem('iplRoomCode', code);
      localStorage.setItem('iplUserId', userId);
      setView('room');
      setError('');
      setNotice(host ? 'Room created. Configure settings, then get everyone ready.' : 'You joined the room.');
    };
    const onUpdate = (next) => {
      setRoom(next);
      setTeamChoices(next.franchises?.length ? next.franchises : initialTeams);
      if (next.phase === 'complete') setMatchBanner({ championId: next.championId });
    };
    const onAppError = (payload) => {
      const message = payload?.message || 'Something went wrong.';
      setError(message);
      setNotice('');
    };
    const onPrivateRoomState = (payload = {}) => {
      setPrivateRtmState({ playerId: payload.rtmPlayerId || null, isHolder: Boolean(payload.isRtmHolder), isOn: Boolean(payload.rtmIsOn) });
      setOwnSquadOvrs(payload.ownSquadOvrs && typeof payload.ownSquadOvrs === 'object' ? payload.ownSquadOvrs : {});
    };
    const onRoomNotice = (payload) => {
      if (!payload?.text) return;
      if (payload.kind === 'rtm') {
        setAuctionToast(payload.text);
        window.setTimeout(() => setAuctionToast((old) => old === payload.text ? '' : old), 4800);
        return;
      }
      setNotice(payload.text);
      if (['auctionStopped', 'auctionComplete', 'leagueComplete', 'finalists'].includes(payload.kind)) setMatchBanner(null);
      window.setTimeout(() => setNotice((old) => old === payload.text ? '' : old), 4300);
    };
    const onMatchStart = ({ match }) => {
      setCurrentBall(null);
      setBallTrail([]);
      setMatchBanner({ match });
      setNotice('');
    };
    const onInningsStart = (payload) => {
      setCurrentBall({ inningsIndex: payload.inningsIndex, score: 0, wickets: 0, balls: 0, overs: '0.0', battingTeamName: payload.teamName, battingTeamId: payload.teamId, target: payload.target || null, superOver: Boolean(payload.superOver) });
      setBallTrail([]);
      setMatchBanner(null);
    };
    const onBall = (ball) => {
      setCurrentBall(ball);
      setBallTrail((prev) => [...prev.slice(-9), { outcome: ball.outcome, runs: ball.runs, wicket: ball.wicket, key: ball.key }]);
      if (ball.wicket) flashFx('wicket');
      else if (ball.outcome === 'SIX' || ball.outcome === 'FOUR') flashFx('boundary');
      else if (ball.batter1 && (ball.batter1.runs === 50 || ball.batter1.runs === 100)) flashFx('milestone');
    };
    const onInningsEnd = (payload) => {
      setCurrentBall((prev) => ({ ...prev, score: payload.runs, wickets: payload.wickets, overs: payload.overs, inningsEnded: true }));
    };
    const onMatchEnd = (result) => {
      setCurrentBall((prev) => prev ? { ...prev, matchOver: true } : prev);
      setMatchBanner({ result });
      if (result?.winnerId) flashFx('win');
    };
    const onChampion = () => flashFx('win');
    socket.on('connect', onConnected);
    socket.on('disconnect', onDisconnected);
    socket.on('room:joined', onJoined);
    const onKicked = ({ message } = {}) => {
      localStorage.removeItem('iplUserId');
      localStorage.removeItem('iplRoomCode');
      setRoom(null);
      setMeId(null);
      setRoomCode('');
      setView('join');
      setError(message || 'The host removed you from the room.');
      setNotice('');
    };
    socket.on('room:kicked', onKicked);
    socket.on('room:update', onUpdate);
    socket.on('app:error', onAppError);
    socket.on('room:notice', onRoomNotice);
    socket.on('room:privateState', onPrivateRoomState);
    socket.on('simulation:matchStart', onMatchStart);
    socket.on('simulation:inningsStart', onInningsStart);
    socket.on('simulation:ball', onBall);
    socket.on('simulation:inningsEnd', onInningsEnd);
    socket.on('simulation:matchEnd', onMatchEnd);
    socket.on('simulation:champion', onChampion);
    if (socket.connected) onConnected();
    return () => {
      socket.off('connect', onConnected); socket.off('disconnect', onDisconnected); socket.off('room:joined', onJoined);
      socket.off('room:kicked', onKicked); socket.off('room:update', onUpdate); socket.off('app:error', onAppError); socket.off('room:notice', onRoomNotice); socket.off('room:privateState', onPrivateRoomState);
      socket.off('simulation:matchStart', onMatchStart); socket.off('simulation:inningsStart', onInningsStart);
      socket.off('simulation:ball', onBall); socket.off('simulation:inningsEnd', onInningsEnd);
      socket.off('simulation:matchEnd', onMatchEnd); socket.off('simulation:champion', onChampion);
    };
    // lineupSelection is intentionally not a dependency; server snapshots set its initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashFx, meId]);

  useEffect(() => {
    if (room?.phase === 'lineup') {
      if (!lineupHydrated && me) {
        setLineupSelection(Array.isArray(me.lineup) ? me.lineup : []);
        setBowlerSelection(Array.isArray(me.bowlerIds) ? me.bowlerIds : []);
        setTacticsSelection({ ...DEFAULT_TACTICS, ...(me.tactics || {}) });
        setBowlerSelectionManual(false);
        setLineupHydrated(true);
      }
    } else {
      setLineupSelection([]);
      setBowlerSelection([]);
      setTacticsSelection(DEFAULT_TACTICS);
      setBowlerSelectionManual(false);
      setLineupHydrated(false);
    }
  }, [room?.phase, me?.id, lineupHydrated]);

  const createRoom = () => {
    setError('');
    socket.emit('room:create', { name: displayName, teamId });
  };
  const joinRoom = () => {
    setError('');
    socket.emit('room:join', { code: roomCode, name: displayName, teamId });
  };
  const hostAction = (event) => socket.emit(event);
  const kickUser = (target) => {
    if (!isHost || !target || target.id === meId) return;
    const purchased = Number(target.squadCount || 0);
    const offline = target.connected ? 'They are currently connected.' : 'They are currently disconnected.';
    const recovered = purchased
      ? `\n\nTheir ${purchased} purchased player${purchased === 1 ? '' : 's'} will return to the unsold pool so the group can re-auction them.`
      : '';
    const lineupWarning = room?.phase === 'lineup'
      ? '\n\nThe app will return to Auction Results and reset everyone’s XI readiness.'
      : '';
    const prompt = `Remove ${target.name} (${target.teamShort}) from this room?\n${offline}${recovered}${lineupWarning}\n\nThis removes their team from the current game.`;
    if (window.confirm(prompt)) socket.emit('host:kickUser', { userId: target.id });
  };
  const setSetting = (key, value) => socket.emit('host:settings', { [key]: value });
  const isMyBid = currentLot?.currentBidderId === meId;
  const isMyOut = Boolean(currentLot?.outUserIds?.includes(meId));
  const myOverseas = me?.squad?.filter((p) => p.overseas).length || 0;
  const myKeepers = me?.squad?.filter((p) => p.role === 'Wicketkeeper').length || 0;
  const myLegendCount = Number.isFinite(me?.legendCount) ? me.legendCount : (me?.squad?.filter((p) => p.legend).length || 0);
  const configuredLegendLimit = room?.settings?.legendAuctionLimit ?? DEFAULT_AUCTION_LEGEND_LIMIT;
  const auctionLegendLimit = configuredLegendLimit === 'unlimited' ? Infinity : Number(configuredLegendLimit || DEFAULT_AUCTION_LEGEND_LIMIT);
  const legendLimitLabel = Number.isFinite(auctionLegendLimit) ? auctionLegendLimit : '∞';
  const legendLimitReached = Boolean(currentLot?.player?.legend && myLegendCount >= auctionLegendLimit);
  const canBid = Boolean(room?.phase === 'auction' && currentLot && !room.auctionPaused && !isMyBid && !isMyOut && (me?.squadCount || 0) < 25 && (!currentLot.player.legend || myLegendCount < auctionLegendLimit) && (!currentLot.player.overseas || myOverseas < 8));
  const bidPriceFor = (multiplier = 1) => bidAmount(currentLot, multiplier);
  const configuredMultipliers = room?.settings?.bidMultipliers || [2, 5, 10];
  const canBidAt = (multiplier = 1) => Boolean(canBid && Number(me?.purse || 0) + 1e-6 >= bidPriceFor(multiplier));
  const rtmHolder = currentLot?.rtmHolderUserId ? room?.users?.find((u) => u.id === currentLot.rtmHolderUserId) : null;
  const isMyRtmHolder = Boolean(rtmHolder && rtmHolder.id === meId);
  // The server sends viewer-specific room snapshots, so this state is true
  // for the RTM holder in private mode and for everyone in public mode.
  const rtmIsOnForMe = room?.settings?.rtmPublicStatus === false
    ? Boolean(isMyRtmHolder && privateRtmState.playerId === currentLot?.player?.id && privateRtmState.isHolder && privateRtmState.isOn)
    : Boolean(currentLot?.rtmIsOn);
  const isMyRtmArmed = Boolean(isMyRtmHolder && rtmIsOnForMe);
  const canMarkOut = Boolean(room?.phase === 'auction' && currentLot && !room.auctionPaused && !isMyBid && !isMyOut && !isMyRtmArmed);
  const myRtmRemaining = Number(me?.rtmUsesRemaining || 0);
  const canArmRtm = Boolean(isMyRtmHolder && room?.settings?.rtmEnabled && !isMyOut && myRtmRemaining > 0 && me?.purse >= (currentLot?.currentBid || 0) && (me?.squadCount || 0) < 25 && (!currentLot?.player?.legend || myLegendCount < auctionLegendLimit) && (!currentLot?.player?.overseas || myOverseas < 8));

  const copyInvite = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(`${url}\nRoom code: ${room.code}`);
      setShareCopied(true); window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setNotice(`Invite link: ${url} · Room code: ${room.code}`);
    }
  };

  const mySquadGroups = useMemo(() => {
    if (!me) return [];
    const groups = [
      ['Batters', me.squad.filter((p) => p.role === 'Batter')],
      ['Wicketkeepers', me.squad.filter((p) => p.role === 'Wicketkeeper')],
      ['All-rounders', me.squad.filter((p) => p.role === 'All-rounder')],
      ['Bowlers', me.squad.filter((p) => p.role === 'Bowler')],
    ];
    return groups.filter(([, players]) => players.length);
  }, [me]);

  const bestFiveBowlers = (playerIds) => {
    const roleTieBreak = (player) => player.role === 'Bowler' ? 2 : player.role === 'All-rounder' ? 1 : 0;
    return [...playerIds]
      .map((id) => me?.squad?.find((player) => player.id === id))
      .filter(Boolean)
      .sort((a, b) => {
        if (Number.isFinite(a.bowling) && Number.isFinite(b.bowling)) {
          return b.bowling - a.bowling || (b.ovr || 0) - (a.ovr || 0) || roleTieBreak(b) - roleTieBreak(a);
        }
        const rankA = Number.isFinite(a.bowlingRank) ? a.bowlingRank : Number.MAX_SAFE_INTEGER;
        const rankB = Number.isFinite(b.bowlingRank) ? b.bowlingRank : Number.MAX_SAFE_INTEGER;
        return rankA - rankB || roleTieBreak(b) - roleTieBreak(a) || a.name.localeCompare(b.name);
      })
      .slice(0, 5)
      .map((player) => player.id);
  };

  const toggleLineupPlayer = (id) => {
    let next;
    if (lineupSelection.includes(id)) {
      next = lineupSelection.filter((x) => x !== id);
    } else {
      if (lineupSelection.length >= 11) { setError('You can select only 11 players. Remove one before adding another.'); return; }
      const player = me?.squad?.find((p) => p.id === id);
      if (player?.overseas && me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.overseas).length >= 4) {
        setError('An IPL playing XI can contain at most four overseas players.'); return;
      }
      if (player?.legend && me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.legend).length >= MAX_XI_LEGENDS) {
        setError(`Your playing XI can contain at most ${MAX_XI_LEGENDS} legends. You can keep the others in your squad as substitutes.`); return;
      }
      next = [...lineupSelection, id];
    }
    setLineupSelection(next);
    const recommended = bestFiveBowlers(next);
    if (!bowlerSelectionManual) {
      setBowlerSelection(recommended);
    } else {
      const preserved = bowlerSelection.filter((bowlerId) => next.includes(bowlerId)).slice(0, 5);
      setBowlerSelection([...preserved, ...recommended.filter((bowlerId) => !preserved.includes(bowlerId))].slice(0, 5));
    }
    setError('');
  };

  const moveBattingOrder = (index, direction) => {
    if (me?.xiReady) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= lineupSelection.length) return;
    setLineupSelection((previous) => {
      const next = [...previous];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const toggleBowler = (id) => {
    if (me?.xiReady) return;
    const selected = bowlerSelection.includes(id);
    if (selected) {
      setBowlerSelection(bowlerSelection.filter((x) => x !== id));
    } else {
      if (bowlerSelection.length >= 5) { setError('Choose exactly five bowlers. Remove one before selecting another.'); return; }
      if (!lineupSelection.includes(id)) { setError('Only players in your selected XI can bowl.'); return; }
      setBowlerSelection([...bowlerSelection, id]);
    }
    setBowlerSelectionManual(true);
    setError('');
  };

  const setTactic = (group, value) => { if (!me?.xiReady) setTacticsSelection((previous) => ({ ...previous, [group]: value })); };

  const saveLineup = () => {
    if (lineupSelection.length !== 11 || new Set(lineupSelection).size !== 11) { setError('Select exactly 11 different players.'); return; }
    const selectedLegendCount = me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.legend).length || 0;
    if (selectedLegendCount > MAX_XI_LEGENDS) { setError(`Your playing XI can contain at most ${MAX_XI_LEGENDS} legends.`); return; }
    if (bowlerSelection.length !== 5 || new Set(bowlerSelection).size !== 5 || bowlerSelection.some((id) => !lineupSelection.includes(id))) { setError('Choose exactly five bowlers from your playing XI.'); return; }
    socket.emit('lineup:set', { playerIds: lineupSelection, bowlerIds: bowlerSelection, tactics: tacticsSelection });
    socket.emit('lineup:ready', true);
    setError('');
    setNotice('Playing XI, batting order, bowling unit and tactics submitted. Waiting for other teams.');
  };

  const openStats = (tab) => { setModalTab(tab); setModal('stats'); };
  const phaseLabel = {
    lobby: 'LOBBY', auction: room?.auctionPaused ? 'AUCTION PAUSED' : 'LIVE AUCTION', auctionResults: 'SQUAD REVIEW',
    lineup: 'PICK YOUR XI', league: 'LEAGUE LIVE', leagueComplete: 'LEAGUE COMPLETE', playoffs: `PLAYOFFS · ${room?.playoff?.round || ''}`,
    finalReady: 'FINALISTS', final: 'THE FINAL', complete: 'CHAMPIONS',
  }[room?.phase] || 'ROOM';

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand" onClick={() => !room && setView('create')} role="button" tabIndex={0}>
          <IplBrandLogo />
          <div><div className="brand-name">AUCTION<span>ARENA</span></div><div className="brand-sub">IPL · DRAFT YOUR DYNASTY</div></div>
        </div>
        <div className="topbar-right">
          {room && <><span className={`phase-chip ${room.phase === 'auction' ? 'live' : ''}`}>{room.phase === 'auction' && <i />}{phaseLabel}</span><span className="room-code"><span>ROOM</span> {room.code}</span></>}
          <span className={`connection ${appOnline ? 'online' : ''}`}><i />{appOnline ? 'Connected' : 'Connecting'}</span>
        </div>
      </header>

      {!room && <main className="landing wrap">
        <section className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> YOUR FRIEND GROUP. YOUR AUCTION.</div>
          <h1>Build a squad.<br /><em>Own the league.</em></h1>
          <p>Run your own IPL auction room, battle for the best players, then watch your XI go head-to-head in a fast, live tournament simulation.</p>
          <div className="hero-facts"><div><strong>10</strong><span>franchises</span></div><div><strong>334</strong><span>players incl. legends</span></div><div><strong>1</strong><span>hosted room</span></div></div>
          <div className="hero-footnote"><span className="live-dot" /> PRIVATE ROOM · NO BOTS · UP TO 10 FRIENDS</div>
        </section>
        <section className="join-card glass-card">
          <div className="card-topline"><span>GET IN THE GAME</span><span className="card-step">01 / 03</span></div>
          <div className="mode-tabs"><button className={view === 'create' ? 'active' : ''} onClick={() => setView('create')}>Create room</button><button className={view === 'join' ? 'active' : ''} onClick={() => setView('join')}>Join a room</button></div>
          <label className="field-label">YOUR DISPLAY NAME</label>
          <input className="text-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={22} placeholder="What should friends call you?" onKeyDown={(e) => e.key === 'Enter' && (view === 'create' ? createRoom() : joinRoom())} />
          {view === 'join' && <><label className="field-label">ROOM CODE</label><input className="text-input code-input" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 5))} maxLength={5} placeholder="ABCDE" /></>}
          <label className="field-label">CHOOSE YOUR FRANCHISE</label>
          <div className="team-picker">
            {initialTeams.map((t) => <button key={t.id} className={`team-tile ${teamId === t.id ? 'selected' : ''}`} onClick={() => setTeamId(t.id)} style={{ '--team-color': t.color }} title={t.name}><TeamLogo teamKey={t.id} short={t.short} className="team-crest" title={t.name} /><span>{t.name}</span><i /></button>)}
          </div>
          {error && <div className="error-banner"><span>!</span>{error}</div>}
          <button className="button primary full-button" disabled={!displayName.trim() || (view === 'join' && roomCode.trim().length < 4)} onClick={view === 'create' ? createRoom : joinRoom}>{view === 'create' ? 'Create private room' : 'Join auction room'} <span>↗</span></button>
          <div className="secure-note"><span>◇</span> Hosted on your machine. Share your tunnel link with friends.</div>
        </section>
      </main>}

      {room && room.phase === 'lobby' && <main className="wrap page-content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ROOM SETUP</div><h2>Lock in your <em>auction room.</em></h2><p>Everyone picks a franchise, gets ready, and the host sets the rules.</p></div><button className="button ghost" onClick={copyInvite}>{shareCopied ? 'Copied invite' : '↗ Share invite'}</button></div>
        <div className="lobby-grid">
          <section className="glass-card players-panel">
            <div className="panel-header"><div><span className="section-kicker">THE DRAFT ROOM</span><h3>Who's playing <span className="muted">({room.users.length}/10)</span></h3></div><div className="ready-meter"><span>{room.users.filter((u) => u.ready).length}</span> / {room.users.length} READY</div></div>
            <div className="room-code-block"><div><span className="field-label">ROOM CODE</span><strong>{room.code}</strong><p>Share the code or invite link. Friends can still join mid-auction.</p></div><button className="square-button" onClick={copyInvite}>⧉</button></div>
            <div className="participant-list">{room.users.map((u, i) => <div className="participant" key={u.id} style={{ '--team-color': u.teamColor }}><div className="participant-index">{String(i + 1).padStart(2, '0')}</div><TeamLogo teamKey={u.teamShort} short={u.teamShort} className="participant-crest" title={u.teamName} /><div className="participant-info"><strong>{u.name}{u.id === meId ? <span className="you-tag">YOU</span> : ''}</strong><span>{u.teamName}</span></div><div className="participant-status">{u.isHost && <span className="host-tag">HOST</span>}<span className={`status-pill ${u.ready ? 'ready' : ''}`}><i />{u.ready ? 'Ready' : 'Waiting'}</span></div><div className={`participant-online ${u.connected ? 'connected' : ''}`} title={u.connected ? 'Connected' : 'Disconnected'} />{isHost && u.id !== meId && <button type="button" className="kick-user-button" title={`Remove ${u.name}`} aria-label={`Remove ${u.name} from room`} onClick={() => kickUser(u)}>×</button>}</div>)}</div>
            <div className="participant-footer"><span><i className="online-dot" /> {room.users.filter((u) => u.connected).length} connected</span><span>2–3 teams: league-only test · 4+ teams: playoffs</span></div>
          </section>
          <section className="glass-card settings-panel">
            <div className="panel-header"><div><span className="section-kicker">HOST CONTROLS</span><h3>Auction rules</h3></div><span className="lock-icon">⌘</span></div>
            {isHost ? <>
              <div className="setting-row"><div><strong>Starting purse</strong><p>Same purse for every team</p></div><select value={room.settings.startingPurse} onChange={(e) => setSetting('startingPurse', Number(e.target.value))}><option value={60}>₹60 Cr</option><option value={80}>₹80 Cr</option><option value={100}>₹100 Cr</option><option value={120}>₹120 Cr · Default</option><option value={150}>₹150 Cr</option><option value={200}>₹200 Cr</option></select></div>
              <div className="setting-row"><div><strong>Bid timer</strong><p>Resets after every bid</p></div><select value={room.settings.bidSeconds} onChange={(e) => setSetting('bidSeconds', Number(e.target.value))}><option value={5}>5 seconds</option><option value={10}>10 seconds · Default</option><option value={15}>15 seconds</option><option value={20}>20 seconds</option><option value={30}>30 seconds</option></select></div>
              <div className="setting-row"><div><strong>Show player ratings</strong><p>Reveal OVR + skill ratings during bids</p></div><button className={`toggle ${room.settings.showRatings ? 'on' : ''}`} onClick={() => setSetting('showRatings', !room.settings.showRatings)} aria-label="Toggle player ratings"><i /></button></div>
              <div className="setting-row"><div><strong>Retired IPL legends</strong><p>Add 52 boosted legends in Marquee Set 1</p></div><button className={`toggle ${room.settings.includeLegends ? 'on' : ''}`} onClick={() => setSetting('includeLegends', !room.settings.includeLegends)} aria-label="Toggle retired legends"><i /></button></div>
              <div className="setting-row"><div><strong>Legend purchase limit</strong><p>Maximum legends each team may buy</p></div><select value={room.settings.legendAuctionLimit ?? 6} onChange={(e) => setSetting('legendAuctionLimit', e.target.value === 'unlimited' ? 'unlimited' : Number(e.target.value))}><option value={4}>4 legends</option><option value={5}>5 legends</option><option value={6}>6 legends · Default</option><option value={7}>7 legends</option><option value={8}>8 legends</option><option value="unlimited">No limit</option></select></div>
              <div className="setting-row"><div><strong>Right to Match</strong><p>Allow original franchises to match the final bid</p></div><button className={`toggle ${room.settings.rtmEnabled ? 'on' : ''}`} onClick={() => setSetting('rtmEnabled', !room.settings.rtmEnabled)} aria-label="Toggle Right to Match"><i /></button></div>
              <div className="setting-row"><div><strong>Reveal RTM activation publicly</strong><p>When off, only the franchise holder sees the live ON/OFF state</p></div><button className={`toggle ${room.settings.rtmPublicStatus !== false ? 'on' : ''}`} disabled={!room.settings.rtmEnabled} onClick={() => setSetting('rtmPublicStatus', room.settings.rtmPublicStatus === false)} aria-label="Toggle public RTM activation visibility"><i /></button></div>
              <div className="setting-row"><div><strong>RTM uses per team</strong><p>Maximum times a franchise can exercise RTM</p></div><select value={room.settings.rtmUses ?? 1} disabled={!room.settings.rtmEnabled} onChange={(e) => setSetting('rtmUses', Number(e.target.value))}><option value={1}>1 use</option><option value={2}>2 uses</option><option value={3}>3 uses</option><option value={4}>4 uses</option></select></div>
              <div className="setting-row"><div><strong>Extra bid buttons</strong><p>Pick any multipliers to display beside the normal bid</p></div><div className="settings-multiplier-options">{[2, 3, 5, 8, 10].map((n) => <label key={n} className="settings-multiplier-choice"><input type="checkbox" checked={(room.settings.bidMultipliers || [2, 5, 10]).includes(n)} onChange={(e) => setSetting('bidMultipliers', [2, 3, 5, 8, 10].filter((m) => m === n ? e.target.checked : (room.settings.bidMultipliers || [2, 5, 10]).includes(m)))} />×{n}</label>)}</div></div>
              <div className="setting-row"><div><strong>Player trading</strong><p>Allow one-for-one exchanges after the auction</p></div><button className={`toggle ${room.settings.tradesEnabled ? 'on' : ''}`} onClick={() => setSetting('tradesEnabled', !room.settings.tradesEnabled)} aria-label="Toggle player trading"><i /></button></div>
              <div className="setting-row"><div><strong>Trades per team</strong><p>Accepted trades count for both teams; declined offers do not</p></div><select disabled={!room.settings.tradesEnabled} value={room.settings.tradeLimit ?? 2} onChange={(e) => setSetting('tradeLimit', Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'trade' : 'trades'}</option>)}</select></div>
              <div className="settings-footnote"><span>ⓘ</span><p>Roster rules: max 25 players, 8 overseas in a squad, and 4 overseas plus 4 legends in the playing XI. Auction legend limit and optional RTM are configurable above. RTM appears only for players with an assigned franchise in the player database.</p></div>
            </> : <div className="host-wait"><span className="host-wait-icon">⌘</span><strong>Host is configuring the auction</strong><p>Once everyone is ready, the host will start the auction. You can change your ready status any time.</p><div className="host-user"><TeamLogo teamKey={room.users.find((u) => u.id === room.hostId)?.teamShort} short={room.users.find((u) => u.id === room.hostId)?.teamShort} className="avatar-mini" title={room.users.find((u) => u.id === room.hostId)?.teamName} /><div><strong>{room.users.find((u) => u.id === room.hostId)?.name}</strong><span>Room host</span></div></div></div>}
            <div className="settings-action">{me?.ready ? <button className="button secondary full-button" onClick={() => socket.emit('lobby:ready', false)}>✓ You're ready · Undo</button> : <button className="button primary full-button" onClick={() => socket.emit('lobby:ready', true)}>I'm ready <span>→</span></button>}{isHost && <button className="button ghost full-button" disabled={!allReady || room.users.length < 2} onClick={() => hostAction('host:startAuction')}>Start auction <span>↗</span></button>}</div>
          </section>
        </div>
      </main>}

      {room && room.phase === 'auction' && <main className="wrap page-content auction-page">
        <div className="auction-toolbar"><div><div className="eyebrow"><span className="eyebrow-line" /> THE AUCTION FLOOR</div><h2>Build your <em>championship squad.</em></h2></div><div className="auction-progress"><span>LOT {String(room.auctionLotsDone + 1).padStart(3, '0')}</span><div className="progress-track"><i style={{ width: `${Math.min(100, ((room.auctionLotsDone || 0) / Math.max(room.totalLots || 1, 1)) * 100)}%` }} /></div><span>{room.auctionLotsDone} / {room.totalLots}</span></div></div>
        <div className="auction-layout">
          <aside className="glass-card auction-myteam"><div className="myteam-heading"><TeamLogo teamKey={me?.teamShort} short={me?.teamShort} className="team-badge" title={me?.teamName} /><div><span className="section-kicker">YOUR FRANCHISE</span><h3>{me?.teamName}</h3><p>Managed by {me?.name}</p></div></div><div className="purse-display"><span>REMAINING PURSE</span><strong>{money(me?.purse)}</strong><div className="purse-bar"><i style={{ width: `${Math.max(0, Math.min(100, (me?.purse || 0) / room.settings.startingPurse * 100))}%` }} /></div><div className="purse-caption"><span>Spent {money(room.settings.startingPurse - (me?.purse || 0))}</span><span>{me?.squadCount || 0} / 25 players</span></div></div><div className="squad-mini-meta"><div><strong>{me?.squadCount || 0}</strong><span>SQUAD</span></div><div><strong>{myOverseas}/8</strong><span>OVERSEAS</span></div><div><strong>{myKeepers}</strong><span>KEEPERS</span></div><div><strong>{myLegendCount}/{legendLimitLabel}</strong><span>LEGENDS</span></div></div><div className="squad-mini-list"><div className="mini-list-title squad-list-header">YOUR SIGNINGS <span>{me?.squadCount || 0}</span></div>{me?.squad?.length ? [['BATTERS', me.squad.filter((p) => p.role === 'Batter')], ['WICKETKEEPERS', me.squad.filter((p) => p.role === 'Wicketkeeper')], ['ALL-ROUNDERS', me.squad.filter((p) => p.role === 'All-rounder')], ['BOWLERS', me.squad.filter((p) => p.role === 'Bowler')]].filter(([, players]) => players.length).map(([title, players]) => <div className="mini-squad-group" key={title}><div className="mini-list-title">{title}<span>{players.length}</span></div>{players.slice().sort((a, b) => sortPlayer(a, b, room.settings.showRatings)).map((p) => <div className="mini-player" key={p.id}><span className="role-chip">{roleShort[p.role]}</span><div className="mini-player-info"><strong>{p.name}</strong><span>{p.overseas ? 'Overseas' : 'Indian'}{preferredPositions(p).length ? ` · BAT ${formatPreferredPositions(preferredPositions(p))}` : ''}{p.legend ? ' · LEGEND' : ''}</span><div className="mini-player-ratings"><span>OVR <b>{p.ovr ?? ownSquadOvrs[p.id] ?? '—'}</b></span><span>BAT <b>{p.batting ?? '—'}</b></span><span>BOWL <b>{p.bowling ?? '—'}</b></span><span>FIELD <b>{p.fielding ?? '—'}</b></span></div></div><b>{money(p.purchasePrice)}</b></div>)}</div>) : <div className="empty-mini">Your first signing is waiting.</div>}</div></aside>
          <section className="auction-center">
            <div className="current-set-label"><span className="set-icon">◇</span><span>{currentLot?.set || room.currentSet}</span><span className="set-sub">AUCTION SET</span></div>
            {currentLot ? <div className="glass-card player-auction-card">
              <div className="lot-meta"><span>PLAYER ON THE BLOCK</span><span>#{String(currentLot.lotNumber).padStart(3, '0')}</span></div>
              <div className="player-avatar-large" style={{ '--team-color': currentLot.player.legend ? '#cba4ff' : me?.teamColor }}>
                {currentLot.player.photo && <img className="player-portrait-img" src={currentLot.player.photo} alt={`Portrait of ${currentLot.player.name}`} loading="eager" decoding="async" onError={(event) => { event.currentTarget.style.display = 'none'; event.currentTarget.parentElement?.querySelector('.player-avatar-fallback')?.classList.remove('is-hidden'); }} />}
                <span className={`player-avatar-fallback${currentLot.player.photo ? ' is-hidden' : ''}`}>{currentLot.player.name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
                <i>{currentLot.player.legend ? 'LEGEND' : currentLot.player.nationality.toUpperCase()}</i>
              </div>
              {currentLot.player.photo && currentLot.player.photoAttribution && <div className="portrait-credit">Photo: <a href={currentLot.player.photoAttribution.sourceUrl} target="_blank" rel="noreferrer">{currentLot.player.photoAttribution.author || 'Wikimedia Commons'}</a>{currentLot.player.photoAttribution.license && <> · <a href={currentLot.player.photoAttribution.licenseUrl || currentLot.player.photoAttribution.sourceUrl} target="_blank" rel="noreferrer">{currentLot.player.photoAttribution.license}</a></>}</div>}
              <h2 className="auction-player-name">{currentLot.player.name}</h2>
              <div className="player-tags"><span>{currentLot.player.role}</span><span>{currentLot.player.overseas ? 'OVERSEAS' : 'INDIAN'}</span>{currentLot.player.legend && <span className="legend-tag">IPL LEGEND</span>}{preferredPositions(currentLot.player).length > 0 && <span className="preferred-position-tag">PREFERRED BAT: {formatPreferredPositions(preferredPositions(currentLot.player))}</span>}</div>
              {room.settings.showRatings && <div className="ratings-strip"><div className="ovr-rating"><span>OVR</span><strong>{currentLot.player.ovr}</strong></div><div><span>BATTING</span><strong>{currentLot.player.batting}</strong></div><div><span>BOWLING</span><strong>{currentLot.player.bowling}</strong></div><div><span>FIELDING</span><strong>{currentLot.player.fielding}</strong></div></div>}
              <div className="base-price-line"><span>BASE PRICE</span><strong>{money(currentLot.basePrice)}</strong></div>
              <div className="bid-price-line"><div><span>{currentLot.currentBidderId ? 'CURRENT BID' : 'FIRST BID AT BASE PRICE'}</span><strong>{money(currentLot.currentBidderId ? currentLot.currentBid : currentLot.basePrice)}</strong>{currentLot.currentBidderName && <small>by {currentLot.currentBidderName}</small>}</div><div className={`timer-orb ${room.auctionPaused ? 'paused' : ''}`}><strong>{room.auctionPaused ? 'Ⅱ' : Math.ceil((currentLot.timerRemainingMs || 0) / 1000)}</strong><span>{room.auctionPaused ? 'PAUSED' : 'SECONDS'}</span></div></div>
              <div className="bid-timer-track"><i style={{ width: `${Math.max(0, Math.min(100, ((currentLot.timerRemainingMs || 0) / (room.settings.bidSeconds * 1000)) * 100))}%` }} /></div>
              <div className="bid-controls-row">
                <button className={`button bid-button ${isMyBid ? 'leading' : ''}`} disabled={!canBidAt(1)} onClick={() => socket.emit('auction:bid', { multiplier: 1 })}>{isMyOut ? 'OUT FOR THIS PLAYER' : isMyBid ? 'YOU ARE THE HIGHEST BIDDER' : legendLimitReached ? 'LEGEND LIMIT REACHED' : !canBidAt(1) ? (me?.purse < nextBid(currentLot) ? 'PURSE TOO LOW' : 'BID UNAVAILABLE') : <>BID {money(bidPriceFor(1))}<span>↗</span></>}</button>
                {configuredMultipliers.map((n) => <button key={n} type="button" className="button bid-multiplier-button" disabled={!canBidAt(n)} onClick={() => socket.emit('auction:bid', { multiplier: n })} title={`Bid ${n} increments: ${money(bidPriceFor(n))}`} aria-label={`Bid ${n} increments: ${money(bidPriceFor(n))}`}>×{n}</button>)}
              </div>
              <button className={`button out-button ${isMyOut ? 'marked-out' : ''}`} disabled={!canMarkOut} title={isMyOut ? 'You are already out for this player.' : isMyRtmArmed ? 'Your RTM is ON. Turn it OFF before opting out.' : isMyBid ? 'Highest bidder cannot opt out.' : room.auctionPaused ? 'Resume the auction to opt out.' : 'Stop bidding for this player.'} onClick={() => socket.emit('auction:out')}>{isMyOut ? 'YOU’RE OUT' : 'I’M OUT'}</button>
              {room.settings.rtmEnabled && currentLot.rtmHolderUserId && <div className={`rtm-panel ${rtmIsOnForMe ? 'armed' : ''}`}>
                {isMyRtmHolder ? <>
                  <button type="button" className={`rtm-toggle ${rtmIsOnForMe ? 'active' : ''}`} disabled={!rtmIsOnForMe && !canArmRtm} aria-pressed={Boolean(rtmIsOnForMe)} onClick={() => socket.emit('auction:rtmToggle', { enabled: !rtmIsOnForMe })}>
                    <span><strong>RIGHT TO MATCH</strong><small>{rtmIsOnForMe ? 'Armed: match the final winning bid' : isMyOut ? 'You are OUT for this player' : 'Secure this player at the final winning price'}</small></span><i>{rtmIsOnForMe ? 'ON' : 'OFF'}</i>
                  </button>
                  <div className="rtm-footnote">{myRtmRemaining} RTM {myRtmRemaining === 1 ? 'use' : 'uses'} remaining · Toggle can be changed until this lot closes.{isMyOut ? ' You have opted out and cannot activate RTM for this player.' : !canArmRtm && !rtmIsOnForMe ? ' Your purse or squad limits currently prevent matching this bid.' : ''}</div>
                </> : <div className="rtm-public-status"><strong>{room.settings.rtmPublicStatus === false ? `RTM OPTION · ${rtmHolder?.teamShort || ''}` : rtmIsOnForMe ? `RTM ARMED · ${rtmHolder?.name || rtmHolder?.teamShort}` : `RTM AVAILABLE · ${rtmHolder?.teamShort || ''}`}</strong><small>{room.settings.rtmPublicStatus === false ? `${rtmHolder?.teamName} holds the option. Activation is hidden until the lot closes.` : rtmIsOnForMe ? `${rtmHolder?.teamName} can match the final bid.` : `${rtmHolder?.teamName} has the option to match the final bid.`}</small></div>}
              </div>}
              <div className="bid-hint">{isMyOut ? 'You are OUT for this player. You cannot bid or activate RTM again until the next lot.' : isMyRtmArmed ? 'Your Right to Match is ON. Turn it OFF before opting out.' : isMyBid ? 'You cannot opt out while you are the highest bidder.' : room.auctionPaused ? 'Bidding is paused by the host.' : currentLot.currentBidderId ? 'Every new bid resets the timer.' : 'No bid? The player goes unsold when everyone opts out or the timer ends.'}</div>
            </div> : <div className="glass-card player-auction-card"><div className="loading-ring" /><h3>Preparing next player…</h3></div>}
            {notice && <div className="notice-line"><span>◆</span>{notice}</div>}
          </section>
          <aside className="auction-right-rail">
            <div className="glass-card bids-panel">
              <div className="panel-header"><div><span className="section-kicker">IN THE ROOM</span><h3>Teams bidding</h3></div><span className="small-count">{room.users.length}</span></div>
              {room.users.map((u) => {
                const expanded = expandedBidderId === u.id && u.id !== meId;
                const bidderPlayers = [...(u.squad || [])].sort((a, b) => {
                  const roleOrder = { Batter: 0, Wicketkeeper: 1, 'All-rounder': 2, Bowler: 3 };
                  return (roleOrder[a.role] ?? 4) - (roleOrder[b.role] ?? 4) || a.name.localeCompare(b.name);
                });
                return <div className="bidder-entry" key={u.id}>
                  <div className={`bidder-row ${u.id === currentLot?.currentBidderId ? 'top-bidder' : ''}`} style={{ '--team-color': u.teamColor }}>
                    <button type="button" className={`bidder-row-main ${u.id === meId ? 'self' : ''}`} disabled={u.id === meId} aria-expanded={expanded} onClick={() => setExpandedBidderId(expanded ? null : u.id)} title={u.id === meId ? 'Your squad is shown on the left.' : `${expanded ? 'Hide' : 'View'} ${u.name}'s squad`}>
                      <TeamLogo teamKey={u.teamShort} short={u.teamShort} className="bidder-crest" title={u.teamName} />
                      <div>
                        <div className="bidder-name-line"><strong>{u.name}{u.id === meId ? ' · YOU' : ''}</strong><span className={`bidder-state-chip ${!currentLot ? 'idle' : u.id === currentLot.currentBidderId ? 'leading' : currentLot.outUserIds?.includes(u.id) ? 'out' : 'in'}`}>{!currentLot ? 'WAIT' : u.id === currentLot.currentBidderId ? 'LEADING' : currentLot.outUserIds?.includes(u.id) ? 'OUT' : 'IN'}</span></div>
                        <span>{u.squadCount} players · {u.overseasCount}/8 overseas · {u.legendCount || 0}/{legendLimitLabel} legends{!u.connected ? ' · OFFLINE' : ''}</span>
                      </div>
                      <b>{money(u.purse)}</b>
                      {u.id !== meId && <span className={`bidder-expand-chevron ${expanded ? 'expanded' : ''}`}>⌄</span>}
                    </button>
                    {isHost && u.id !== meId && <button type="button" className="kick-user-button" title={`Remove ${u.name}`} aria-label={`Remove ${u.name} from room`} onClick={() => kickUser(u)}>×</button>}
                  </div>
                  {expanded && <div className="bidder-squad-preview">
                    <div className="bidder-preview-summary"><span>{u.teamShort} SQUAD</span><b>{u.squadCount}/25 · {u.legendCount || 0} legends · {u.overseasCount}/8 overseas</b></div>
                    {bidderPlayers.length ? <div className="bidder-preview-list">{bidderPlayers.map((player) => <div className="bidder-preview-player" key={player.id}>
                      <span className="role-chip">{roleShort[player.role]}</span>
                      <div className="bidder-preview-player-info"><strong>{player.name}</strong><small>{player.overseas ? 'OVERSEAS' : 'INDIAN'}{player.legend ? ' · LEGEND' : ''}</small><div className="bidder-preview-ratings"><span>OVR <b>{player.ovr ?? '—'}</b></span><span>BAT <b>{player.batting ?? '—'}</b></span><span>BOWL <b>{player.bowling ?? '—'}</b></span><span>FIELD <b>{player.fielding ?? '—'}</b></span></div></div>
                      <b>{money(player.purchasePrice)}</b>
                    </div>)}</div> : <div className="bidder-preview-empty">No players purchased yet.</div>}
                  </div>}
                </div>;
              })}
            </div>
            <div className="glass-card recent-panel"><div className="panel-header"><div><span className="section-kicker">RECENT LOTS</span><h3>Last sold</h3></div><span className="small-count">{room.sold.length}</span></div>{room.lotHistory.slice(-5).reverse().map((lot) => <div className="recent-lot" key={`${lot.lotNumber}-${lot.playerId}`}><div><strong>{lot.playerName}</strong><span>{lot.teamName || 'No bids'} · {lot.set}</span></div><b className={lot.result === 'UNSOLD' ? 'unsold-price' : ''}>{lot.price ? money(lot.price) : 'UNSOLD'}</b></div>)}</div>
            {isHost && <div className="host-actions glass-card"><span className="section-kicker">HOST TOOLS</span><div className="host-action-buttons">{room.auctionPaused ? <button className="button small secondary" onClick={() => hostAction('host:resumeAuction')}>▶ Resume</button> : <button className="button small secondary" onClick={() => hostAction('host:pauseAuction')}>Ⅱ Pause</button>}<button className="button small danger" onClick={() => { if (window.confirm('End the auction now? The current high bid will be sold.')) hostAction('host:endAuction'); }}>■ End auction</button></div><p>You can stop now, or resume later from the squad review.</p></div>}
          </aside>
        </div>
      </main>}

      {room && room.phase === 'auctionResults' && <main className="wrap page-content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> AUCTION RESULTS</div><h2>The squads are <em>taking shape.</em></h2><p>{room.sold.length} players sold · {room.unsold.length} unsold · {room.users.length} franchises in this room.</p></div><div className="result-actions">{isHost && (room.lotsRemaining > 0 || room.unsold.length > 0) && <button className="button secondary" onClick={() => hostAction('host:continueAuction')}>Continue auction ↗</button>}{isHost && <button className="button primary" disabled={!allSquadsHaveXI} title={!allSquadsHaveXI ? 'Each team needs a valid XI of 11, with at most 4 overseas players and 4 legends.' : ''} onClick={() => hostAction('host:startLineups')}>Choose starting XIs <span>→</span></button>}</div></div>
        {!allSquadsHaveXI && <div className="warning-banner"><span>!</span> Each team needs a valid combination of 11 players with no more than four overseas players and four legends. Resume the auction so teams can complete their squads.</div>}
        {room.settings.tradesEnabled && <section className="glass-card trade-panel">
          <div className="panel-header"><div><span className="section-kicker">PLAYER EXCHANGE</span><h3>Trade with another franchise</h3></div><span className="trade-usage">{me?.tradesUsed || 0}/{room.settings.tradeLimit} trades used</span></div>
          <p className="trade-explainer">Propose a one-for-one swap. The other manager must accept. Each completed swap counts toward both teams' limits. No purse changes.</p>
          {(() => { const pending = room.tradeOffers || []; const mine = pending.find((offer) => offer.fromId === meId || offer.toId === meId); const other = room.users.find((u) => u.id === tradeTarget); const available = !mine && (me?.tradesUsed || 0) < room.settings.tradeLimit;
            return <>
              {mine && <div className="trade-pending"><strong>{mine.toId === meId ? 'INCOMING OFFER' : 'AWAITING RESPONSE'}</strong><p>{getTeam(room, mine.fromId)?.teamShort} offers {getTeam(room, mine.fromId)?.squad?.find((p) => p.id === mine.myPlayerId)?.name || 'a player'} for {getTeam(room, mine.toId)?.squad?.find((p) => p.id === mine.theirPlayerId)?.name || 'a player'} from {getTeam(room, mine.toId)?.teamShort}.</p><div className="trade-actions">{mine.toId === meId && <button className="button primary small" onClick={() => socket.emit('trade:respond', { offerId: mine.id, accept: true })}>Accept trade</button>}<button className="button secondary small" onClick={() => socket.emit('trade:respond', { offerId: mine.id, accept: false })}>{mine.toId === meId ? 'Decline' : 'Cancel offer'}</button></div></div>}
              {available && <div className="trade-form"><label>Trade with<select value={tradeTarget} onChange={(e) => { setTradeTarget(e.target.value); setTradeTheirPlayer(''); }}><option value="">Select franchise</option>{room.users.filter((u) => u.id !== meId && u.connected && (u.tradesUsed || 0) < room.settings.tradeLimit && !pending.some((o) => o.fromId === u.id || o.toId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.teamShort} · {u.name}</option>)}</select></label><label>You give<select value={tradeOwnPlayer} onChange={(e) => setTradeOwnPlayer(e.target.value)}><option value="">Select your player</option>{me?.squad?.map((p) => <option key={p.id} value={p.id}>{p.name} · {roleShort[p.role]} · OVR {p.ovr}</option>)}</select></label><label>You receive<select value={tradeTheirPlayer} onChange={(e) => setTradeTheirPlayer(e.target.value)}><option value="">Select their player</option>{other?.squad?.map((p) => <option key={p.id} value={p.id}>{p.name} · {roleShort[p.role]} · OVR {p.ovr}</option>)}</select></label><button className="button primary small" disabled={!tradeTarget || !tradeOwnPlayer || !tradeTheirPlayer} onClick={() => { socket.emit('trade:propose', { toUserId: tradeTarget, myPlayerId: tradeOwnPlayer, theirPlayerId: tradeTheirPlayer }); setTradeOwnPlayer(''); setTradeTheirPlayer(''); }}>Send trade offer</button></div>}
              {(me?.tradesUsed || 0) >= room.settings.tradeLimit && <p className="trade-explainer">You've reached your trade limit.</p>}
            </>; })()}
          {(room.tradeHistory || []).length > 0 && <div className="trade-history">{room.tradeHistory.slice(-4).reverse().map((t) => <p key={t.id}>{t.fromTeam}: {t.fromPlayer} ↔ {t.toTeam}: {t.toPlayer}</p>)}</div>}
        </section>}
        <div className="teams-grid">{room.users.map((u) => <SquadCard key={u.id} user={u} showRatings={room.settings.showRatings} startingPurse={room.settings.startingPurse} legendAuctionLimit={room.settings.legendAuctionLimit ?? DEFAULT_AUCTION_LEGEND_LIMIT} isMe={u.id === meId} isHost={isHost} onKick={kickUser} />)}</div>
      </main>}

      {room && room.phase === 'lineup' && <main className="wrap page-content lineup-page">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> PLAYING XI</div><h2>Build your <em>match plan.</em></h2><p>Select 11 players, arrange the batting order, then choose the five bowlers who will share the 20 overs. No more than four overseas players or four legends in the XI. You can own {Number.isFinite(auctionLegendLimit) ? `up to ${auctionLegendLimit}` : 'any number of'} legends in your squad.</p></div><div className={`xi-counter ${lineupSelection.length === 11 && bowlerSelection.length === 5 ? 'complete' : ''}`}><strong>{lineupSelection.length}<span>/11</span></strong><span>SELECTED</span><small>{bowlerSelection.length}/5 BOWLERS</small></div></div>
        <TeamRatingsStrip ratings={me?.teamRatings} label="YOUR TEAM STRENGTH · TOP 11 BY OVR" />
        <div className="lineup-layout"><section className="glass-card lineup-selector"><div className="panel-header"><div><span className="section-kicker">YOUR SQUAD · {me?.squadCount || 0} PLAYERS</span><h3>{me?.teamName}</h3></div><div className="lineup-limit-counters"><div className="overseas-counter">OVERSEAS <b>{me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.overseas).length || 0}/4</b></div><div className="overseas-counter">LEGENDS <b>{me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.legend).length || 0}/{MAX_XI_LEGENDS}</b></div></div></div>
          <div className="filter-tabs">{['All', 'Batter', 'Wicketkeeper', 'All-rounder', 'Bowler'].map((f) => <button key={f} className={activeFilter === f ? 'active' : ''} onClick={() => setActiveFilter(f)}>{f === 'All' ? 'All players' : f === 'All-rounder' ? 'All-rounders' : f === 'Wicketkeeper' ? 'Keepers' : `${f}s`}</button>)}</div>
          <div className="lineup-player-list">{[...(me?.squad || [])].filter((p) => activeFilter === 'All' || p.role === activeFilter).sort((a, b) => sortPlayer(a, b, room.settings.showRatings)).map((p) => { const selected = lineupSelection.includes(p.id); const xiLegendCount = me?.squad?.filter((player) => lineupSelection.includes(player.id) && player.legend).length || 0; const blockedByLegendLimit = !selected && p.legend && xiLegendCount >= MAX_XI_LEGENDS; return <button key={p.id} className={`lineup-player ${selected ? 'picked' : ''}`} disabled={me?.xiReady || blockedByLegendLimit} title={blockedByLegendLimit ? `The playing XI is limited to ${MAX_XI_LEGENDS} legends.` : ''} onClick={() => toggleLineupPlayer(p.id)}><span className={`pick-box ${selected ? 'checked' : ''}`}>{selected ? '✓' : ''}</span><span className="lineup-role">{roleShort[p.role]}</span><div className="lineup-player-info"><strong>{p.name}</strong><span>{p.overseas ? 'Overseas' : 'Indian'} · {p.set}{p.legend ? ' · LEGEND' : ''}{blockedByLegendLimit ? ' · XI LIMIT REACHED' : ''}</span></div>{room.settings.showRatings && <b className="player-ovr">{p.ovr}</b>}<span className="lineup-price">{money(p.purchasePrice)}</span></button>; })}</div>
          <div className="lineup-detail-grid">
            <section className="lineup-detail-panel"><div className="lineup-detail-heading"><div><span className="section-kicker">01 · BATTING ORDER</span><h4>Who bats when?</h4></div><span className="detail-count">{lineupSelection.length}/11</span></div><p>Use the arrows to set the exact arrival order. Player 1 and 2 open the innings.</p>
              {lineupSelection.length === 0 ? <div className="detail-empty">Select your XI to arrange the batting order.</div> : <ol className="batting-order-list">{lineupSelection.map((id, index) => { const player = me?.squad?.find((p) => p.id === id); if (!player) return null; const prefs = preferredPositions(player); const positionMatches = prefs.includes(index + 1); return <li key={id} className={`batting-order-row ${positionMatches ? 'preferred-slot-row' : ''}`}><span className="batting-position">{String(index + 1).padStart(2, '0')}</span><div className="batting-order-player"><strong>{player.name}</strong><span>{roleShort[player.role]}{room.settings.showRatings ? ` · BAT ${player.batting}` : ''}</span>{prefs.length > 0 && <small className={`preferred-position-status ${positionMatches ? 'matched' : ''}`}>{positionMatches ? '✓ PREFERRED POSITION · +17% RUN ODDS' : `Preferred: ${formatPreferredPositions(prefs)}`}</small>}</div><div className="order-controls"><button type="button" title="Move up in batting order" aria-label={`Move ${player.name} up`} disabled={me?.xiReady || index === 0} onClick={() => moveBattingOrder(index, -1)}>↑</button><button type="button" title="Move down in batting order" aria-label={`Move ${player.name} down`} disabled={me?.xiReady || index === lineupSelection.length - 1} onClick={() => moveBattingOrder(index, 1)}>↓</button></div></li>; })}</ol>}
            </section>
            <section className="lineup-detail-panel"><div className="lineup-detail-heading"><div><span className="section-kicker">02 · BOWLING UNIT</span><h4>Choose your five</h4></div><span className={`detail-count ${bowlerSelection.length === 5 ? 'complete' : ''}`}>{bowlerSelection.length}/5</span></div><p>The five with the best bowling ratings are preselected. Each can bowl up to four overs; change the selection if you prefer.</p>
              {lineupSelection.length === 0 ? <div className="detail-empty">Choose your XI first. The best five bowlers will be selected automatically.</div> : <div className="bowler-choice-list">{lineupSelection.map((id, index) => { const player = me?.squad?.find((p) => p.id === id); if (!player) return null; const checked = bowlerSelection.includes(id); return <label key={id} className={`bowler-choice ${checked ? 'selected' : ''}`}><input type="checkbox" checked={checked} disabled={me?.xiReady || (!checked && bowlerSelection.length >= 5)} onChange={() => toggleBowler(id)} /><span className="bowler-choice-info"><strong>{player.name}</strong><span>{roleShort[player.role]}{room.settings.showRatings ? ` · BOWL ${player.bowling}` : ''}</span></span>{checked && <b>SELECTED</b>}</label>; })}</div>}
            </section>
          </div>
          <section className="lineup-detail-panel match-tactics-panel">
            <div className="lineup-detail-heading"><div><span className="section-kicker">03 · MATCH TACTICS</span><h4>Choose your team style</h4></div><span className="detail-count">SMALL EDGES</span></div>
            <p>These settings slightly bias the simulation. Ratings and luck still decide most outcomes.</p>
            <div className="tactics-grid">
              {Object.entries(TACTIC_OPTIONS).map(([group, config]) => <section className="tactic-group" key={group}>
                <div className="tactic-group-heading"><span>{config.title}</span><strong>{config.question}</strong></div>
                <div className="tactic-options">{config.options.map((option) => <button type="button" key={option.id} disabled={me?.xiReady} className={`tactic-option ${tacticsSelection[group] === option.id ? 'selected' : ''}`} aria-pressed={tacticsSelection[group] === option.id} onClick={() => setTactic(group, option.id)}>
                  <span className="tactic-option-top"><strong>{option.label}</strong><i>{tacticsSelection[group] === option.id ? 'SELECTED' : 'SELECT'}</i></span>
                  <span className="tactic-description">{option.description}</span>
                  <span className="tactic-pro">{option.pro}</span><span className="tactic-con">{option.con}</span>
                </button>)}</div>
              </section>)}
            </div>
          </section>
          <div className="lineup-bottom"><span>{lineupSelection.length === 11 && bowlerSelection.length === 5 ? 'XI, batting order, bowling unit and tactics are ready.' : `${Math.max(0, 11 - lineupSelection.length)} XI spots · ${Math.max(0, 5 - bowlerSelection.length)} bowling spots remaining.`}</span>{me?.xiReady ? <button className="button secondary" onClick={() => socket.emit('lineup:ready', false)}>Edit match plan</button> : <button className="button primary" disabled={lineupSelection.length !== 11 || bowlerSelection.length !== 5} onClick={saveLineup}>Submit match plan →</button>}</div>
        </section><aside className="lineup-aside"><div className="glass-card lineup-status-card"><span className="section-kicker">LEAGUE READINESS</span><h3>All teams need to be ready.</h3><p>The league starts after each player locks in their XI, batting order and five-bowler unit.</p>{room.users.map((u) => <div className="xi-ready-row" key={u.id}><TeamLogo teamKey={u.teamShort} short={u.teamShort} className="xi-team-crest" title={u.teamName} /><div><strong>{u.name}</strong><span>{u.teamName} · {u.lineup?.length || 0}/11 · {u.bowlerIds?.length || 0}/5 bowlers{!u.connected ? ' · OFFLINE' : ''}</span></div><b className={u.xiReady && u.lineup?.length === 11 && u.bowlerIds?.length === 5 ? 'ready' : ''}>{u.xiReady && u.lineup?.length === 11 && u.bowlerIds?.length === 5 ? 'READY' : 'PICKING'}</b>{isHost && u.id !== meId && <button type="button" className="kick-user-button" title={`Remove ${u.name}`} aria-label={`Remove ${u.name} from room`} onClick={() => kickUser(u)}>×</button>}</div>)}{isHost && <button className="button primary full-button" disabled={!allXIsReady || room.users.length < 2} onClick={() => hostAction('host:startLeague')}>Start league simulation <span>↗</span></button>}{!isHost && <div className="awaiting-host">{allXIsReady ? 'All teams are ready. Waiting for the host.' : 'Submit your full match plan and wait for other teams.'}</div>}</div></aside></div>
      </main>}

      {room && ['league', 'leagueComplete', 'playoffs', 'finalReady', 'final', 'complete'].includes(room.phase) && <main className="wrap page-content sim-page">
        {room.phase === 'complete' ? <ChampionScreen room={room} openStats={openStats} /> : room.phase === 'finalReady' ? <FinalistsScreen room={room} isHost={isHost} onStart={() => hostAction('host:startFinal')} /> : <>
          <div className="sim-topline"><div><div className="eyebrow"><span className="eyebrow-line" /> {room.phase === 'league' ? 'LIVE MATCH CENTRE' : room.phase === 'playoffs' ? 'PLAYOFFS' : room.phase === 'final' ? 'THE GRAND FINAL' : 'LEAGUE PHASE COMPLETE'}</div><h2>{room.phase === 'league' ? <>The league is <em>live.</em></> : room.phase === 'playoffs' ? <>Win or <em>go home.</em></> : room.phase === 'final' ? <>One trophy. <em>One champion.</em></> : <>League stage <em>complete.</em></>}</h2></div><div className="sim-progress"><span>{room.phase === 'league' ? `MATCH ${Math.min(room.matchCount + 1, room.totalLeagueMatches)} / ${room.totalLeagueMatches}` : room.phase === 'playoffs' ? (room.playoff?.round || 'PLAYOFFS') : room.phase === 'final' ? 'FINAL' : `${room.totalLeagueMatches} MATCHES`}</span><span className="sim-progress-dot" /></div></div>
          {room.currentMatch && <div className="match-heading"><div className="match-team home" style={{ '--team-color': currentMatch?.home?.teamColor }}><TeamLogo teamKey={currentMatch?.home?.teamShort} short={currentMatch?.home?.teamShort} className="match-crest" title={currentMatch?.home?.teamName} /><div><strong>{currentMatch?.home?.teamName}</strong><span>{currentMatch?.home?.name}</span></div></div><div className="versus"><span>{currentMatch?.round || 'LEAGUE MATCH'}</span><b>VS</b><i>LIVE</i></div><div className="match-team away" style={{ '--team-color': currentMatch?.away?.teamColor }}><TeamLogo teamKey={currentMatch?.away?.teamShort} short={currentMatch?.away?.teamShort} className="match-crest" title={currentMatch?.away?.teamName} /><div><strong>{currentMatch?.away?.teamName}</strong><span>{currentMatch?.away?.name}</span></div></div></div>}
          <div className="sim-grid">
            <section className="sim-main-col">
              {room.currentMatch ? <div className="glass-card live-score-card">
                <div className="live-score-header"><span className="live-pulse"><i /> IN PLAY</span><span>{currentBall?.superOver ? 'SUPER OVER' : currentBall?.inningsIndex === 1 ? '2ND INNINGS' : '1ST INNINGS'}{currentBall?.target ? ` · TARGET ${currentBall.target}` : ''}</span><span>{currentBall?.overs || '0.0'} OVERS</span></div>
                <div className="scoreline"><span className="score-team-label">{currentBall?.battingTeamId || currentBall?.battingTeamName ? (room.users.find((u) => u.id === currentBall?.battingTeamId)?.teamShort || currentBall?.battingTeamName?.slice(0, 3).toUpperCase()) : '—'}</span><strong>{currentBall?.score ?? 0}<small>/</small>{currentBall?.wickets ?? 0}</strong><span className="score-overs">{currentBall?.overs || '0.0'} <i>overs</i></span><span className="score-opponent-label">{currentMatch?.homeId === currentBall?.battingTeamId ? currentMatch?.away?.teamShort : currentMatch?.home?.teamShort}</span></div>
                {currentBall?.target && <div className="target-line"><span>TARGET {currentBall.target}</span><b>{Math.max(0, currentBall.target - (currentBall.score || 0))} runs needed</b><span>Required RR {currentBall?.balls ? ((Math.max(0, currentBall.target - (currentBall.score || 0))) / Math.max(0.1, (120 - currentBall.balls) / 6)).toFixed(2) : '0.00'}</span></div>}
                <div className="live-score-separator" />
                <div className="live-batters"><div className="player-score-row"><div className="batter-mark">✦</div><div className="player-score-name"><strong>{currentBall?.batter1?.name || 'Awaiting first ball'}</strong><span>{currentBall?.batter1 ? `${currentBall.batter1.balls} balls faced` : 'Opening batter'}</span></div><strong className="batter-runs">{currentBall?.batter1?.runs ?? 0}<small> ({currentBall?.batter1?.balls ?? 0})</small>{currentBall?.batter1 && !currentBall.batter1.out ? '*' : ''}</strong></div><div className="player-score-row"><div className="batter-mark muted-mark">◇</div><div className="player-score-name"><strong>{currentBall?.batter2?.name || '—'}</strong><span>{currentBall?.batter2 ? `${currentBall.batter2.balls} balls faced` : 'Non-striker'}</span></div><strong className="batter-runs">{currentBall?.batter2?.runs ?? 0}<small> ({currentBall?.batter2?.balls ?? 0})</small>{currentBall?.batter2 && !currentBall.batter2.out ? '*' : ''}</strong></div><div className="player-score-row bowler-row"><div className="bowler-mark">↘</div><div className="player-score-name"><strong>{currentBall?.bowler?.name || 'Bowler'}</strong><span>BOWLING</span></div><strong className="bowler-figures">{currentBall?.bowler?.wickets ?? 0}/{currentBall?.bowler?.runs ?? 0}<small> ({currentBall?.bowler?.overs || '0.0'})</small></strong></div></div>
                <div className="scorecard-bottom"><div className="last-ball-strip"><span>RECENT BALLS</span><div>{ballTrail.map((b, i) => <i key={b.key || i} className={`${b.wicket ? 'wicket-ball' : b.runs === 6 ? 'six-ball' : b.runs === 4 ? 'four-ball' : ''}`}>{b.wicket ? 'W' : b.runs > 0 ? b.runs : '·'}</i>)}</div></div><div className="commentary-line"><i />{currentBall?.commentary || 'The bowler is marking the run-up…'}</div></div>
                {matchBanner?.result && <div className="match-result-flash"><span>MATCH RESULT</span><strong>{matchBanner.result.winnerId ? `${getTeam(room, matchBanner.result.winnerId)?.teamName} WIN` : 'MATCH TIED'}</strong><small>{matchBanner.result.margin}</small></div>}
                {isHost && <button className="skip-match" onClick={() => { if (window.confirm('Skip the live animation and move to the result?')) hostAction('host:skipMatch'); }}>Skip animation ↗</button>}
              </div> : room.phase === 'leagueComplete' ? <div className="glass-card phase-complete-card"><div className="phase-icon">✓</div><span className="section-kicker">EVERY MATCH COUNTS</span><h3>The league table is final.</h3><p>The top four teams qualify for the IPL-style playoffs: Qualifier 1, Eliminator, and Qualifier 2.</p>{isHost && <button className="button primary" onClick={() => hostAction('host:startPlayoffs')}>Start playoff simulation <span>↗</span></button>}</div> : <div className="glass-card phase-complete-card"><div className="loading-ring" /><h3>Preparing the next match…</h3></div>}
              <div className="glass-card table-card"><div className="panel-header"><div><span className="section-kicker">POINTS TABLE</span><h3>{room.phase === 'league' ? 'League standings' : 'Final league table'}</h3></div><span className="table-note">2 PTS FOR A WIN</span></div><LeagueTable room={room} /></div>
            </section>
            <aside className="sim-rail"><LeaderCard title="ORANGE CAP" accent="orange" value={room.playerLeaders?.orangeCap?.[0]} metric="runs" onClick={() => openStats('orangeCap')} /><LeaderCard title="PURPLE CAP" accent="purple" value={room.playerLeaders?.purpleCap?.[0]} metric="wickets" onClick={() => openStats('purpleCap')} /><LeaderCard title="TOURNAMENT MVP" accent="mvp" value={room.playerLeaders?.mvp?.[0]} metric="mvpScore" onClick={() => openStats('mvp')} /><button className="more-stats-card" onClick={() => openStats('more')}><span className="stats-icon">▤</span><span><strong>More stats</strong><small>Records, form & leaderboards</small></span><b>↗</b></button>
              <div className="glass-card fixtures-card"><div className="panel-header"><div><span className="section-kicker">RECENT RESULTS</span><h3>Last matches</h3></div></div>{room.matchResults?.slice(-4).reverse().map((m) => <div className="fixture-result" key={m.id}><span className="fixture-round">{m.round || 'LEAGUE'}</span><div><strong>{getTeam(room, m.winnerId)?.teamShort || 'TIE'} <span>won</span></strong><small>{m.margin}</small></div><i>✓</i></div>)}{!room.matchResults?.length && <p className="muted empty-copy">Results appear here as matches finish.</p>}</div>
            </aside>
          </div>
        </>}
      </main>}

      {modal === 'stats' && room && <StatsModal room={room} tab={modalTab} setTab={setModalTab} onClose={() => setModal(null)} />}
      {error && room && <div className="toast error-toast" role="alert"><span>!</span><div>{error}</div><button onClick={() => setError('')}>×</button></div>}
      {notice && room && ['lobby', 'auctionResults', 'lineup'].includes(room.phase) && <div className="toast notice-toast"><span>◆</span><div>{notice}</div><button onClick={() => setNotice('')}>×</button></div>}
      {auctionToast && room?.phase === 'auction' && <div className="toast notice-toast auction-rtm-toast" role="status"><span>◆</span><div>{auctionToast}</div><button onClick={() => setAuctionToast('')}>×</button></div>}
      {fx.kind && <Confetti kind={fx.kind} token={fx.token} />}
      <footer className="site-footer"><span>AUCTION ARENA <b>·</b> LOCAL HOSTED IPL GAME</span><span>Built for the group chat <i>✦</i></span></footer>
    </div>
  );
}

function TeamRatingsStrip({ ratings, label = 'TEAM STRENGTH', compact = false }) {
  const stats = [
    ['OVR', ratings?.ovr], ['BAT', ratings?.batting], ['BOWL', ratings?.bowling], ['FIELD', ratings?.fielding],
  ];
  return <div className={`team-ratings-strip ${compact ? 'compact' : ''}`}>
    <div className="team-ratings-label">{label}</div>
    <div className="team-ratings-values">{stats.map(([name, value]) => <div className="team-rating-cell" key={name}><span>{name}</span><strong>{Number.isFinite(value) ? value : '—'}</strong></div>)}</div>
    {!ratings && <small className="team-ratings-note">Complete at least 11 signings to calculate all four ratings.</small>}
  </div>;
}

function SquadCard({ user, showRatings, startingPurse, legendAuctionLimit = DEFAULT_AUCTION_LEGEND_LIMIT, isMe, isHost, onKick }) {
  const grouped = [
    ['BAT', user.squad.filter((p) => p.role === 'Batter')], ['WK', user.squad.filter((p) => p.role === 'Wicketkeeper')],
    ['AR', user.squad.filter((p) => p.role === 'All-rounder')], ['BOWL', user.squad.filter((p) => p.role === 'Bowler')],
  ].filter(([, list]) => list.length);
  return <section className={`glass-card squad-card ${isMe ? 'my-squad-card' : ''}`} style={{ '--team-color': user.teamColor }}><div className="squad-card-head"><TeamLogo teamKey={user.teamShort} short={user.teamShort} className="team-badge" title={user.teamName} /><div className="squad-card-title"><strong>{user.teamName}</strong><span>Managed by {user.name}{isMe ? ' · YOU' : ''}</span></div><div className="squad-card-count"><strong>{user.squadCount}</strong><span>PLAYERS</span></div>{isHost && !isMe && <button type="button" className="kick-user-button" title={`Remove ${user.name}`} aria-label={`Remove ${user.name} from room`} onClick={() => onKick(user)}>×</button>}</div><div className="squad-card-money"><div><span>PURSE LEFT</span><strong>{money(user.purse)}</strong></div><div><span>OVERSEAS</span><strong>{user.overseasCount}/8</strong></div><div><span>LEGENDS</span><strong>{user.legendCount || user.squad.filter((p) => p.legend).length}/{(legendAuctionLimit === 'unlimited' ? '∞' : legendAuctionLimit)}</strong></div><div><span>SPENT</span><strong>{money((startingPurse - user.purse))}</strong></div></div><TeamRatingsStrip ratings={user.teamRatings} label="TEAM STRENGTH · TOP 11 BY OVR" compact /><div className="squad-roles">{grouped.length ? grouped.map(([role, ps]) => <div className="squad-role-group" key={role}><div className="role-group-title"><span>{role}</span><i /><b>{ps.length}</b></div>{ps.map((p) => <div className="squad-player-line" key={p.id}><span className="squad-country" title={p.overseas ? 'Overseas' : 'Indian'}>{p.overseas ? 'OS' : 'IN'}</span><strong>{p.name}</strong>{showRatings && <span className="squad-player-ovr">{p.ovr}</span>}<b>{money(p.purchasePrice)}</b></div>)}</div>) : <div className="empty-mini">No players purchased.</div>}</div></section>;
}

function LeaderCard({ title, accent, value, metric, onClick }) {
  return <button className={`leader-card ${accent}`} onClick={onClick}><div className="leader-card-top"><span>{title}</span><span className="leader-arrow">↗</span></div>{value ? <><div className="leader-name">{value.name}</div><div className="leader-team">{value.teamName || value.teamId || 'Tournament leader'}</div><div className="leader-bottom"><strong>{metric === 'mvpScore' ? Math.round(value[metric] || 0) : value[metric] || 0}</strong><span>{metric === 'runs' ? 'RUNS' : metric === 'wickets' ? 'WICKETS' : 'MVP PTS'}</span></div></> : <div className="leader-empty">Yet to be decided</div>}</button>;
}

function LeagueTable({ room }) {
  const standings = room.standings || [];
  return <div className="league-table-wrap"><table className="league-table"><thead><tr><th>#</th><th>TEAM</th><th>PLD</th><th>W</th><th>L</th><th>NRR</th><th>PTS</th></tr></thead><tbody>{standings.map((t) => <tr key={t.userId}><td><span className={`position ${t.position <= 4 ? 'qualify' : ''}`}>{t.position}</span></td><td><div className="table-team"><TeamLogo teamKey={t.teamShort} short={t.teamShort} className="table-team-logo" title={t.teamName} /><div><strong>{t.teamName}</strong><small>{t.userName}</small></div></div></td><td>{t.played}</td><td>{t.won}</td><td>{t.lost}</td><td className={t.nrr > 0 ? 'positive-nrr' : t.nrr < 0 ? 'negative-nrr' : ''}>{t.nrr > 0 ? '+' : ''}{Number(t.nrr || 0).toFixed(3)}</td><td><strong className="points-cell">{t.points}</strong></td></tr>)}</tbody></table>{!standings.length && <div className="table-empty">The points table will update after the first match.</div>}</div>;
}

function FinalistsScreen({ room, isHost, onStart }) {
  const finalists = (room.playoff?.finalists || []).map((id) => getTeam(room, id)).filter(Boolean);
  return <section className="finalists-screen glass-card"><div className="eyebrow"><span className="eyebrow-line" /> THE FINAL IS SET</div><div className="finalists-trophy">♜</div><h2>The last two <em>standing.</em></h2><p>Qualifier 1 and Qualifier 2 have delivered your finalists.</p><div className="finalists-versus">{finalists.map((u, i) => <React.Fragment key={u.id}>{i === 1 && <div className="finalist-vs">VS</div>}<div className="finalist-team" style={{ '--team-color': u.teamColor }}><TeamLogo teamKey={u.teamShort} short={u.teamShort} className="finalist-crest" title={u.teamName} /><strong>{u.teamName}</strong><span>Managed by {u.name}</span></div></React.Fragment>)}</div>{isHost ? <button className="button primary final-start-button" onClick={onStart}>Start the final <span>↗</span></button> : <div className="awaiting-host large">The host will start the final.</div>}</section>;
}

function ChampionScreen({ room, openStats }) {
  const champion = getTeam(room, room.championId);
  const leaders = room.playerLeaders || {};
  return <div className="champion-page"><section className="champion-hero"><div className="champion-sparks">✦ <span>✧</span> ✦</div><div className="eyebrow"><span className="eyebrow-line" /> THE SEASON IS COMPLETE</div><div className="champion-cup">♜</div><div className="champion-label">IPL AUCTION ARENA CHAMPIONS</div><h1>{champion?.teamName || 'Tournament champion'}<br /><em>take the crown.</em></h1><div className="champion-manager">{champion?.teamShort} · Managed by {champion?.name}</div><div className="champion-actions"><button className="button primary" onClick={() => document.getElementById('final-stats')?.scrollIntoView({ behavior: 'smooth' })}>View season stats ↓</button><button className="button secondary" onClick={() => openStats('more')}>Awards & records ↗</button></div></section><section className="champion-awards" id="final-stats"><div className="award-tile orange"><span>ORANGE CAP</span><strong>{leaders.orangeCap?.[0]?.name || '—'}</strong><b>{leaders.orangeCap?.[0]?.runs || 0} runs</b></div><div className="award-tile purple"><span>PURPLE CAP</span><strong>{leaders.purpleCap?.[0]?.name || '—'}</strong><b>{leaders.purpleCap?.[0]?.wickets || 0} wickets</b></div><div className="award-tile mvp"><span>TOURNAMENT MVP</span><strong>{leaders.mvp?.[0]?.name || '—'}</strong><b>{Math.round(leaders.mvp?.[0]?.mvpScore || 0)} MVP pts</b></div></section><section className="glass-card table-card champion-table"><div className="panel-header"><div><span className="section-kicker">FINAL STANDINGS</span><h3>The completed league table</h3></div><span className="table-note">{room.totalLeagueMatches} LEAGUE MATCHES</span></div><LeagueTable room={room} /></section><div className="final-review-row"><div><span className="section-kicker">FULL TOURNAMENT RECORD</span><h3>Every run, wicket and result.</h3><p>Review leaderboards and player milestones from the season.</p></div><button className="button primary" onClick={() => openStats('more')}>Open full stats ↗</button></div></div>;
}

function StatsModal({ room, tab, setTab, onClose }) {
  const tabs = [
    ['orangeCap', 'Orange cap'], ['purpleCap', 'Purple cap'], ['mvp', 'MVP'], ['more', 'More stats'],
  ];
  const leaders = room.playerLeaders || {};
  const keyFor = { orangeCap: 'orangeCap', purpleCap: 'purpleCap', mvp: 'mvp' };
  const isMore = tab === 'more';
  const singleRows = !isMore ? (leaders[keyFor[tab]] || []) : [];
  const tables = isMore ? [
    ['Most sixes', leaders.mostSixes || [], 'sixes', 'SIX'],
    ['Most fours', leaders.mostFours || [], 'fours', 'FOUR'],
    ['Best strike rate · min 12 balls', leaders.bestStrikeRate || [], 'strikeRate', 'SR'],
    ['Best economy · min 2 overs', leaders.bestEconomy || [], 'economy', 'ECON'],
    ['Best bowling figures', leaders.bestFigures || [], 'bestBowling', 'FIG'],
    ['Most 50s', leaders.mostFifties || [], 'fifties', '50s'],
    ['Most 100s', leaders.mostHundreds || [], 'hundreds', '100s'],
  ] : [];
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="stats-modal glass-card"><div className="modal-header"><div><span className="section-kicker">TOURNAMENT ANALYTICS</span><h2>Leaderboards & <em>records.</em></h2></div><button className="modal-close" onClick={onClose}>×</button></div><div className="modal-tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div><div className="modal-body">{!isMore ? <div className="leaderboard-list">{singleRows.length ? singleRows.map((p, index) => <div className="leaderboard-row" key={p.playerId || p.name}><span className="leaderboard-rank">{String(index + 1).padStart(2, '0')}</span><div className="leaderboard-player"><strong>{p.name}</strong><span>{p.teamName || p.teamId || '—'}</span></div><strong className="leaderboard-value">{tab === 'orangeCap' ? p.runs : tab === 'purpleCap' ? p.wickets : Math.round(p.mvpScore || 0)}<small>{tab === 'orangeCap' ? 'RUNS' : tab === 'purpleCap' ? 'WKT' : 'MVP PTS'}</small></strong></div>) : <div className="modal-empty">No tournament records yet. They will build as matches finish.</div>}</div> : <div className="stats-tables">{tables.map(([title, rows, field, label]) => <section className="stats-table-block" key={title}><h3>{title}</h3>{rows.length ? rows.map((p, i) => <div className="stats-mini-row" key={`${title}-${p.playerId || p.name}`}><span>{i + 1}</span><div><strong>{p.name}</strong><small>{p.teamName || p.teamId || '—'}</small></div><b>{field === 'strikeRate' || field === 'economy' ? Number(p[field] || 0).toFixed(2) : p[field] || 0}<small>{label}</small></b></div>) : <p className="muted mini-empty">No data yet.</p>}</section>)}</div>}</div><div className="modal-footer"><span>Stats update after every completed match.</span><button className="button secondary" onClick={onClose}>Close</button></div></div></div>;
}

function Confetti({ kind, token }) {
  const pieces = useMemo(() => Array.from({ length: kind === 'win' ? 90 : kind === 'wicket' ? 28 : 36 }, (_, i) => ({
    id: `${token}-${i}`, x: `${Math.random() * 100}%`, delay: `${Math.random() * 0.3}s`, duration: `${0.75 + Math.random() * 1.5}s`, rotate: `${Math.random() * 720 - 360}deg`, size: `${4 + Math.random() * 7}px`, hue: kind === 'wicket' ? Math.round(Math.random() * 12) : Math.round(Math.random() * 360),
  })), [kind, token]);
  return <div className={`confetti-layer ${kind}`} key={token} aria-hidden="true">{pieces.map((p) => <i key={p.id} style={{ '--x': p.x, '--delay': p.delay, '--duration': p.duration, '--rotate': p.rotate, '--size': p.size, '--hue': p.hue }} />)}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
