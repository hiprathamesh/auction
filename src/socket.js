import { io } from "socket.io-client";

export const socket = io({
  autoConnect: true,
  // Start with HTTP and upgrade when WebSocket is reachable on this network.
  transports: ["polling", "websocket"],
  tryAllTransports: true,
});
