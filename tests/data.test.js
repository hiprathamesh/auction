const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { validatePlayerDatabase } = require("../server/playerDatabase");
const { FRANCHISES } = require("../server/game");
const database = require("../data/players.json");

test("the player database and referenced portraits are valid", () => {
  assert.deepEqual(
    validatePlayerDatabase(database, {
      publicDirectory: path.resolve(__dirname, "../public"),
      franchiseIds: FRANCHISES.map((team) => team.id),
    }),
    [],
  );
});

test("invalid player records are reported with actionable errors", () => {
  const broken = {
    ...database,
    players: [{ ...database.players[0], ovr: 120 }, database.players[0]],
  };
  const errors = validatePlayerDatabase(broken);
  assert.ok(errors.some((error) => error.includes("invalid ovr")));
  assert.ok(errors.some((error) => error.includes("duplicate player ID")));
});

test("database regeneration preserves the current player values and rejects unknown headings", (t) => {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "auction-regen-test-"),
  );
  t.after(() => {
    assert.ok(temporary.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(temporary, "data"));
  fs.mkdirSync(path.join(temporary, "scripts"));
  for (const name of ["auction_players_list.txt", "player-overrides.json"])
    fs.copyFileSync(
      path.join(root, "data", name),
      path.join(temporary, "data", name),
    );
  fs.copyFileSync(
    path.join(root, "scripts/build_player_db.py"),
    path.join(temporary, "scripts/build_player_db.py"),
  );
  const python =
    process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const script = path.join(temporary, "scripts/build_player_db.py");
  const generated = spawnSync(python, [script], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const data = JSON.parse(
    fs.readFileSync(path.join(temporary, "data/players.json"), "utf8"),
  );
  assert.deepEqual(data.players, database.players);
  fs.appendFileSync(
    path.join(temporary, "data/auction_players_list.txt"),
    "\nZZ123\n",
  );
  const invalid = spawnSync(python, [script], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown auction-set heading/);
});
