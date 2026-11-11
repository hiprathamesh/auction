import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = path.join(ROOT, "data", "players.json");
const OUTPUT_DIR = path.join(ROOT, "public", "player-portraits");
const MISSING_PATH = path.join(ROOT, "data", "player-portraits-missing.txt");
const OVERRIDES_PATH = path.join(ROOT, "data", "player-overrides.json");
const EN_API = "https://en.wikipedia.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT =
  "IPLAuctionArenaPortraitFetcher/1.0 (https://auction.nik.am.in; local hobby project) Node.js";
const BATCH_SIZE = 35;
const WAIT_MS = 180;
const SET_FILTER = (() => {
  const setIndex = process.argv.indexOf("--set");
  if (setIndex === -1) return null;
  const value = process.argv[setIndex + 1]?.trim();
  if (!value) throw new Error('Expected a set name after "--set".');
  return value;
})();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value) =>
  String(value ?? "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
const decodeBasicEntities = (value) =>
  String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

async function fetchWithRetry(url, label, options = {}) {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": USER_AGENT,
          "Api-User-Agent": USER_AGENT,
          Accept:
            options.accept ||
            "application/json,image/avif,image/webp,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      });
    } catch (error) {
      if (attempt === maxAttempts - 1)
        throw new Error(`${label}: ${error.message}`);
      await sleep(500 * (attempt + 1));
      continue;
    }

    if (response.ok) return response;
    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`${label}: HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : Math.min(1000 * (attempt + 1) ** 2, 15000);
    console.warn(`${label}: HTTP ${response.status}; retrying in ${wait}ms`);
    await sleep(wait);
  }
  throw new Error(`${label}: request failed after retries`);
}

async function fetchJson(endpoint, params, label) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, String(value));
  const response = await fetchWithRetry(url, label, {
    accept: "application/json",
  });
  const data = await response.json();
  if (data.error)
    throw new Error(
      `${label}: ${data.error.info || data.error.code || "API error"}`,
    );
  return data;
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size)
    result.push(values.slice(i, i + size));
  return result;
}

function hasCricketContext(page) {
  const intro = String(page.extract || "");
  return /cricketer|cricket player|cricket team|cricketing|batsman|batter|bowler|wicket.?keeper|all.?rounder|indian premier league|\bIPL\b|test cricketer/i.test(
    intro,
  );
}

function acceptedFreeLicense(metadata) {
  const license = decodeBasicEntities(
    metadata?.LicenseShortName?.value || metadata?.UsageTerms?.value || "",
  );
  // Only use licences that allow reuse; this deliberately excludes NC/ND and ambiguous labels.
  return /^(CC0|CC BY(?:-SA)?(?:\s|$)|Public domain|GNU Free Documentation License|GFDL|Free Art License|GPL|LGPL)/i.test(
    license,
  );
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.(jpe?g|png|webp|avif)$/);
    if (!match) return null;
    return match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
  } catch {
    return null;
  }
}

async function downloadImage(url, destination) {
  const response = await fetchWithRetry(
    url,
    `image ${path.basename(destination)}`,
  );
  const contentType = (response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/"))
    throw new Error(`Unexpected content type ${contentType || "(missing)"}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 1_500_000)
    throw new Error(`Thumbnail size out of bounds (${bytes.length} bytes)`);
  await fs.writeFile(destination, bytes);
  return bytes.length;
}

