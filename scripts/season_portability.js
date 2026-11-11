// Export/import immutable season snapshots without copying a live SQLite database.
const fs = require("node:fs");
const path = require("node:path");
const { createSeasonStore } = require("../server/seasons");

const [action, arg, output] = process.argv.slice(2);
const dbPath = path.resolve(
  process.env.SEASONS_DB_PATH ||
    path.join(__dirname, "..", ".local", "seasons.sqlite"),
);
const store = createSeasonStore(dbPath);
try {
  if (action === "export") {
    const id = Number(arg);
    if (!Number.isSafeInteger(id) || id < 1 || !output)
      throw new Error("Usage: export <season-id> <output.json>");
    const season = store.get(id);
    if (!season) throw new Error(`Season ${id} not found.`);
    delete season.id;
    fs.writeFileSync(
      path.resolve(output),
      JSON.stringify({
        sourceKey: `import:local:season:${id}:${season.startedAt}`,
        season,
      }),
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Exported season ${id} to ${output}.`);
  } else if (action === "import") {
    if (!arg) throw new Error("Usage: import <input.json>");
    const input = fs.readFileSync(path.resolve(arg), "utf8");
    if (input.length > 16 * 1024 * 1024)
      throw new Error("Season export is too large.");
    const { sourceKey, season } = JSON.parse(input);
    if (
      !/^import:local:season:[1-9]\d*:\d+$/.test(sourceKey || "") ||
      !Array.isArray(season?.teams) ||
      !season.teams.length ||
      !Array.isArray(season?.matches) ||
      !season.matches.length ||
      !season.champion ||
      !Number.isSafeInteger(season.completedAt)
    )
      throw new Error("Invalid season export.");
    const saved = store.save(sourceKey, season);
    console.log(
      `${saved.created ? "Imported" : "Already imported"} season as #${saved.id}.`,
    );
  } else
    throw new Error(
      "Usage: export <season-id> <output.json> | import <input.json>",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  store.close();
}
