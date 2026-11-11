// Server-owner utility for linking an older season's display name after its player registers.
const path = require("node:path");
const { createSeasonStore } = require("../server/seasons");
const { createIdentityStore, ID_PATTERN } = require("../server/identity");

const [seasonNumber, displayName, identityId] = process.argv.slice(2);
const id = Number(seasonNumber);
if (
  !Number.isSafeInteger(id) ||
  id < 1 ||
  !displayName ||
  !ID_PATTERN.test(identityId || "")
) {
  console.error(
    "Usage: node scripts/link_season_identity.js <season-id> <exact-display-name> <registered-user-id>",
  );
  process.exit(1);
}
const dbPath = path.resolve(
  process.env.SEASONS_DB_PATH ||
    path.join(__dirname, "..", ".local", "seasons.sqlite"),
);
const identities = createIdentityStore(
  path.join(path.dirname(dbPath), "identities.sqlite"),
);
const seasons = createSeasonStore(dbPath);
try {
  if (!identities.exists(identityId))
    throw new Error(`@${identityId} has not registered yet.`);
  const season = seasons.get(id);
  if (!season) throw new Error(`Season ${id} does not exist.`);
  const matches = season.teams.filter((team) => team.name === displayName);
  if (matches.length !== 1)
    throw new Error(
      `Expected one exact display-name match; found ${matches.length}.`,
    );
  if (matches[0].identityId && matches[0].identityId !== identityId)
    throw new Error("That entry is already linked to another identity.");
  seasons.linkMember(id, matches[0].id, identityId);
  console.log(`Linked ${displayName} in season ${id} to @${identityId}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  seasons.close();
  identities.close();
}
