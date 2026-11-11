const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createIdentityStore } = require("../server/identity");

test("an identity keeps a hashed PIN and revocable browser session across restarts", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-identity-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "identities.sqlite");
  let store = createIdentityStore(file);
  assert.equal(store.identify("BadId", "1234").status, 400);
  assert.equal(store.identify("abc1", "12ab").status, 400);
  const registered = store.identify("captain7", "1234");
  assert.equal(registered.id, "captain7");
  assert.equal(store.session(`arena_session=${registered.token}`), "captain7");
  assert.equal(store.identify("captain7", "0000").status, 401);
  store.close();
  const raw = fs.readFileSync(file);
  assert.equal(raw.includes(Buffer.from("1234")), false);
  assert.equal(raw.includes(Buffer.from(registered.token)), false);
  store = createIdentityStore(file);
  assert.equal(
    store.session(`other=1; arena_session=${registered.token}; x=2`),
    "captain7",
  );
  store.logout(`arena_session=${registered.token}`);
  assert.equal(store.session(`arena_session=${registered.token}`), null);
  const loggedInAgain = store.identify("captain7", "1234");
  assert.equal(loggedInAgain.id, "captain7");
  store.close();
});

test("five incorrect PIN attempts temporarily lock the identity", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-pin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createIdentityStore(path.join(directory, "identities.sqlite"));
  store.identify("player99", "4567");
  for (let i = 0; i < 5; i++)
    assert.equal(store.identify("player99", "1111").status, 401);
  assert.equal(store.identify("player99", "4567").status, 429);
  store.close();
});
