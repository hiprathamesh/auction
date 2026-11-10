const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { safeOn } = require("../server/safeEvents");

test("an unexpected action exception is contained and acknowledged", () => {
  const socket = new EventEmitter();
  let message;
  let response;
  socket.on("app:error", (error) => {
    message = error.message;
  });
  safeOn(socket, "action", () => {
    throw new Error("test exception");
  });
  const original = console.error;
  try {
    console.error = () => {};
    assert.doesNotThrow(() =>
      socket.emit("action", {}, (result) => {
        response = result;
      }),
    );
  } finally {
    console.error = original;
  }
  assert.match(message, /could not be completed/i);
  assert.equal(response.ok, false);
});
