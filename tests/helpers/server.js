const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { io } = require("socket.io-client");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nextEvent(socket, name, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeoutMs);
    const listener = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off(name, listener);
      resolve(value);
    };
    socket.on(name, listener);
  });
}

async function startServer(t, extraEnv = {}) {
  // Bind a child process to an OS-assigned loopback port, without touching a running game.
  const bootstrap = `
    const http = require('node:http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (_port, _host, callback) {
      return listen.call(this, 0, '127.0.0.1', () => {
        console.log('TEST_PORT:' + this.address().port);
        if (callback) callback();
      });
    };
    require('./server/index');
  `;
  const child = spawn(process.execPath, ["-e", bootstrap], {
    cwd: require("node:path").resolve(__dirname, "../.."),
    env: { ...process.env, PORT: "0", ROOM_CHECKPOINTS: "0", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const sockets = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  t.after(() => {
    sockets.forEach((socket) => socket.disconnect());
    child.kill();
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Server failed to start: ${stderr}`)),
      5000,
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/TEST_PORT:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${stderr}`));
    });
  });
  const url = `http://127.0.0.1:${port}`;
  return {
    child,
    url,
    stderr: () => stderr,
    async connect() {
      const socket = io(url, {
        transports: ["websocket"],
        reconnection: false,
      });
      socket.testRoomEvents = new EventEmitter();
      socket.testRoom = null;
      socket.on("room:update", (room) => {
        socket.testRoom = room;
        socket.testRoomEvents.emit("state", room);
      });
      socket.on("room:patch", (patch) => {
        if (
          !socket.testRoom ||
          socket.testRoom.version !== patch.previousVersion
        ) {
          socket.emit("room:sync");
          return;
        }
        socket.testRoom = {
          ...socket.testRoom,
          ...patch.changes,
          version: patch.version,
        };
        socket.testRoomEvents.emit("state", socket.testRoom);
      });
      sockets.push(socket);
      await nextEvent(socket, "connect");
      return socket;
    },
  };
}

function nextRoom(socket, predicate = () => true, timeoutMs) {
  return nextEvent(socket.testRoomEvents, "state", predicate, timeoutMs);
}

async function createRoom(socket, name = "Host", teamId = "CSK") {
  const joined = nextEvent(socket, "room:joined");
  socket.emit("room:create", { name, teamId });
  return joined;
}

async function joinRoom(socket, code, name = "Friend", teamId = "MI") {
  const joined = nextEvent(socket, "room:joined");
  socket.emit("room:join", { code, name, teamId });
  return joined;
}

module.exports = {
  wait,
  nextEvent,
  nextRoom,
  startServer,
  createRoom,
  joinRoom,
};