async function atomicWrite(destination, content) {
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function main() {
  const database = JSON.parse(await fs.readFile(DB_PATH, "utf8"));
  if (!Array.isArray(database.players) || !database.players.length) {
    throw new Error(
      "Expected data/players.json to contain a non-empty players array.",
    );
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const selectedPlayers = SET_FILTER
    ? database.players.filter((player) => player.set === SET_FILTER)
    : database.players;
  if (!selectedPlayers.length) {
    throw new Error(`No players found in auction set "${SET_FILTER}".`);
  }

  const playersByName = new Map(
    selectedPlayers.map((player) => [normalize(player.name), player]),
  );
  const pageCandidates = [];
  console.log(
    `Looking for free-licensed Wikipedia thumbnails for ${selectedPlayers.length} players${SET_FILTER ? ` in ${SET_FILTER}` : ""}...`,
  );

  for (const [batchIndex, batch] of chunks(
    selectedPlayers,
    BATCH_SIZE,
  ).entries()) {
    const response = await fetchJson(
      EN_API,
      {
        action: "query",
        format: "json",
        formatversion: 2,
        redirects: 1,
        prop: "pageimages|extracts",
        piprop: "thumbnail|name",
        pilicense: "free",
        pithumbsize: 256,
        exintro: 1,
        explaintext: 1,
        exchars: 1000,
        titles: batch.map((player) => player.name).join("|"),
      },
      `Wikipedia batch ${batchIndex + 1}`,
    );

    for (const page of response.query?.pages || []) {
      const key = normalize(page.title);
      const player = playersByName.get(key);
      if (
        !player ||
        !page.thumbnail?.source ||
        !page.pageimage ||
        !hasCricketContext(page)
      )
        continue;
      pageCandidates.push({
        player,
        fileName: page.pageimage,
        thumbnailUrl: page.thumbnail.source,
        pageTitle: page.title,
      });
    }
    await sleep(WAIT_MS);
  }

  // Only ask Commons for licences for unique media files, in batches and sequentially.
  const uniqueFileNames = [
    ...new Set(pageCandidates.map((candidate) => candidate.fileName)),
  ];
  const metadataByFile = new Map();
  for (const [batchIndex, batch] of chunks(
    uniqueFileNames,
    BATCH_SIZE,
  ).entries()) {
    const response = await fetchJson(
      COMMONS_API,
      {
        action: "query",
        format: "json",
        formatversion: 2,
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: 256,
        titles: batch.map((name) => `File:${name}`).join("|"),
      },
      `Commons metadata batch ${batchIndex + 1}`,
    );
    for (const page of response.query?.pages || []) {
      const name = String(page.title || "").replace(/^File:/i, "");
      const info = page.imageinfo?.[0];
      if (info) metadataByFile.set(normalize(name), info);
    }
    await sleep(WAIT_MS);
  }

  let downloaded = 0;
  let reused = 0;
  let skipped = 0;
  const matchedPlayerIds = new Set();
  const candidateByPlayer = new Map();
  for (const candidate of pageCandidates) {
    // Prefer the first page-image match for each player. Manual review can be done using the source link.
    if (!candidateByPlayer.has(candidate.player.id))
      candidateByPlayer.set(candidate.player.id, candidate);
  }

  for (const player of selectedPlayers) {
    const existingRelativePath = player.photo;
    if (
      existingRelativePath &&
      existingRelativePath.startsWith("/player-portraits/")
    ) {
      const existingPath = path.join(
        ROOT,
        "public",
        existingRelativePath.replace(/^\//, ""),
      );
      try {
        await fs.access(existingPath);
        reused += 1;
        continue;
      } catch {
        /* A missing file is refreshed below. */
      }
    }

    const candidate = candidateByPlayer.get(player.id);
    if (!candidate) {
      skipped += 1;
      continue;
    }
    const info = metadataByFile.get(normalize(candidate.fileName));
    const ext = info?.extmetadata || {};
    const license = decodeBasicEntities(
      ext.LicenseShortName?.value || ext.UsageTerms?.value || "",
    );
    const sourceUrl = info?.descriptionurl;
    const artist = decodeBasicEntities(
      ext.Artist?.value || ext.Credit?.value || "",
    );
    const imageUrl = info?.thumburl || candidate.thumbnailUrl;
    const extension = extensionFromUrl(imageUrl);

    if (!info || !sourceUrl || !acceptedFreeLicense(ext) || !extension) {
      skipped += 1;
      continue;
    }

    const localName = `${player.id}${extension}`;
    const outputPath = path.join(OUTPUT_DIR, localName);
    try {
      const bytes = await downloadImage(imageUrl, outputPath);
      player.photo = `/player-portraits/${localName}`;
      player.photoAttribution = {
        source: "Wikimedia Commons",
        sourceUrl,
        author: artist || "Author details on source page",
        license,
        licenseUrl: ext.LicenseUrl?.value || sourceUrl,
      };
      matchedPlayerIds.add(player.id);
      downloaded += 1;
      console.log(
        `✓ ${player.name} (${Math.round(bytes / 1024)} KB, ${license})`,
      );
    } catch (error) {
      skipped += 1;
      console.warn(`! Skipped ${player.name}: ${error.message}`);
    }
    await sleep(WAIT_MS);
  }

  let overrides = {};
  try {
    overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const player of database.players) {
    if (!player.photo || !player.photoAttribution) continue;
    overrides[player.id] = {
      ...(overrides[player.id] || {}),
      photo: player.photo,
      photoAttribution: player.photoAttribution,
    };
  }
  await atomicWrite(OVERRIDES_PATH, `${JSON.stringify(overrides, null, 2)}\n`);
  await atomicWrite(DB_PATH, `${JSON.stringify(database, null, 2)}\n`);
  const missing = database.players.filter(
    (player) => !player.photo || !player.photoAttribution,
  );
  await atomicWrite(
    MISSING_PATH,
    missing.map((player) => `${player.name} [${player.id}]`).join("\n") +
      (missing.length ? "\n" : ""),
  );

  console.log("\nPortrait import complete.");
  console.log(`Players scanned: ${selectedPlayers.length}`);
  console.log(`New local portraits: ${downloaded}`);
  console.log(`Existing portraits reused: ${reused}`);
  console.log(`Candidates skipped: ${skipped}`);
  console.log(
    `Players without an approved image in the complete database: ${missing.length}`,
  );
  console.log(`Image files: ${OUTPUT_DIR}`);
  console.log(`Review missing players: ${MISSING_PATH}`);
  console.log(
    "\nSome free-licensed Wikipedia images are event photographs rather than studio headshots. Review the visible image and its linked source before public sharing. Players without a suitable image keep the initials fallback.",
  );
}

main().catch((error) => {
  console.error(`Portrait import failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
