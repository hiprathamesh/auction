const fs = require("node:fs");
const path = require("node:path");

function validatePlayerDatabase(
  database,
  { publicDirectory, franchiseIds } = {},
) {
  const errors = [];
  if (
    !database ||
    !Array.isArray(database.setOrder) ||
    !Array.isArray(database.players) ||
    !database.players.length
  ) {
    return ["Expected a non-empty player list and a set order."];
  }
  const sets = new Set(database.setOrder);
  if (
    sets.size !== database.setOrder.length ||
    database.setOrder.some((set) => typeof set !== "string" || !set.trim())
  )
    errors.push("Auction set names must be unique non-empty strings.");
  const ids = new Set();
  for (const player of database.players) {
    if (
      !player ||
      typeof player.id !== "string" ||
      !/^[a-z0-9-]+$/.test(player.id) ||
      ids.has(player.id)
    ) {
      errors.push(`Invalid or duplicate player ID: ${player?.id}`);
      continue;
    }
    ids.add(player.id);
    const prefix = `${player.id}: `;
    if (typeof player.name !== "string" || !player.name.trim())
      errors.push(`${prefix}missing name`);
    if (!sets.has(player.set)) errors.push(`${prefix}unknown auction set`);
    if (
      !["Batter", "Bowler", "All-rounder", "Wicketkeeper"].includes(player.role)
    )
      errors.push(`${prefix}invalid role`);
    if (
      typeof player.overseas !== "boolean" ||
      typeof player.legend !== "boolean"
    )
      errors.push(`${prefix}invalid overseas or legend flag`);
    if (
      !["Indian", "Overseas"].includes(player.nationality) ||
      (player.nationality === "Overseas") !== player.overseas
    )
      errors.push(`${prefix}inconsistent nationality`);
    for (const field of ["ovr", "batting", "bowling", "fielding"]) {
      if (
        !Number.isInteger(player[field]) ||
        player[field] < 1 ||
        player[field] > 99
      )
        errors.push(`${prefix}invalid ${field} rating`);
    }
    if (!Number.isFinite(player.basePrice) || player.basePrice <= 0)
      errors.push(`${prefix}invalid base price`);
    if (
      !Array.isArray(player.preferredBattingPositions) ||
      player.preferredBattingPositions.some(
        (position) =>
          !Number.isInteger(position) || position < 1 || position > 11,
      )
    )
      errors.push(`${prefix}invalid batting positions`);
    if (
      player.rtmTeamId &&
      franchiseIds &&
      !franchiseIds.includes(player.rtmTeamId)
    )
      errors.push(`${prefix}unknown RTM franchise`);
    if (player.photo) {
      if (
        typeof player.photo !== "string" ||
        !/^\/player-portraits\/[a-z0-9-]+\.(jpg|png|webp|avif)$/.test(
          player.photo,
        )
      )
        errors.push(`${prefix}invalid portrait path`);
      else if (
        publicDirectory &&
        !fs.existsSync(path.join(publicDirectory, player.photo.slice(1)))
      )
        errors.push(`${prefix}portrait file is missing`);
      if (
        !player.photoAttribution ||
        typeof player.photoAttribution !== "object"
      )
        errors.push(`${prefix}portrait attribution is missing`);
    }
  }
  return errors;
}

module.exports = { validatePlayerDatabase };
