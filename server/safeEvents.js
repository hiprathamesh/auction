function safeOn(socket, event, handler) {
  return socket.on(event, (...args) => {
    const fail = (error) => {
      console.error(`Socket action ${event} failed:`, error);
      const message = "The action could not be completed. Please try again.";
      socket.emit("app:error", { message });
      const acknowledgement = args[args.length - 1];
      if (typeof acknowledgement === "function")
        acknowledgement({ ok: false, message });
    };
    try {
      const result = handler(...args);
      if (result && typeof result.then === "function") result.catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

module.exports = { safeOn };
