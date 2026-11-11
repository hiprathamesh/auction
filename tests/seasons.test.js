const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const game = require("../server/game");
const database = require("../data/players.json");
const { createSeasonStore, makeSeasonSnapshot } = require("../server/seasons");
const { createCheckpointStore } = require("../server/checkpoints");
const { startServer, nextEvent } = require("./helpers/server");

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-seasons-"));
  t.after(() => {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function sampleRoom() {
  const token = "A".repeat(43);
  const teams = game.FRANCHISES.slice(0, 2).map((team, i) => ({
    id: `user${i}`,
    name: i ? "Friend" : "Host",
    teamId: team.id,
    teamName: team.name,
    teamShort: team.short,
    teamColor: team.color,
    identityId: i ? "friend44" : "host44",
    credentialHash: crypto
      .createHash("sha256")
      .update(i ? "B".repeat(43) : token)
      .digest("hex"),
  }));
  const room = game.createRoom("ABCDE", teams[0], database);
  game.addUser(room, teams[1]);
  let pool = [...database.players];
  for (const user of room.users) {
    user.squad = game.findBestLegalXI(pool);
    pool = pool.filter(
      (player) => !user.squad.some((chosen) => chosen.id === player.id),
    );
    user.lineup = user.squad.map((player) => player.id);
    user.bowlerIds = user.lineup.slice(0, 5);
  }
  const fixture = {
    id: "league-1",
    type: "league",
    round: "League 1",
    homeId: teams[0].id,
    awayId: teams[1].id,
  };
  room.fixtures = [fixture];
  const [home, away] = room.users.map((user) => ({ ...user, userId: user.id }));
  const { result } = game.createLiveEvents(home, away, 1234);
  game.updateStandingsAndStats(room, { ...fixture, ...result });
  room.standings = game.calculateStandings(room);
  room.phase = "complete";
  room.championId = result.winnerId;
  room.completedAt = Date.now();
  return { room, token };
}

async function identify(url, id, pin = "1234") {
  const response = await fetch(`${url}/api/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, pin }),
  });
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

test("season snapshots persist scorecards and indexed profiles without private room credentials", (t) => {
  const file = path.join(temporary(t), "seasons.sqlite");
  const { room } = sampleRoom();
  const snapshot = makeSeasonSnapshot(room);
  assert.equal(snapshot.matches.length, 1);
  assert.equal(snapshot.teams[0].identityId, "host44");
  room.recordingOwnerIdentityId = "host44";
  room.hostId = "user1";
  assert.equal(makeSeasonSnapshot(room).ownerIdentityId, "host44");
  assert.ok(snapshot.playerStats.length);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /credentialHash|hostRecoveryHash|socketId/,
  );
  const store = createSeasonStore(file);
  assert.deepEqual(store.save(room.seasonKey, snapshot), {
    id: 1,
    created: true,
  });
  assert.deepEqual(store.save(room.seasonKey, snapshot), {
    id: 1,
    created: false,
  });
  assert.equal(store.listForUser("host44").length, 1);
  assert.equal(store.listForUser("stranger").length, 0);
  assert.deepEqual(
    store.coPlayers("host44").map((row) => row.id),
    ["friend44"],
  );
  const playerId = snapshot.teams[0].squad[0].id;
  assert.equal(store.playerSeasons(playerId).length, 1);
  assert.equal(store.playerSeasons(playerId)[0].matches, 1);
  assert.equal(store.ownerOf(1), "host44");
  assert.equal(store.remove(1), true);
  assert.equal(store.listForUser("host44").length, 0);
  assert.equal(store.playerSeasons(playerId).length, 0);
  store.close();
});

test(
  "identity sessions protect personal season lists and host-owned deletion",
  { timeout: 20000 },
  async (t) => {
    const file = path.join(temporary(t), "seasons.sqlite");
    const { room } = sampleRoom();
    const store = createSeasonStore(file);
    store.save(room.seasonKey, makeSeasonSnapshot(room));
    store.close();
    const server = await startServer(t, { SEASONS_DB_PATH: file });
    try {
      const host = await identify(server.url, "host44");
      const friend = await identify(server.url, "friend44");
      const stranger = await identify(server.url, "newuser7");
      assert.equal(host.response.status, 200);
      assert.equal((await fetch(`${server.url}/api/seasons`)).status, 401);
      assert.equal((await fetch(`${server.url}/api/seasons/1`)).status, 401);
      const hostList = await (
        await fetch(`${server.url}/api/seasons`, {
          headers: { Cookie: host.cookie },
        })
      ).json();
      assert.equal(hostList.seasons.length, 1);
      assert.equal(hostList.seasons[0].yourTeam, room.users[0].teamName);
      assert.equal(
        (
          await (
            await fetch(`${server.url}/api/seasons`, {
              headers: { Cookie: stranger.cookie },
            })
          ).json()
        ).seasons.length,
        0,
      );
      assert.equal(
        (
          await (
            await fetch(`${server.url}/api/seasons`, {
              headers: { Cookie: friend.cookie },
            })
          ).json()
        ).seasons.length,
        1,
      );
      const profile = await (
        await fetch(`${server.url}/api/users/host44`, {
          headers: { Cookie: friend.cookie },
        })
      ).json();
      assert.equal(profile.totals.seasons, 1);
      assert.ok(profile.seasons[0].squad.length >= 11);
      const player = room.users[0].squad[0];
      const playerProfile = await (
        await fetch(`${server.url}/api/players/${player.id}`, {
          headers: { Cookie: host.cookie },
        })
      ).json();
      assert.equal(playerProfile.seasons.length, 1);
      assert.equal(playerProfile.seasons[0].squadOwnerId, "host44");
      assert.equal(
        (
          await fetch(`${server.url}/api/seasons/1`, {
            method: "DELETE",
            headers: { Cookie: friend.cookie },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(`${server.url}/api/seasons/1`, {
            method: "DELETE",
            headers: { Cookie: host.cookie },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${server.url}/api/seasons/1`, {
            headers: { Cookie: host.cookie },
          })
        ).status,
        404,
      );
      const logout = await fetch(`${server.url}/api/identity`, {
        method: "DELETE",
        headers: { Cookie: host.cookie },
      });
      assert.equal(logout.status, 200);
      assert.equal(
        (
          await fetch(`${server.url}/api/seasons`, {
            headers: { Cookie: host.cookie },
          })
        ).status,
        401,
      );
    } finally {
      server.child.kill();
      await new Promise((resolve) => server.child.once("exit", resolve));
    }
  },
);

