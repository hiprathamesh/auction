import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { socket } from "./socket";
import { money, getTeam } from "./lib/format";
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
    title: "FIELDING STRATEGY",
    question: "How do you set the field?",
    options: [
      {
        id: "aggressive",
        label: "Aggressive",
        pro: "PRO · Fewer easy singles",
        con: "CON · More boundary risk",
        description:
          "Attack the batters with a tighter, more aggressive field.",
      },
      {
        id: "balanced",
        label: "Balanced",
        pro: "PRO · Reliable mix",
        con: "CON · No phase-specific edge",
        description: "A flexible field with no deliberate bias.",
      },
      {
        id: "conservative",
        label: "Conservative",
        pro: "PRO · Better catching chances",
        con: "CON · More singles and twos",
        description: "Protect the rope and prioritize safe catching positions.",
      },
    ],
  },
  bowling: {
    title: "BOWLING PLAN",
    question: "When do your best bowlers attack?",
    options: [
      {
        id: "powerplay",
        label: "Best in Powerplay",
        pro: "PRO · Strong first six overs",
        con: "CON · Less firepower saved for the end",
        description:
          "Your top two bowlers target two overs each in the first six when possible.",
      },
      {
        id: "balanced",
        label: "Balanced",
        pro: "PRO · Even workload",
        con: "CON · No phase-specific edge",
        description: "Distribute the five-bowler unit across the innings.",
      },
      {
        id: "death",
        label: "Best at Death",
        pro: "PRO · Strong last five overs",
        con: "CON · Supporting bowlers carry more early overs",
        description:
          "Your top two bowlers target two overs each in the final five when possible.",
      },
    ],
  },
  batting: {
    title: "BATTING STRATEGY",
    question: "How do you build the innings?",
    options: [
      {
        id: "powerplay",
        label: "Aggressive Powerplay",
        pro: "PRO · More early boundaries",
        con: "CON · Slightly more wicket risk",
        description: "Take more attacking options in the first six overs.",
      },
      {
        id: "buildup",
        label: "Build-up",
        pro: "PRO · Safer start",
        con: "CON · Fewer early boundaries",
        description:
          "Prioritize steady scoring early and let player ratings drive the contest.",
      },
      {
        id: "finish",
        label: "Strong Finish",
        pro: "PRO · More late hitting",
        con: "CON · May start slower",
        description:
          "Preserve a little more early and attack harder in the final five overs.",
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
  const [meId, setMeId] = useState(localStorage.getItem("iplUserId") || null);
  const [roomCode, setRoomCode] = useState(
    new URLSearchParams(window.location.search).get("room") ||
      localStorage.getItem("iplRoomCode") ||
      "",
  );
  const [displayName, setDisplayName] = useState("");
  const [identity, setIdentity] = useState(null);
  const [identifiedSeat, setIdentifiedSeat] = useState(false);
  const [teamId, setTeamId] = useState("MI");
  const [playerCount, setPlayerCount] = useState(null);
  const [hostRecoveryToken, setHostRecoveryToken] = useState(
    localStorage.getItem("iplHostRecoveryToken") || "",
  );
  const [recoveryInput, setRecoveryInput] = useState("");
  const [view, setView] = useState(
    new URLSearchParams(window.location.search).get("identity")
      ? "identity"
      : new URLSearchParams(window.location.search).get("room")
        ? "join"
        : "create",
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
  // Private per-viewer RTM state is delivered separately from the shared room snapshot.
  // Keeping an explicit default prevents the RTM holder's render from referencing
  // an undeclared value when private activation is enabled.
  const [privateRtmState, setPrivateRtmState] = useState({
    playerId: null,
    isHolder: false,
    isOn: false,
  });
  const [ownSquadOvrs, setOwnSquadOvrs] = useState({});
  const [expandedBidderId, setExpandedBidderId] = useState(null);
  const [tradeTarget, setTradeTarget] = useState("");
  const [tradeOwnPlayer, setTradeOwnPlayer] = useState("");
  const [tradeTheirPlayer, setTradeTheirPlayer] = useState("");
  const [modal, setModal] = useState(null);
  const [modalTab, setModalTab] = useState("orangeCap");
  const [lineupSelection, setLineupSelection] = useState([]);
  const [bowlerSelection, setBowlerSelection] = useState([]);
  const [bowlerSelectionManual, setBowlerSelectionManual] = useState(false);
  const [tacticsSelection, setTacticsSelection] = useState(DEFAULT_TACTICS);
  const [lineupHydrated, setLineupHydrated] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");
  const [currentBall, setCurrentBall] = useState(null);
  const [ballTrail, setBallTrail] = useState([]);
  const [fx, setFx] = useState({ kind: "", token: 0 });
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
        u.bowlerIds?.length === 5 &&
        u.bowlerIds.every((id) => u.lineup.includes(id)) &&
        u.squad.filter((p) => u.lineup.includes(p.id) && p.legend).length <=
          MAX_XI_LEGENDS,
    ),
  );
  const allSquadsHaveXI = Boolean(
    room?.users?.length && room.users.every((u) => canBuildLegalXI(u.squad)),
  );
  const currentMatch = room?.currentMatch;
  const currentLot = room?.currentLot;

  const flashFx = useCallback((kind) => {
    setFx((old) => ({ kind, token: old.token + 1 }));
    window.setTimeout(
      () => setFx((old) => (old.kind === kind ? { ...old, kind: "" } : old)),
      kind === "win" ? 2100 : 950,
    );
  }, []);

  useEffect(() => {
    let waitingForRejoin = false;
    const onConnected = () => {
      setAppOnline(true);
      const storedId = localStorage.getItem("iplUserId");
      const storedCode = localStorage.getItem("iplRoomCode");
      const reconnectToken = localStorage.getItem("iplReconnectToken");
      const urlRoom = new URLSearchParams(window.location.search).get("room");
      if (
        storedId &&
        storedCode &&
        reconnectToken &&
        (!urlRoom || urlRoom.toUpperCase() === storedCode.toUpperCase())
      ) {
        waitingForRejoin = true;
        socket.emit("room:rejoin", {
          code: storedCode,
          userId: storedId,
          reconnectToken,
        });
      } else if (urlRoom) {
        setRoomCode(urlRoom.toUpperCase());
        setView("join");
      }
    };
    const onDisconnected = () => setAppOnline(false);
    const onJoined = ({
      roomCode: code,
      userId,
      isHost: host,
      identified,
      reconnectToken,
      hostRecoveryToken: recoveryToken,
    }) => {
      waitingForRejoin = false;
      roomVersion.current = null;
      setRoomCode(code);
      setMeId(userId);
      setIdentifiedSeat(identified);
      setPrivateRtmState({ playerId: null, isHolder: false, isOn: false });
      setOwnSquadOvrs({});
      localStorage.setItem("iplRoomCode", code);
      localStorage.setItem("iplUserId", userId);
      if (reconnectToken)
        localStorage.setItem("iplReconnectToken", reconnectToken);
      if (recoveryToken) {
        localStorage.setItem("iplHostRecoveryToken", recoveryToken);
        setHostRecoveryToken(recoveryToken);
      }
      setView("room");
      setError("");
      setNotice(host ? "Host session connected." : "You joined the room.");
    };
    const onUpdate = (next) => {
      roomVersion.current = next.version;
      setRoom(next);
      if (next.currentMatch?.live && next.currentMatch.liveScore) {
        const score = next.currentMatch.liveScore;
        setCurrentBall({ ...score, score: score.runs });
      }
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
      if (match?.live && match.liveScore)
        setCurrentBall({ ...match.liveScore, score: match.liveScore.runs });
      if (patch.changes?.phase === "complete")
        setMatchBanner({ championId: patch.changes.championId });
    };
    const onAppError = (payload) => {
      const message = payload?.message || "Something went wrong.";
      if (payload?.code === "ROOM_IDENTITY_REQUIRED") {
        waitingForRejoin = false;
        setRoom(null);
        setMeId(null);
        setView("identity");
      } else if (waitingForRejoin) {
        waitingForRejoin = false;
        setRoom(null);
        setMeId(null);
        setView("join");
        localStorage.removeItem("iplUserId");
        localStorage.removeItem("iplReconnectToken");
      }
      setError(message);
      setNotice("");
    };
    const onPrivateRoomState = (payload = {}) => {
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
      });
      setBallTrail([]);
      setMatchBanner(null);
    };
    const onBall = (ball) => {
      setCurrentBall(ball);
      setBallTrail((prev) => [
        ...prev.slice(-9),
        {
          outcome: ball.outcome,
          runs: ball.runs,
          wicket: ball.wicket,
          key: ball.key,
        },
      ]);
      if (ball.wicket) flashFx("wicket");
      else if (ball.outcome === "SIX" || ball.outcome === "FOUR")
        flashFx("boundary");
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
    socket.on("room:joined", onJoined);
    const onKicked = ({ message } = {}) => {
      localStorage.removeItem("iplUserId");
      localStorage.removeItem("iplRoomCode");
      localStorage.removeItem("iplReconnectToken");
      setRoom(null);
      setMeId(null);
      setRoomCode("");
      setView("join");
      setError(message || "The host removed you from the room.");
      setNotice("");
    };
    const onReplaced = ({ message } = {}) => {
      setRoom(null);
      setMeId(null);
      setAppOnline(false);
      setView("join");
      setError(message || "This seat was opened in another tab or browser.");
    };
    const onHostRecoveryToken = ({ hostRecoveryToken: recoveryToken }) => {
      localStorage.setItem("iplHostRecoveryToken", recoveryToken);
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
      socket.off("connect", onConnected);
      socket.off("disconnect", onDisconnected);
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
    if (room?.phase === "lineup") {
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

  const emitAction = (event, ...args) => {
    if (!socket.connected) {
      setError("You are disconnected. Reconnect before continuing.");
      return;
    }
    socket.emit(event, ...args);
  };
  const createRoom = () => {
    setError("");
    emitAction("room:create", { name: displayName, teamId });
  };
  const joinRoom = () => {
    setError("");
    emitAction("room:join", { code: roomCode, name: displayName, teamId });
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
  const hostAction = (event) => emitAction(event);
  const kickUser = (target) => {
    if (!isHost || !target || target.id === meId) return;
    const purchased = Number(target.squadCount || 0);
    const offline = target.connected
      ? "They are currently connected."
      : "They are currently disconnected.";
    const recovered = purchased
      ? `\n\nTheir ${purchased} purchased player${purchased === 1 ? "" : "s"} will return to the unsold pool so the group can re-auction them.`
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
    if (!bowlerSelectionManual) {
      setBowlerSelection(recommended);
    } else {
      const preserved = bowlerSelection
        .filter((bowlerId) => next.includes(bowlerId))
        .slice(0, 5);
      setBowlerSelection(
        [
          ...preserved,
          ...recommended.filter((bowlerId) => !preserved.includes(bowlerId)),
        ].slice(0, 5),
      );
    }
    setError("");
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
      if (bowlerSelection.length >= 5) {
        setError(
          "Choose exactly five bowlers. Remove one before selecting another.",
        );
        return;
      }
      if (!lineupSelection.includes(id)) {
        setError("Only players in your selected XI can bowl.");
        return;
      }
      setBowlerSelection([...bowlerSelection, id]);
    }
    setBowlerSelectionManual(true);
    setError("");
  };

  const setTactic = (group, value) => {
    if (!me?.xiReady)
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
      bowlerSelection.length !== 5 ||
      new Set(bowlerSelection).size !== 5 ||
      bowlerSelection.some((id) => !lineupSelection.includes(id))
    ) {
      setError("Choose exactly five bowlers from your playing XI.");
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
      },
      (error, result) => {
        if (error || !result?.ok) {
          setError(result?.message || "Your match plan was not confirmed.");
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
        <ArenaBrand onClick={() => !room && setView("create")} />
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

      {!room && (
        <LandingScreen
          {...{
            playerCount,
            view,
            setView,
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

      {room && room.phase === "lineup" && (
        <LineupScreen
          {...{
            auctionLegendLimit,
            lineupSelection,
            bowlerSelection,
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
              currentBall,
              ballTrail,
              matchBanner,
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
      {fx.kind && <Confetti kind={fx.kind} token={fx.token} />}
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
