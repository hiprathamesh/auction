import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { socket } from "./socket";
import { money, getTeam } from "./lib/format";
import {
  initialRoomCode,
  readRoomSession,
  saveRoomSession,
  forgetRoomSession,
  markSeatReplaced,
  wasSeatReplaced,
  setRoomUrl,
} from "./lib/roomSession";
import { ArenaBrand } from "./components/Brand";
import { HostControls } from "./components/HostControls";
import { StatsModal } from "./components/StatsModal";
import { Confetti } from "./components/Confetti";
import rules from "../shared/rules.json";
import { LandingScreen } from "./screens/LandingScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { AuctionScreen } from "./screens/AuctionScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { LineupScreen } from "./screens/LineupScreen";
import { SimulationScreen } from "./screens/SimulationScreen";
import "./styles.css";

const initialTeams = rules.franchises;
const roleShort = {
  Batter: "BAT",
  Bowler: "BOWL",
  "All-rounder": "AR",
  Wicketkeeper: "WK",
};
const DEFAULT_AUCTION_LEGEND_LIMIT = rules.defaultLegendAuctionLimit;
const MAX_XI_LEGENDS = rules.maxPlayingXILegends;
const { minBowlingOptions, maxBowlingOptions } = rules;
const hasBowlingUnit = (ids = []) =>
  ids.length >= minBowlingOptions && ids.length <= maxBowlingOptions;
const isBattingCapable = (player) =>
  ["Batter", "Wicketkeeper", "All-rounder"].includes(player?.role);
const preferredPositions = (player) =>
  isBattingCapable(player) && Array.isArray(player?.preferredBattingPositions)
    ? player.preferredBattingPositions
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 11)
        .sort((a, b) => a - b)
    : [];
const formatPreferredPositions = (positions) => {
  const list = [...new Set(positions || [])].sort((a, b) => a - b);
  if (!list.length) return "";
  const contiguous = list.every((n, i) => i === 0 || n === list[i - 1] + 1);
  return contiguous && list.length > 1
    ? `${list[0]}–${list[list.length - 1]}`
    : list.join(", ");
};
const canBuildLegalXI = (squad = []) => {
  const players = Array.isArray(squad) ? squad : [];
  const indianNonLegends = players.filter(
    (p) => !p.overseas && !p.legend,
  ).length;
  const indianLegends = players.filter((p) => !p.overseas && p.legend).length;
  const overseasNonLegends = players.filter(
    (p) => p.overseas && !p.legend,
  ).length;
  const overseasLegends = players.filter((p) => p.overseas && p.legend).length;
  let maximum = 0;
  for (
    let overseasLegendsPicked = 0;
    overseasLegendsPicked <= Math.min(4, overseasLegends);
    overseasLegendsPicked++
  ) {
    maximum = Math.max(
      maximum,
      indianNonLegends +
        Math.min(indianLegends, MAX_XI_LEGENDS - overseasLegendsPicked) +
        Math.min(overseasNonLegends, 4 - overseasLegendsPicked) +
        overseasLegendsPicked,
    );
  }
  return maximum >= 11;
};
const TACTIC_OPTIONS = {
  fielding: {
    title: "Fielding",
    options: [
      {
        id: "aggressive",
        label: "Aggressive",
        description: "A tighter field cuts off easy singles.",
        tradeoff: "More boundary risk.",
      },
      {
        id: "balanced",
        label: "Balanced",
        description: "A flexible field with an even mix of coverage.",
      },
      {
        id: "conservative",
        label: "Conservative",
        description: "Protect the rope and favor safer catching positions.",
        tradeoff: "Concedes more singles and twos.",
      },
    ],
  },
  bowling: {
    title: "Bowling",
    options: [
      {
        id: "powerplay",
        label: "Powerplay",
        description: "Favor your strongest bowlers in the first six overs.",
        tradeoff: "Fewer of their overs left for the finish.",
      },
      {
        id: "balanced",
        label: "Balanced",
        description: "Spread overs across the selected bowling unit.",
      },
      {
        id: "death",
        label: "Death overs",
        description: "Save your strongest bowlers for the final five overs.",
        tradeoff: "Supporting bowlers carry more early overs.",
      },
    ],
  },
  batting: {
    title: "Batting",
    options: [
      {
        id: "powerplay",
        label: "Fast start",
        description: "Look for more boundaries in the first six overs.",
        tradeoff: "Slightly more wicket risk.",
      },
      {
        id: "buildup",
        label: "Build-up",
        description: "Start steadily and keep wickets in hand.",
        tradeoff: "Fewer early boundaries.",
      },
      {
        id: "finish",
        label: "Strong finish",
        description: "Save more of the attack for the final five overs.",
        tradeoff: "May start slower.",
      },
    ],
  },
};
const DEFAULT_TACTICS = rules.defaultTactics;
const sortPlayer = (a, b, showRatings) =>
  showRatings ? (b.ovr || 0) - (a.ovr || 0) : a.name.localeCompare(b.name);
const bidIncrement = (price) => {
  return rules.bidLadder.find(
    (step) => step.below === null || price < step.below,
  ).increment;
};
const bidAmount = (lot, multiplier = 1) => {
  if (!lot) return 0;
  const current = lot.currentBidderId
    ? Number(lot.currentBid)
    : Number(lot.basePrice);
  let amount = current;
  const increments = lot.currentBidderId ? multiplier : multiplier - 1;
  for (let step = 0; step < increments; step++)
    amount = Number((amount + bidIncrement(amount)).toFixed(2));
  return amount;
};
const nextBid = (lot) => bidAmount(lot, 1);

