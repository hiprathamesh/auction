const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const game = require("../server/game");
const database = require("../data/players.json");
const { createSeasonStore, makeSeasonSnapshot } = require("../server/seasons");
const { createCheckpointStore } = require("../server/checkpoints");
const { startServer, nextEvent } = require("./helpers/server");

function sampleRoom() {
  const token = "A".repeat(43);
  const teams = game.FRANCHISES.slice(0, 2).map((team, i) => ({
    id: `user${i}`,
    name: i ? "Friend" : "Host",
    teamId: team.id,
    teamName: team.name,
    teamShort: team.short,
    teamColor: team.color,
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
    pool = pool.filter((p) => !user.squad.some((chosen) => chosen.id === p.id));
    user.lineup = user.squad.map((p) => p.id);
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
  room.phase = "complete";
  room.championId = result.winnerId;
  room.completedAt = Date.now();
  return { room, token };
}

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auction-seasons-"));
  t.after(() => {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("season snapshots persist complete scorecards without private credentials and saves are idempotent", (t) => {
  const directory = temporary(t),
    file = path.join(directory, "archive.sqlite");
  const { room } = sampleRoom();
  const snapshot = makeSeasonSnapshot(room);
  assert.equal(snapshot.matches.length, 1);
  assert.equal(snapshot.teams[0].lineup.length, 11);
  assert.ok(snapshot.matches[0].innings[0].batters.length);
  assert.ok(snapshot.playerStats.length);
  assert.ok(
    JSON.parse(
      zlib
        .inflateSync(
          Buffer.from(snapshot.matches[0].ballByBall.innings[0], "base64"),
        )
        .toString(),
    ).length,
  );
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
  assert.deepEqual(store.save("another-season", snapshot), {
    id: 2,
    created: true,
  });
  store.close();
  const reopened = createSeasonStore(file);
  assert.equal(reopened.get(1).champion.teamName, snapshot.champion.teamName);
  assert.deepEqual(
    reopened.list().map((row) => row.id),
    [2, 1],
  );
  assert.deepEqual(
    reopened.list(2).map((row) => row.id),
    [1],
  );
  reopened.close();
  room.phase = "league";
  assert.throws(() => makeSeasonSnapshot(room), /completed season/);
});

test(
  "only the host can record a completed season, which remains publicly accessible after restart",
  { timeout: 30000 },
  async (t) => {
    const directory = temporary(t),
      roomDir = path.join(directory, "rooms"),
      file = path.join(directory, "archive.sqlite");
    const { room, token } = sampleRoom();
    createCheckpointStore({ enabled: true, directory: roomDir }).save(room);
    const env = {
      ROOM_CHECKPOINTS: "1",
      ROOM_DATA_DIR: roomDir,
      SEASONS_DB_PATH: file,
      ARCHIVE_OWNER_KEY: "",
    };
    const server = await startServer(t, env);
    const ownerKey = fs
      .readFileSync(path.join(directory, "archive-owner-key"), "utf8")
      .trim();
    assert.deepEqual(
      (await (await fetch(`${server.url}/api/seasons`)).json()).seasons,
      [],
    );
    const friend = await server.connect();
    let joined = nextEvent(friend, "room:joined");
    friend.emit("room:rejoin", {
      code: room.code,
      userId: "user1",
      reconnectToken: "B".repeat(43),
    });
    await joined;
    const denied = await friend.timeout(3000).emitWithAck("host:recordSeason");
    assert.equal(denied.ok, false);
    const host = await server.connect();
    joined = nextEvent(host, "room:joined");
    host.emit("room:rejoin", {
      code: room.code,
      userId: "user0",
      reconnectToken: token,
    });
    await joined;
    const saved = await host.timeout(3000).emitWithAck("host:recordSeason");
    assert.deepEqual(saved, { ok: true, id: 1, path: "/s1", created: true });
    const repeated = await host.timeout(3000).emitWithAck("host:recordSeason");
    assert.equal(repeated.id, 1);
    assert.equal(repeated.created, false);
    const record = await (await fetch(`${server.url}/api/seasons/1`)).json();
    assert.equal(record.matches[0].hasBallByBall, true);
    assert.equal(record.matches[0].ballByBall, undefined);
    assert.doesNotMatch(
      JSON.stringify(record),
      /credentialHash|hostRecoveryHash|socketId/,
    );
    const balls = await (
      await fetch(`${server.url}/api/seasons/1/matches/league-1/balls`)
    ).json();
    assert.ok(balls.innings[0].length > 0);
    assert.equal((await fetch(`${server.url}/api/seasons/999`)).status, 404);
    server.child.kill();
    await new Promise((resolve) => server.child.once("exit", resolve));
    const restarted = await startServer(t, env);
    assert.equal(
      fs.readFileSync(path.join(directory, "archive-owner-key"), "utf8").trim(),
      ownerKey,
    );
    assert.equal(
      (await (await fetch(`${restarted.url}/api/seasons/1`)).json()).champion
        .teamName,
      record.champion.teamName,
    );
    assert.equal(
      (await fetch(`${restarted.url}/api/seasons/1`, { method: "DELETE" }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(`${restarted.url}/api/seasons/1`, {
          method: "DELETE",
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      401,
    );
    assert.equal((await fetch(`${restarted.url}/api/seasons/1`)).status, 200);
    assert.equal(
      (
        await fetch(`${restarted.url}/api/seasons/1`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${ownerKey}`,
          },
        })
      ).status,
      200,
    );
    assert.equal((await fetch(`${restarted.url}/api/seasons/1`)).status, 404);
    host.disconnect();
    friend.disconnect();
    restarted.child.kill();
    await new Promise((resolve) => restarted.child.once("exit", resolve));
    const afterDelete = await startServer(t, env);
    assert.equal((await fetch(`${afterDelete.url}/api/seasons/1`)).status, 404);
    afterDelete.child.kill();
    await new Promise((resolve) => afterDelete.child.once("exit", resolve));
  },
);

module.exports = { sampleRoom };

test(
  "host records a season and desktop and mobile visitors can browse it",
  { timeout: 30000 },
  async (t) => {
    const directory = temporary(t),
      roomDir = path.join(directory, "rooms");
    const { room, token } = sampleRoom();
    createCheckpointStore({ enabled: true, directory: roomDir }).save(room);
    const backend = await startServer(t, {
      ROOM_CHECKPOINTS: "1",
      ROOM_DATA_DIR: roomDir,
      SEASONS_DB_PATH: path.join(directory, "archive.sqlite"),
      ARCHIVE_OWNER_KEY: "",
    });
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
    const localChrome =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync(localChrome) ? localChrome : undefined);
    const browser = await chromium.launch(
      executablePath ? { executablePath, headless: true } : { headless: true },
    );
    const host = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    host.on("pageerror", (error) => errors.push(error.message));
    mobile.on("pageerror", (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const fitsMobile = async () =>
      assert.equal(
        await mobile.evaluate(
          "document.documentElement.scrollWidth <= window.innerWidth",
        ),
        true,
        "the page should not overflow the mobile viewport",
      );
    try {
      await mobile.goto(`${url}/seasons`);
      await expect(mobile.getByText("The story starts here.")).toBeVisible();
      await host.addInitScript(
        ({ code, token }) => {
          localStorage.setItem("iplRoomCode", code);
          localStorage.setItem("iplUserId", "user0");
          localStorage.setItem("iplReconnectToken", token);
        },
        { code: room.code, token },
      );
      await host.goto(url);
      await host.getByRole("button", { name: /record this season/i }).click();
      await expect(
        host.getByRole("link", { name: /view season 1/i }),
      ).toBeVisible();
      await mobile.reload();
      await mobile.getByRole("link", { name: /champions/i }).click();
      await expect(
        mobile.getByRole("heading", { name: /take the crown/i }),
      ).toBeVisible();
      await fitsMobile();
      await mobile.getByRole("tab", { name: "Squads" }).click();
      await expect(mobile.getByText("STARTING XI")).toBeVisible();
      await fitsMobile();
      await mobile.getByRole("tab", { name: "Fixtures" }).click();
      await mobile.getByRole("button", { name: /full scorecard/i }).click();
      await mobile.getByRole("button", { name: /ball-by-ball/i }).click();
      await expect(
        mobile.locator(".archive-deliveries p").first(),
      ).toBeVisible();
      await fitsMobile();
      await mobile.getByRole("tab", { name: "Stats" }).click();
      await expect(
        mobile.getByRole("heading", { name: /player statistics/i }),
      ).toBeVisible();
      await fitsMobile();
      await mobile.getByRole("tab", { name: "Auction" }).click();
      await expect(
        mobile.getByRole("heading", { name: /auction room/i }),
      ).toBeVisible();
      await fitsMobile();
      await mobile.reload();
      await expect(
        mobile.getByRole("heading", { name: /take the crown/i }),
      ).toBeVisible();
      await host.goto(`${url}/s1`);
      await expect(
        host.getByRole("heading", { name: /final standings/i }),
      ).toBeVisible();
      if (process.env.AUCTION_TEST_SCREENSHOTS) {
        await host.screenshot({
          path: path.join(
            process.env.AUCTION_TEST_SCREENSHOTS,
            "season-desktop.png",
          ),
          fullPage: true,
        });
        await mobile.screenshot({
          path: path.join(
            process.env.AUCTION_TEST_SCREENSHOTS,
            "season-mobile.png",
          ),
          fullPage: true,
        });
      }
      const ownerKey = fs
        .readFileSync(path.join(directory, "archive-owner-key"), "utf8")
        .trim();
      assert.equal(ownerKey.length, 43);
      await host.goto(url);
      await expect(
        host.getByRole("link", { name: /view season 1/i }),
      ).toBeVisible();
      await mobile
        .getByRole("button", { name: /owner: delete this season/i })
        .click();
      await mobile.getByLabel("Server owner key").fill("wrong key");
      await mobile.getByLabel(/I understand that season 1/).check();
      await mobile
        .getByRole("button", { name: /permanently delete season/i })
        .click();
      await expect(mobile.getByRole("alert")).toHaveText(
        "Incorrect owner key.",
      );
      await expect(
        host.getByRole("link", { name: /view season 1/i }),
      ).toBeVisible();
      await mobile.getByLabel("Server owner key").fill(ownerKey);
      await mobile
        .getByRole("button", { name: /permanently delete season/i })
        .click();
      await expect(mobile.getByText("The story starts here.")).toBeVisible();
      await expect(
        host.getByRole("button", { name: /record this season/i }),
      ).toBeVisible();
      await host.getByRole("button", { name: /record this season/i }).click();
      await expect(
        host.getByRole("link", { name: /view season 2/i }),
      ).toBeVisible();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
      backend.child.kill();
      await new Promise((resolve) => backend.child.once("exit", resolve));
    }
  },
);

test(
  "owner key attempts are rate-limited without deleting the season",
  { timeout: 15000 },
  async (t) => {
    const directory = temporary(t);
    const file = path.join(directory, "archive.sqlite");
    const { room } = sampleRoom();
    const store = createSeasonStore(file);
    store.save(room.seasonKey, makeSeasonSnapshot(room));
    store.close();
    const server = await startServer(t, { SEASONS_DB_PATH: file });
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        assert.equal(
          (
            await fetch(`${server.url}/api/seasons/1`, {
              method: "DELETE",
              headers: { Authorization: "Bearer incorrect" },
            })
          ).status,
          401,
        );
      }
      assert.equal(
        (
          await fetch(`${server.url}/api/seasons/1`, {
            method: "DELETE",
            headers: {
              Authorization: "Bearer test-only-owner-key-0123456789abcdef",
            },
          })
        ).status,
        429,
      );
      assert.equal((await fetch(`${server.url}/api/seasons/1`)).status, 200);
    } finally {
      server.child.kill();
      await new Promise((resolve) => server.child.once("exit", resolve));
    }
  },
);
