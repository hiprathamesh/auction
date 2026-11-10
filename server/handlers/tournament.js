const { makeDoubleRoundRobin } = require("../cricket");

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
  onAction("host:startLeague", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== "lineup") return;
    if (room.users.length < 2)
      return emitError(
        socket,
        "At least two teams are required to start a league.",
      );
    const notReady = room.users.filter(
      (u) =>
        !u.xiReady ||
        !Array.isArray(u.lineup) ||
        u.lineup.length !== 11 ||
        new Set(u.lineup).size !== 11 ||
        u.squad.filter((p) => u.lineup.includes(p.id) && p.legend).length >
          game.MAX_LEGENDS_XI ||
        !Array.isArray(u.bowlerIds) ||
        u.bowlerIds.length !== 5 ||
        new Set(u.bowlerIds).size !== 5 ||
        u.bowlerIds.some((id) => !u.lineup.includes(id)) ||
        !u.tactics ||
        !["aggressive", "balanced", "conservative"].includes(
          u.tactics.fielding,
        ) ||
        !["powerplay", "balanced", "death"].includes(u.tactics.bowling) ||
        !["powerplay", "buildup", "finish"].includes(u.tactics.batting),
    );
    if (notReady.length)
      return emitError(
        socket,
        `Waiting for playing XIs: ${notReady.map((u) => u.teamShort).join(", ")}.`,
      );
    room.phase = "league";
    room.fixtures = makeDoubleRoundRobin(room.users);
    room.matchResults = [];
    room.standings = [];
    room.playerStats = {};
    room.playoff = {
      round: null,
      q1WinnerId: null,
      q1LoserId: null,
      eliminatorWinnerId: null,
      finalists: [],
    };
    room.championId = null;
    room.currentMatch = null;
    room.lastNotice = {
      kind: "leagueStart",
      text: `The league is underway: ${room.fixtures.length} matches.`,
    };
    game.broadcast(io, room);
    const first = room.fixtures.find((f) => f.type === "league" && !f.played);
    if (first) game.startLiveMatch(io, room, first);
  });

  onAction("host:startPlayoffs", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    const result = game.startPlayoffs(io, room);
    if (result.error) emitError(socket, result.error);
  });

  onAction("host:startFinal", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user) || room.phase !== "finalReady") return;
    const [first, second] = room.playoff.finalists;
    if (!first || !second) return emitError(socket, "Finalists are not ready.");
    room.phase = "final";
    room.playoff.round = "Final";
    room.lastNotice = { kind: "finalStart", text: "The final starts now." };
    game.broadcast(io, room);
    game.startLiveMatch(io, room, {
      id: "final",
      type: "final",
      round: "Final",
      homeId: first,
      awayId: second,
      played: false,
    });
  });

  onAction("host:skipMatch", () => {
    const { room, user } = getRoomAndUser(socket);
    if (
      !verifyHost(socket, room, user) ||
      room.simulationPaused ||
      !room.currentMatch ||
      !room.liveResult
    )
      return;
    room.liveEventIndex = room.liveEvents.length;
    game.finishLiveMatch(io, room, 700);
  });

  onAction("host:resumeSimulation", () => {
    const { room, user } = getRoomAndUser(socket);
    if (!verifyHost(socket, room, user)) return;
    if (!game.resumeSimulation(io, room))
      emitError(socket, "There is no paused simulation to resume.");
  });
};