function App() {
  const [room, setRoom] = useState(null);
  const [meId, setMeId] = useState(null);
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const desiredRoom = useRef(roomCode);
  const attachedSeat = useRef(null);
  const restoreSeat = useRef(() => {});
  const cancelRestore = useRef(() => {});
  const resumeRequested = useRef(false);
  const replacedRoom = useRef(null);
  const [displayName, setDisplayName] = useState("");
  const [identity, setIdentity] = useState(null);
  const [identifiedSeat, setIdentifiedSeat] = useState(false);
  const [teamId, setTeamId] = useState("MI");
  const [playerCount, setPlayerCount] = useState(null);
  const [hostRecoveryToken, setHostRecoveryToken] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [view, setView] = useState(
    new URLSearchParams(window.location.search).get("identity")
      ? "identity"
      : roomCode
        ? "join"
        : "create",
  );
  const [seatOffer, setSeatOffer] = useState(null);
  const [seatStatus, setSeatStatus] = useState(() =>
    roomCode &&
    !new URLSearchParams(window.location.search).has("identity") &&
    !wasSeatReplaced(roomCode)
      ? "checking"
      : null,
  );
  useEffect(() => {
    fetch("/api/identity", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((data) => setIdentity(data.id || null))
      .catch(() => {});
  }, []);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [auctionToast, setAuctionToast] = useState("");
  const [autoSkip, setAutoSkip] = useState(false);
  // Private per-viewer RTM state is delivered separately from the shared room snapshot.
  // Keeping an explicit default prevents the RTM holder's render from referencing
  // an undeclared value when private activation is enabled.
  const [privateRtmState, setPrivateRtmState] = useState({
    playerId: null,
    isHolder: false,
    isOn: false,
  });
  const [retention, setRetention] = useState(null);
  const [ownSquadOvrs, setOwnSquadOvrs] = useState({});
  const [expandedBidderId, setExpandedBidderId] = useState(null);
  const [tradeTarget, setTradeTarget] = useState("");
  const [tradeOwnPlayer, setTradeOwnPlayer] = useState("");
  const [tradeTheirPlayer, setTradeTheirPlayer] = useState("");
  const [modal, setModal] = useState(null);
  const [modalTab, setModalTab] = useState("orangeCap");
  const [lineupSelection, setLineupSelection] = useState([]);
  const [bowlerSelection, setBowlerSelection] = useState([]);
  const [tacticsSelection, setTacticsSelection] = useState(DEFAULT_TACTICS);
  const [bowlingPlan, setBowlingPlan] = useState({});
  const [superOverPlan, setSuperOverPlan] = useState({});
  const [editingPlan, setEditingPlan] = useState(false);
  const [lineupHydrated, setLineupHydrated] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");
  const [currentBall, setCurrentBall] = useState(null);
  const [ballTrail, setBallTrail] = useState([]);
  const [celebrations, setCelebrations] = useState([]);
  const nextCelebrationId = useRef(0);
  const [matchBanner, setMatchBanner] = useState(null);
  const [appOnline, setAppOnline] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const roomVersion = useRef(null);

  const me = useMemo(
    () => room?.users?.find((u) => u.id === meId) || null,
    [room, meId],
  );
  const isHost = Boolean(me && me.id === room?.hostId);
  const allReady = Boolean(
    room?.users?.length && room.users.every((u) => u.ready),
  );
  const allXIsReady = Boolean(
    room?.users?.length &&
    room.users.every(
      (u) =>
        u.xiReady &&
        u.lineup?.length === 11 &&
        hasBowlingUnit(u.bowlerIds) &&
        u.bowlerIds.every((id) => u.lineup.includes(id)) &&
        u.squad.filter((p) => u.lineup.includes(p.id) && p.legend).length <=
          MAX_XI_LEGENDS,
    ),
  );
  const allSquadsHaveXI = Boolean(
    room?.users?.length && room.users.every((u) => canBuildLegalXI(u.squad)),
  );
  const currentMatch = room?.currentMatch;
  const canEditBetweenStages = Boolean(
    me &&
    ((room?.phase === "leagueComplete" &&
      room.standings.slice(0, 4).some((t) => t.userId === me.id)) ||
      (room?.phase === "finalReady" && room.playoff.finalists.includes(me.id))),
  );
  const showTeamPlan =
    room?.phase === "lineup" || (canEditBetweenStages && editingPlan);
  const currentLot = room?.currentLot;

  const flashFx = useCallback((kind) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = ++nextCelebrationId.current;
    setCelebrations((active) => [...active, { id, kind }]);
  }, []);
  const clearCelebration = useCallback((id) => {
    setCelebrations((active) => active.filter((burst) => burst.id !== id));
  }, []);

  useEffect(() => {
    let request = 0;
    let ready = false;
    let reconnectTimer;
    const finishRestore = () => {
      setSeatStatus(null);
      setAppOnline(true);
    };
    const findSeat = async (code, currentRequest, fallback) => {
      const result = await socket
        .timeout(5000)
        .emitWithAck("room:findSeat", { code });
      if (request !== currentRequest) return;
      if (!result?.ok) throw new Error(result?.message);
      finishRestore();
      attachedSeat.current = null;
      setRoom(null);
      setMeId(null);
      setView("join");
      setSeatOffer(result.seat);
      setError(result.seat ? "" : fallback || "");
    };
    restoreSeat.current = async (code, explicit = false) => {
      desiredRoom.current = code;
      const currentRequest = ++request;
      setSeatOffer(null);
      setSeatStatus("checking");
      setError("");
      const saved =
        attachedSeat.current?.code === code
          ? attachedSeat.current
          : readRoomSession(code);
      try {
        if (!saved)
          return await findSeat(
            code,
            currentRequest,
            explicit
              ? "No saved seat was found. Sign in with the identity you used to join, then try again."
              : "",
          );
        const result = await socket.timeout(5000).emitWithAck("room:rejoin", {
          code,
          userId: saved.userId,
          reconnectToken: saved.reconnectToken,
        });
        if (request !== currentRequest || result?.ok) return;
        if (result?.code === "ROOM_SEAT_INVALID")
          return await findSeat(code, currentRequest, result.message);
        if (!result?.code) throw new Error();
        attachedSeat.current = null;
        setRoom(null);
        setMeId(null);
        const signIn = result.code === "ROOM_IDENTITY_REQUIRED";
        setView(signIn ? "identity" : "join");
        if (signIn) setIdentity(null);
        finishRestore();
        setError(result.message);
      } catch {
        if (request !== currentRequest) return;
        setSeatStatus("retry");
        setAppOnline(socket.connected && !attachedSeat.current);
        setError(
          "The room couldn’t confirm your seat. Your saved credentials are still here.",
        );
      }
    };
    cancelRestore.current = () => {
      request++;
      desiredRoom.current = "";
      resumeRequested.current = false;
      setSeatOffer(null);
      setSeatStatus(null);
      setError("");
      setAppOnline(socket.connected);
    };
    const onConnected = () => {
      const code = desiredRoom.current;
      if (
        code &&
        (resumeRequested.current ||
          (replacedRoom.current !== code &&
            !wasSeatReplaced(code) &&
            (ready ||
              !new URLSearchParams(window.location.search).has("identity"))))
      ) {
        const explicit = resumeRequested.current;
        resumeRequested.current = false;
        restoreSeat.current(code, explicit);
      } else setAppOnline(true);
      ready = true;
    };
    const onDisconnected = (reason) => {
      request++;
      setAppOnline(false);
      setSeatOffer(null);
      const code = desiredRoom.current;
      if (code && replacedRoom.current !== code && !wasSeatReplaced(code))
        setSeatStatus("checking");
      if (reason === "io server disconnect")
        reconnectTimer = window.setTimeout(() => socket.connect(), 500);
    };
    const onJoined = ({
      roomCode: code,
      userId,
      isHost: host,
      identified,
      reconnectToken,
      hostRecoveryToken: recoveryToken,
    }) => {
      request++;
      roomVersion.current = null;
      desiredRoom.current = code;
      replacedRoom.current = null;
      const saved = readRoomSession(code);
      const existing = saved?.userId === userId ? saved : null;
      const session = {
        userId,
        reconnectToken: reconnectToken || existing?.reconnectToken,
        hostRecoveryToken: host
          ? recoveryToken || existing?.hostRecoveryToken
          : undefined,
      };
      attachedSeat.current = { code, ...session };
      setRoomCode(code);
      setMeId(userId);
      setIdentifiedSeat(identified);
      setAutoSkip(false);
      setPrivateRtmState({ playerId: null, isHolder: false, isOn: false });
      setRetention(null);
      setOwnSquadOvrs({});
      if (session.reconnectToken) saveRoomSession(code, session);
      setRoomUrl(code);
      setHostRecoveryToken(session.hostRecoveryToken || "");
      setSeatOffer(null);
      finishRestore();
      setView("room");
      setError("");
      setNotice(host ? "Host session connected." : "You joined the room.");
    };
    const onUpdate = (next) => {
      roomVersion.current = next.version;
      setRoom(next);
      const score = next.currentMatch?.live && next.currentMatch.liveScore;
      setCurrentBall(score ? { ...score, score: score.runs } : null);
      setBallTrail(next.currentMatch?.recentBalls || []);
      if (next.phase === "complete")
        setMatchBanner({ championId: next.championId });
    };
    const onPatch = (patch) => {
      if (!patch || roomVersion.current !== patch.previousVersion) {
        if (socket.connected) socket.emit("room:sync");
        return;
      }
      roomVersion.current = patch.version;
      setRoom((previous) =>
        previous
          ? { ...previous, ...patch.changes, version: patch.version }
          : previous,
      );
      const match = patch.changes?.currentMatch;
      if (match?.live && match.liveScore) {
        setCurrentBall({ ...match.liveScore, score: match.liveScore.runs });
        setBallTrail(match.recentBalls || []);
      }
      if (patch.changes?.phase === "complete")
        setMatchBanner({ championId: patch.changes.championId });
    };
    const onAppError = (payload) => {
      const message = payload?.message || "Something went wrong.";
      if (payload?.code === "ROOM_IDENTITY_REQUIRED") {
        request++;
        attachedSeat.current = null;
        setRoom(null);
        setMeId(null);
        setIdentity(null);
        setSeatStatus(null);
        setView("identity");
      }
      setError(message);
      setNotice("");
    };
    const onPrivateRoomState = (payload = {}) => {
      setAutoSkip(Boolean(payload.autoSkip));
      setRetention(payload.retention ?? null);
      setPrivateRtmState({
        playerId: payload.rtmPlayerId || null,
        isHolder: Boolean(payload.isRtmHolder),
        isOn: Boolean(payload.rtmIsOn),
      });
      setOwnSquadOvrs(
        payload.ownSquadOvrs && typeof payload.ownSquadOvrs === "object"
          ? payload.ownSquadOvrs
          : {},
      );
    };
    const onRoomNotice = (payload) => {
      if (!payload?.text) return;
      if (payload.kind === "rtm") {
        setAuctionToast(payload.text);
        window.setTimeout(
          () => setAuctionToast((old) => (old === payload.text ? "" : old)),
          4800,
        );
        return;
      }
      setNotice(payload.text);
      if (
        [
          "auctionStopped",
          "auctionComplete",
          "leagueComplete",
          "finalists",
        ].includes(payload.kind)
      )
        setMatchBanner(null);
      window.setTimeout(
        () => setNotice((old) => (old === payload.text ? "" : old)),
        4300,
      );
    };
    const onMatchStart = ({ match }) => {
      setCurrentBall(null);
      setBallTrail([]);
      setMatchBanner({ match });
      setNotice("");
    };
    const onInningsStart = (payload) => {
      setCurrentBall({
        inningsIndex: payload.inningsIndex,
        score: 0,
        wickets: 0,
        balls: 0,
        overs: "0.0",
        battingTeamName: payload.teamName,
        battingTeamId: payload.teamId,
        target: payload.target || null,
        superOver: Boolean(payload.superOver),
        superOverRound: payload.superOverRound,
        maxBalls: payload.maxBalls,
      });
      setBallTrail([]);
      setMatchBanner(null);
    };
    const onBall = (ball) => {
      const overEnd = ball.legal && ball.balls % 6 === 0;
      setCurrentBall((previous) => ({
        ...ball,
        completedOver: overEnd
          ? {
              ...ball,
              commentary: `End of over ${ball.overs} · ${ball.score}/${ball.wickets}`,
            }
          : previous?.completedOver,
      }));
      setBallTrail((prev) => [
        ...prev.slice(-9),
        {
          outcome: ball.outcome,
          runs: ball.runs,
          wicket: ball.wicket,
          extraType: ball.extraType,
          overEnd,
          key: ball.key,
        },
      ]);
      if (ball.wicket) flashFx("wicket");
      else if (ball.outcome === "SIX") flashFx("six");
      else if (ball.outcome === "FOUR") flashFx("four");
      else if (
        ball.batter1 &&
        (ball.batter1.runs === 50 || ball.batter1.runs === 100)
      )
        flashFx("milestone");
    };
    const onInningsEnd = (payload) => {
      setCurrentBall((prev) => ({
        ...prev,
        score: payload.runs,
        wickets: payload.wickets,
        overs: payload.overs,
        inningsEnded: true,
      }));
    };
    const onMatchEnd = (result) => {
      setCurrentBall((prev) => (prev ? { ...prev, matchOver: true } : prev));
      setMatchBanner({ result });
      if (result?.winnerId) flashFx("win");
    };
    const onChampion = () => flashFx("win");
    socket.on("connect", onConnected);
    socket.on("disconnect", onDisconnected);
    const onConnectError = () => {
      const code = desiredRoom.current;
      if (code && replacedRoom.current !== code && !wasSeatReplaced(code)) {
        setSeatStatus("retry");
        setError("Trying to reconnect to the room. Your seat is still saved.");
      }
    };
    socket.on("connect_error", onConnectError);
    socket.on("room:joined", onJoined);
    const onKicked = ({ message } = {}) => {
      request++;
      const seat = attachedSeat.current;
      if (seat) forgetRoomSession(seat.code, seat.userId);
      attachedSeat.current = null;
      desiredRoom.current = "";
      setRoomUrl("");
      setSeatStatus(null);
      setRoom(null);
      setMeId(null);
      setRoomCode("");
      setView("join");
      setError(message || "The host removed you from the room.");
      setNotice("");
    };
    const onReplaced = ({ message } = {}) => {
      request++;
      replacedRoom.current = desiredRoom.current;
      markSeatReplaced(desiredRoom.current);
      attachedSeat.current = null;
      setRoom(null);
      setMeId(null);
      setAppOnline(false);
      setSeatStatus("retry");
      setView("join");
      setError(message || "This seat was opened in another tab or browser.");
    };
    const onHostRecoveryToken = ({ hostRecoveryToken: recoveryToken }) => {
      const seat = attachedSeat.current;
      if (seat) {
        seat.hostRecoveryToken = recoveryToken;
        saveRoomSession(seat.code, seat);
      }
      setHostRecoveryToken(recoveryToken);
      setNotice(
        "Your host recovery code has changed. Save the new code somewhere safe.",
      );
    };
    socket.on("room:kicked", onKicked);
    socket.on("room:replaced", onReplaced);
    socket.on("host:recoveryToken", onHostRecoveryToken);
    socket.on("room:update", onUpdate);
    socket.on("room:patch", onPatch);
    socket.on("app:error", onAppError);
    socket.on("room:notice", onRoomNotice);
    socket.on("room:privateState", onPrivateRoomState);
    socket.on("simulation:matchStart", onMatchStart);
    socket.on("simulation:inningsStart", onInningsStart);
    socket.on("simulation:ball", onBall);
    socket.on("simulation:inningsEnd", onInningsEnd);
    socket.on("simulation:matchEnd", onMatchEnd);
    socket.on("simulation:champion", onChampion);
    if (socket.connected) onConnected();
    return () => {
      request++;
      window.clearTimeout(reconnectTimer);
      socket.off("connect", onConnected);
      socket.off("disconnect", onDisconnected);
      socket.off("connect_error", onConnectError);
      socket.off("room:joined", onJoined);
      socket.off("room:kicked", onKicked);
      socket.off("room:replaced", onReplaced);
      socket.off("host:recoveryToken", onHostRecoveryToken);
      socket.off("room:update", onUpdate);
      socket.off("room:patch", onPatch);
      socket.off("app:error", onAppError);
      socket.off("room:notice", onRoomNotice);
      socket.off("room:privateState", onPrivateRoomState);
      socket.off("simulation:matchStart", onMatchStart);
      socket.off("simulation:inningsStart", onInningsStart);
      socket.off("simulation:ball", onBall);
      socket.off("simulation:inningsEnd", onInningsEnd);
      socket.off("simulation:matchEnd", onMatchEnd);
      socket.off("simulation:champion", onChampion);
    };
  }, [flashFx]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/players/count", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (Number.isInteger(result?.count)) setPlayerCount(result.count);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (showTeamPlan) {
      if (!lineupHydrated && me) {
        setLineupSelection(Array.isArray(me.lineup) ? me.lineup : []);
        setBowlerSelection(Array.isArray(me.bowlerIds) ? me.bowlerIds : []);
        setTacticsSelection({ ...DEFAULT_TACTICS, ...(me.tactics || {}) });
        setBowlingPlan(me.bowlingPlan || {});
        setSuperOverPlan(me.superOverPlan || {});
        setLineupHydrated(true);
      }
    } else {
      setLineupSelection([]);
      setBowlerSelection([]);
      setTacticsSelection(DEFAULT_TACTICS);
      setLineupHydrated(false);
    }
  }, [showTeamPlan, me?.id, lineupHydrated]);

  useEffect(() => {
    if (!canEditBetweenStages) setEditingPlan(false);
  }, [canEditBetweenStages]);

  const emitAction = (event, ...args) => {
    if (!socket.connected || (room && !appOnline)) {
      setError("You are disconnected. Reconnect before continuing.");
      return;
    }
    socket.emit(event, ...args);
  };
  const createRoom = () => {
    setError("");
    emitAction("room:create", { name: displayName, teamId });
  };
  const retrySeat = () => {
    const code = roomCode.trim().toUpperCase();
    desiredRoom.current = code;
    if (socket.connected) restoreSeat.current(code, true);
    else {
      resumeRequested.current = true;
      setSeatStatus("checking");
      socket.connect();
    }
  };
  const joinRoom = async () => {
    const code = roomCode.trim().toUpperCase();
    if (readRoomSession(code)) return retrySeat();
    if (!socket.connected) return;
    desiredRoom.current = code;
    setError("");
    try {
      const result = await socket
        .timeout(5000)
        .emitWithAck("room:join", { code, name: displayName, teamId });
      if (result.seat) setSeatOffer(result.seat);
      if (!result.ok) {
        setError(result.message);
        if (result.code === "ROOM_IDENTITY_REQUIRED") {
          setIdentity(null);
          setView("identity");
        }
      }
    } catch {
      setError("The join wasn’t confirmed. Try returning to your seat.");
    }
  };
  const recoverSeat = async () => {
    if (!seatOffer || !socket.connected) return;
    const { code, recoveryId } = seatOffer;
    setSeatStatus("checking");
    try {
      const result = await socket
        .timeout(5000)
        .emitWithAck("room:recoverSeat", { code, recoveryId });
      if (!result.ok) {
        setSeatOffer(null);
        setSeatStatus("retry");
        setError(result.message);
      }
    } catch {
      setSeatOffer(null);
      setSeatStatus("retry");
      setError("Recovery wasn’t confirmed. Check for your saved seat again.");
    }
  };
  const recoverHost = () => {
    if (!socket.connected) {
      setError("Reconnect to the server before continuing.");
      return;
    }
    setError("");
    socket.emit("room:recoverHost", {
      code: roomCode,
      recoveryToken: recoveryInput.trim(),
    });
  };
  const hostAction = (event, ...args) => emitAction(event, ...args);
  const chooseToss = (matchId, decision) =>
    emitAction("simulation:chooseToss", { matchId, decision });
  const kickUser = (target) => {
    if (!isHost || !target || target.id === meId) return;
    const squadCount = Number(target.squadCount || 0);
    const offline = target.connected
      ? "They are currently connected."
      : "They are currently disconnected.";
    const recovered = squadCount
      ? `\n\nTheir ${squadCount} squad player${squadCount === 1 ? "" : "s"} will return to the auction pool.`
      : "";
    const lineupWarning =
      room?.phase === "lineup"
        ? "\n\nThe app will return to Auction Results and reset everyone’s XI readiness."
        : "";
    const prompt = `Remove ${target.name} (${target.teamShort}) from this room?\n${offline}${recovered}${lineupWarning}\n\nThis removes their team from the current game.`;
    if (window.confirm(prompt))
      emitAction("host:kickUser", { userId: target.id });
  };
  const setSetting = (key, value) =>
    emitAction("host:settings", { [key]: value });
  const isMyBid = currentLot?.currentBidderId === meId;
  const isMyOut = Boolean(currentLot?.outUserIds?.includes(meId));
  const myOverseas = me?.squad?.filter((p) => p.overseas).length || 0;
  const myKeepers =
    me?.squad?.filter((p) => p.role === "Wicketkeeper").length || 0;
  const myLegendCount = Number.isFinite(me?.legendCount)
    ? me.legendCount
    : me?.squad?.filter((p) => p.legend).length || 0;
  const configuredLegendLimit =
    room?.settings?.legendAuctionLimit ?? DEFAULT_AUCTION_LEGEND_LIMIT;
  const auctionLegendLimit =
    configuredLegendLimit === "unlimited"
      ? Infinity
      : Number(configuredLegendLimit || DEFAULT_AUCTION_LEGEND_LIMIT);
  const legendLimitLabel = Number.isFinite(auctionLegendLimit)
    ? auctionLegendLimit
    : "∞";
  const legendLimitReached = Boolean(
    currentLot?.player?.legend && myLegendCount >= auctionLegendLimit,
  );
  const canBid = Boolean(
    appOnline &&
    room?.phase === "auction" &&
    currentLot &&
    !room.auctionPaused &&
    !isMyBid &&
    !isMyOut &&
    (me?.squadCount || 0) < 25 &&
    (!currentLot.player.legend || myLegendCount < auctionLegendLimit) &&
    (!currentLot.player.overseas || myOverseas < 8),
  );
  const bidPriceFor = (multiplier = 1) => bidAmount(currentLot, multiplier);
  const configuredMultipliers = room?.settings?.bidMultipliers || [2, 5, 10];
  const canBidAt = (multiplier = 1) =>
    Boolean(canBid && Number(me?.purse || 0) + 1e-6 >= bidPriceFor(multiplier));
  const rtmHolder = currentLot?.rtmHolderUserId
    ? room?.users?.find((u) => u.id === currentLot.rtmHolderUserId)
    : null;
  const isMyRtmHolder = Boolean(rtmHolder && rtmHolder.id === meId);
  // The server sends viewer-specific room snapshots, so this state is true
  // for the RTM holder in private mode and for everyone in public mode.
  const rtmIsOnForMe =
    room?.settings?.rtmPublicStatus === false
      ? Boolean(
          isMyRtmHolder &&
          privateRtmState.playerId === currentLot?.player?.id &&
          privateRtmState.isHolder &&
          privateRtmState.isOn,
        )
      : Boolean(currentLot?.rtmIsOn);
  const isMyRtmArmed = Boolean(isMyRtmHolder && rtmIsOnForMe);
  const canMarkOut = Boolean(
    appOnline &&
    room?.phase === "auction" &&
    currentLot &&
    !room.auctionPaused &&
    !isMyBid &&
    !isMyOut &&
    !isMyRtmArmed,
  );
  const myRtmRemaining = Number(me?.rtmUsesRemaining || 0);
  const canArmRtm = Boolean(
    appOnline &&
    isMyRtmHolder &&
    room?.settings?.rtmEnabled &&
    (!room.previousSeasonId || identifiedSeat) &&
    !isMyOut &&
    myRtmRemaining > 0 &&
    me?.purse >= (currentLot?.currentBid || 0) &&
    (me?.squadCount || 0) < 25 &&
    (!currentLot?.player?.legend || myLegendCount < auctionLegendLimit) &&
    (!currentLot?.player?.overseas || myOverseas < 8),
  );
  const placeBid = (multiplier) => {
    if (!socket.connected || !canBidAt(multiplier)) return;
    const actionId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    socket.timeout(5000).emit(
      "auction:bid",
      {
        lotId: currentLot.id,
        multiplier,
        expectedBid: bidPriceFor(multiplier),
        actionId,
      },
      (error, result) => {
        if (error)
          setError(
            "The bid was not confirmed. Check the current lot before trying again.",
          );
        else if (!result?.ok && result?.message) setError(result.message);
      },
    );
  };

  const copyInvite = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(`${url}\nRoom code: ${room.code}`);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setNotice(`Invite link: ${url} · Room code: ${room.code}`);
    }
  };

  const bestFiveBowlers = (playerIds) => {
    const roleTieBreak = (player) =>
      player.role === "Bowler" ? 2 : player.role === "All-rounder" ? 1 : 0;
    return [...playerIds]
      .map((id) => me?.squad?.find((player) => player.id === id))
      .filter(Boolean)
      .sort((a, b) => {
        if (Number.isFinite(a.bowling) && Number.isFinite(b.bowling)) {
          return (
            b.bowling - a.bowling ||
            (b.ovr || 0) - (a.ovr || 0) ||
            roleTieBreak(b) - roleTieBreak(a)
          );
        }
        const rankA = Number.isFinite(a.bowlingRank)
          ? a.bowlingRank
          : Number.MAX_SAFE_INTEGER;
        const rankB = Number.isFinite(b.bowlingRank)
          ? b.bowlingRank
          : Number.MAX_SAFE_INTEGER;
        return (
          rankA - rankB ||
          roleTieBreak(b) - roleTieBreak(a) ||
          a.name.localeCompare(b.name)
        );
      })
      .slice(0, 5)
      .map((player) => player.id);
  };

  const toggleLineupPlayer = (id) => {
    let next;
    if (lineupSelection.includes(id)) {
      next = lineupSelection.filter((x) => x !== id);
    } else {
      if (lineupSelection.length >= 11) {
        setError(
          "You can select only 11 players. Remove one before adding another.",
        );
        return;
      }
      const player = me?.squad?.find((p) => p.id === id);
      if (
        player?.overseas &&
        me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.overseas)
          .length >= 4
      ) {
        setError(
          "An IPL playing XI can contain at most four overseas players.",
        );
        return;
      }
      if (
        player?.legend &&
        me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.legend)
          .length >= MAX_XI_LEGENDS
      ) {
        setError(
          `Your playing XI can contain at most ${MAX_XI_LEGENDS} legends. You can keep the others in your squad as substitutes.`,
        );
        return;
      }
      next = [...lineupSelection, id];
    }
    setLineupSelection(next);
    const recommended = bestFiveBowlers(next);
    const preserved = bowlerSelection.filter((bowlerId) =>
      next.includes(bowlerId),
    );
    setBowlerSelection(
      [
        ...preserved,
        ...recommended.filter((bowlerId) => !preserved.includes(bowlerId)),
      ].slice(0, Math.max(minBowlingOptions, preserved.length)),
    );
    setError("");
  };

  const moveBattingOrder = (index, direction) => {
    if (me?.xiReady && !editingPlan) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= lineupSelection.length) return;
    setLineupSelection((previous) => {
      const next = [...previous];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const toggleBowler = (id) => {
    if (me?.xiReady && !editingPlan) return;
    const selected = bowlerSelection.includes(id);
    if (selected) {
      setBowlerSelection(bowlerSelection.filter((x) => x !== id));
    } else {
      if (bowlerSelection.length >= maxBowlingOptions) {
        setError(
          "Choose up to seven bowlers. Remove one before selecting another.",
        );
        return;
      }
      if (!lineupSelection.includes(id)) {
        setError("Only players in your selected XI can bowl.");
        return;
      }
      setBowlerSelection([...bowlerSelection, id]);
    }
    setError("");
  };

  const setTactic = (group, value) => {
    if (!me?.xiReady || editingPlan)
      setTacticsSelection((previous) => ({ ...previous, [group]: value }));
  };

  const saveLineup = () => {
    if (lineupSelection.length !== 11 || new Set(lineupSelection).size !== 11) {
      setError("Select exactly 11 different players.");
      return;
    }
    const selectedLegendCount =
      me?.squad?.filter((p) => lineupSelection.includes(p.id) && p.legend)
        .length || 0;
    if (selectedLegendCount > MAX_XI_LEGENDS) {
      setError(
        `Your playing XI can contain at most ${MAX_XI_LEGENDS} legends.`,
      );
      return;
    }
    if (
      !hasBowlingUnit(bowlerSelection) ||
      new Set(bowlerSelection).size !== bowlerSelection.length ||
      bowlerSelection.some((id) => !lineupSelection.includes(id))
    ) {
      setError("Choose five to seven bowlers from your playing XI.");
      return;
    }
    if (!socket.connected) {
      setError("Reconnect before submitting your match plan.");
      return;
    }
    setError("");
    socket.timeout(5000).emit(
      "lineup:set",
      {
        playerIds: lineupSelection,
        bowlerIds: bowlerSelection,
        tactics: tacticsSelection,
        bowlingPlan: Object.fromEntries(
          Object.entries(bowlingPlan).filter(
            ([role, id]) =>
              bowlerSelection.includes(id) &&
              (role !== "backup" ||
                (bowlerSelection.length > minBowlingOptions &&
                  ![bowlingPlan.powerplay, bowlingPlan.death].includes(id))),
          ),
        ),
        superOverPlan: {
          batters: (superOverPlan.batters || []).filter((id) =>
            lineupSelection.includes(id),
          ),
          bowler: lineupSelection.includes(superOverPlan.bowler)
            ? superOverPlan.bowler
            : null,
        },
      },
      (error, result) => {
        if (error || !result?.ok) {
          setError(result?.message || "Your match plan was not confirmed.");
          return;
        }
        if (editingPlan) {
          setEditingPlan(false);
          return;
        }
        if (!socket.connected) {
          setError("Reconnect before marking your team ready.");
          return;
        }
        socket
          .timeout(5000)
          .emit("lineup:ready", true, (readyError, readyResult) => {
            if (readyError || !readyResult?.ok) {
              setError(
                readyResult?.message || "Your readiness was not confirmed.",
              );
              return;
            }
            setNotice(
              "Playing XI, batting order, bowling unit and tactics submitted. Waiting for other teams.",
            );
          });
      },
    );
  };

  const openStats = (tab) => {
    setModalTab(tab);
    setModal("stats");
  };
  const phaseLabel =
    {
      lobby: "LOBBY",
      auction: room?.auctionPaused ? "AUCTION PAUSED" : "LIVE AUCTION",
      auctionResults: "SQUAD REVIEW",
      lineup: "PICK YOUR XI",
      league: "LEAGUE LIVE",
      leagueComplete: "LEAGUE COMPLETE",
      playoffs: `PLAYOFFS · ${room?.playoff?.round || ""}`,
      finalReady: "FINALISTS",
      final: "THE FINAL",
      complete: "CHAMPIONS",
    }[room?.phase] || "ROOM";

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <ArenaBrand
          onClick={() => {
            if (room) return;
            cancelRestore.current();
            setView("create");
          }}
        />
        <div className="topbar-right">
          {room && (
            <>
              <span
                className={`phase-chip ${room.phase === "auction" ? "live" : ""}`}
              >
                {room.phase === "auction" && <i />}
                {phaseLabel}
              </span>
              <span className="room-code">
                <span>ROOM</span> {room.code}
              </span>
            </>
          )}
          {identity && (
            <a
              className="hub-header-link"
              href="/s"
              title="Your Hub"
              aria-label="Your Hub"
            >
              <span className="hub-header-icon" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="hub-header-label">Hub</span>
            </a>
          )}
          <span className={`connection ${appOnline ? "online" : ""}`}>
            <i />
            {appOnline ? "Online" : "Offline"}
          </span>
        </div>
      </header>

      {room && isHost && (
        <HostControls
          room={room}
          recoveryToken={hostRecoveryToken}
          online={appOnline}
          identity={identity && identifiedSeat}
        />
      )}

      {room && seatStatus && (
        <div className="wrap room-reconnect" role="status">
          {seatStatus === "checking"
            ? "Reconnecting to your seat…"
            : "Your seat is still saved."}
          {seatStatus === "retry" && (
            <button className="button secondary small" onClick={retrySeat}>
              Retry connection
            </button>
          )}
        </div>
      )}

      {!room && (
        <LandingScreen
          {...{
            playerCount,
            view,
            setView: (next) => {
              cancelRestore.current();
              if (next === "identity") desiredRoom.current = roomCode;
              setView(next);
            },
            displayName,
            setDisplayName,
            createRoom,
            joinRoom,
            roomCode,
            setRoomCode,
            recoveryInput,
            setRecoveryInput,
            initialTeams,
            teamId,
            setTeamId,
            error,
            appOnline,
            recoverHost,
            identity,
            setIdentity,
            clearError: () => setError(""),
            onSignedOut: () => cancelRestore.current(),
            seatStatus,
            seatOffer,
            retrySeat,
            recoverSeat,
            dismissSeatRecovery: () => {
              cancelRestore.current();
              setView("join");
            },
          }}
        />
      )}

      {room && room.phase === "lobby" && (
        <LobbyScreen
          {...{
            copyInvite,
            shareCopied,
            room,
            meId,
            isHost,
            kickUser,
            setSetting,
            me,
            emitAction,
            appOnline,
            allReady,
            hostAction,
            retention,
            identity: identity && identifiedSeat,
          }}
        />
      )}

      {room && room.phase === "auction" && (
        <AuctionScreen
          {...{
            room,
            me,
            money,
            myOverseas,
            myKeepers,
            myLegendCount,
            legendLimitLabel,
            sortPlayer,
            roleShort,
            preferredPositions,
            formatPreferredPositions,
            ownSquadOvrs,
            currentLot,
            isMyBid,
            canBidAt,
            placeBid,
            isMyOut,
            legendLimitReached,
            nextBid,
            bidPriceFor,
            configuredMultipliers,
            canMarkOut,
            autoSkip,
            isMyRtmArmed,
            emitAction,
            rtmIsOnForMe,
            isMyRtmHolder,
            appOnline,
            canArmRtm,
            myRtmRemaining,
            rtmHolder,
            notice,
            expandedBidderId,
            meId,
            setExpandedBidderId,
            isHost,
            kickUser,
            hostAction,
          }}
        />
      )}

      {room && room.phase === "auctionResults" && (
        <ResultsScreen
          {...{
            room,
            isHost,
            hostAction,
            allSquadsHaveXI,
            me,
            meId,
            tradeTarget,
            getTeam,
            emitAction,
            setTradeTarget,
            setTradeTheirPlayer,
            tradeOwnPlayer,
            setTradeOwnPlayer,
            roleShort,
            tradeTheirPlayer,
            DEFAULT_AUCTION_LEGEND_LIMIT,
            kickUser,
          }}
        />
      )}

      {room && showTeamPlan && (
        <LineupScreen
          {...{
            auctionLegendLimit,
            lineupSelection,
            bowlerSelection,
            bowlingPlan,
            setBowlingPlan,
            superOverPlan,
            setSuperOverPlan,
            hasBowlingUnit,
            maxBowlingOptions,
            editingPlan,
            closeTeamPlan: () => setEditingPlan(false),
            suggestPlan: () => {
              const plan = me.suggestedPlan;
              if (!plan) return;
              setLineupSelection(plan.lineup);
              setBowlerSelection(plan.bowlerIds);
              setBowlingPlan(plan.bowlingPlan);
              setSuperOverPlan(plan.superOverPlan);
            },
            me,
            MAX_XI_LEGENDS,
            activeFilter,
            setActiveFilter,
            sortPlayer,
            room,
            toggleLineupPlayer,
            roleShort,
            money,
            preferredPositions,
            formatPreferredPositions,
            moveBattingOrder,
            toggleBowler,
            TACTIC_OPTIONS,
            tacticsSelection,
            setTactic,
            emitAction,
            saveLineup,
            isHost,
            meId,
            kickUser,
            allXIsReady,
            hostAction,
          }}
        />
      )}

      {room &&
        !showTeamPlan &&
        [
          "league",
          "leagueComplete",
          "playoffs",
          "finalReady",
          "final",
          "complete",
        ].includes(room.phase) && (
          <SimulationScreen
            {...{
              room,
              openStats,
              isHost,
              hostAction,
              currentMatch,
              meId,
              chooseToss,
              currentBall,
              ballTrail,
              matchBanner,
              openTeamPlan: canEditBetweenStages
                ? () => setEditingPlan(true)
                : null,
              getTeam,
            }}
          />
        )}

      {modal === "stats" && room && (
        <StatsModal
          room={room}
          tab={modalTab}
          setTab={setModalTab}
          onClose={() => setModal(null)}
        />
      )}
      {error && room && (
        <div className="toast error-toast" role="alert">
          <span>!</span>
          <div>{error}</div>
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
      {notice &&
        room &&
        ["lobby", "auctionResults", "lineup"].includes(room.phase) && (
          <div className="toast notice-toast">
            <span>◆</span>
            <div>{notice}</div>
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
      {auctionToast && room?.phase === "auction" && (
        <div className="toast notice-toast auction-rtm-toast" role="status">
          <span>◆</span>
          <div>{auctionToast}</div>
          <button onClick={() => setAuctionToast("")}>×</button>
        </div>
      )}
      {celebrations.map(({ id, kind }) => (
        <Confetti key={id} id={id} kind={kind} onFinish={clearCelebration} />
      ))}
      <footer className="site-footer">
        <span>
          AUCTION ARENA <b>·</b> LOCAL HOSTED IPL GAME
        </span>
        <span>
          Built for the group chat <i>✦</i>
        </span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