test(
  "a completed room with recording enabled archives automatically after restart",
  { timeout: 15000 },
  async (t) => {
    const directory = temporary(t);
    const { room, token } = sampleRoom();
    room.settings.recordSeason = true;
    const roomDir = path.join(directory, "rooms");
    createCheckpointStore({ enabled: true, directory: roomDir }).save(room);
    const server = await startServer(t, {
      ROOM_CHECKPOINTS: "1",
      ROOM_DATA_DIR: roomDir,
      SEASONS_DB_PATH: path.join(directory, "seasons.sqlite"),
    });
    try {
      const host = await identify(server.url, "host44");
      const socket = await server.connect(host.cookie);
      const joined = nextEvent(socket, "room:joined");
      socket.emit("room:rejoin", {
        code: room.code,
        userId: room.hostId,
        reconnectToken: token,
      });
      await joined;
      const listed = await (
        await fetch(`${server.url}/api/seasons`, {
          headers: { Cookie: host.cookie },
        })
      ).json();
      assert.equal(listed.seasons.length, 1);
      assert.equal(socket.testRoom.archivedSeasonId, 1);
      socket.disconnect();
    } finally {
      server.child.kill();
      await new Promise((resolve) => server.child.once("exit", resolve));
    }
  },
);

test(
  "Hub, profiles, and season scorecards fit a mobile browser and link together",
  { timeout: 30000 },
  async (t) => {
    const directory = temporary(t);
    const { room } = sampleRoom();
    const file = path.join(directory, "seasons.sqlite");
    const store = createSeasonStore(file);
    store.save(room.seasonKey, makeSeasonSnapshot(room));
    store.close();
    const backend = await startServer(t, { SEASONS_DB_PATH: file });
    const { createServer } = await import("vite");
    const react = (await import("@vitejs/plugin-react")).default;
    const vite = await createServer({
      configFile: false,
      plugins: [react()],
      server: {
        host: "127.0.0.1",
        port: 0,
        proxy: {
          "/socket.io": { target: backend.url, ws: true },
          "/api": { target: backend.url },
        },
      },
      logLevel: "error",
    });
    await vite.listen();
    const { chromium, expect } = require("@playwright/test");
    const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const browser = await chromium.launch(
      fs.existsSync(chrome)
        ? { executablePath: chrome, headless: true }
        : { headless: true },
    );
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
    try {
      await context.request.post(`${url}/api/identity`, {
        data: { id: "host44", pin: "1234" },
      });
      await page.goto(`${url}/s`);
      await expect(
        page.getByRole("heading", { name: /welcome back/i }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Your manager profile ↗" }).click();
      await expect(
        page.getByRole("heading", { name: room.users[0].name, exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Squads" }).click();
      await page
        .getByRole("region", { name: "Squad and playing XI" })
        .getByRole("link")
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: /career scoreboard/i }),
      ).toBeVisible();
      const batting = page.getByRole("tab", { name: "Batting" });
      await batting.click();
      await expect(
        page.getByRole("region", { name: "Batting by season" }),
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          "document.documentElement.scrollWidth <= window.innerWidth",
        ),
        true,
      );
      await batting.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Bowling" })).toBeFocused();
      await page
        .getByRole("region", { name: "Bowling by season" })
        .getByRole("link", { name: "S01" })
        .click();
      await expect(
        page.getByRole("heading", { name: /take the crown/i }),
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          "document.documentElement.scrollWidth <= window.innerWidth",
        ),
        true,
      );
      await page.getByRole("tab", { name: "Fixtures" }).click();
      await page.getByRole("button", { name: /full scorecard/i }).click();
      assert.equal(
        await page.evaluate(
          "document.documentElement.scrollWidth <= window.innerWidth",
        ),
        true,
      );
      const fresh = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      await fresh.goto(`${url}/?identity=1`);
      await fresh.getByLabel("YOUR ID").fill("newmanager");
      await fresh.getByLabel("FOUR-DIGIT PIN").fill("2345");
      await fresh.getByRole("button", { name: /identify me/i }).click();
      await expect(
        fresh.getByRole("link", { name: /your hub/i }),
      ).toBeVisible();
      await fresh
        .getByRole("button", { name: "Create room", exact: true })
        .click();
      await expect(fresh.getByText("Creating as newmanager")).toBeVisible();
      await expect(
        fresh.getByRole("link", { name: "newmanager" }),
      ).toHaveAttribute("href", "/u/newmanager");
      await fresh.setViewportSize({ width: 320, height: 740 });
      assert.equal(
        await fresh
          .locator(".mode-tabs")
          .evaluate(
            (tabs) =>
              tabs.scrollHeight <= tabs.clientHeight &&
              tabs.scrollWidth <= tabs.clientWidth,
          ),
        true,
      );
      await fresh.getByLabel("YOUR DISPLAY NAME").fill("New Manager");
      await fresh.getByRole("button", { name: /create private room/i }).click();
      await expect(
        fresh.getByRole("button", { name: "Toggle season recording" }),
      ).toBeVisible();
      await fresh
        .getByRole("button", { name: "Toggle season recording" })
        .click();
      await expect(
        fresh.getByRole("button", { name: "Toggle season recording" }),
      ).toHaveAttribute("aria-pressed", "true");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
      backend.child.kill();
      await new Promise((resolve) => backend.child.once("exit", resolve));
    }
  },
);
