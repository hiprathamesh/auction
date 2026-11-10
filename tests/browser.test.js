const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { startServer } = require("./helpers/server");
const game = require("../server/game");
const database = require("../data/players.json");
const { createCheckpointStore } = require("../server/checkpoints");

test(
  "two browsers can create a room, bid, and reconnect",
  { timeout: 30000 },
  async (t) => {
    const backend = await startServer(t);
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
    t.after(() => vite.close());
    const localChrome =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync(localChrome) ? localChrome : undefined);
    const browser = await chromium.launch(
      executablePath ? { executablePath, headless: true } : { headless: true },
    );
    t.after(() => browser.close());
    const hostContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const friendContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const host = await hostContext.newPage();
    const friend = await friendContext.newPage();
    const errors = [];
    host.on("pageerror", (error) => errors.push(error.message));
    friend.on("pageerror", (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
    await host.goto(url);
    await host.getByLabel("YOUR DISPLAY NAME").fill("Audit Host");
    await host.getByRole("button", { name: "Chennai Super Kings" }).click();
    await host.getByRole("button", { name: "Create private room" }).click();
    await expect(host.getByText("Host recovery and transfer")).toBeVisible();
    const roomCode = await host.evaluate(() =>
      localStorage.getItem("iplRoomCode"),
    );
    assert.equal(roomCode.length, 5);
    await friend.goto(`${url}/?room=${roomCode}`);
    await friend.getByLabel("YOUR DISPLAY NAME").fill("Audit Friend");
    await friend.getByRole("button", { name: "Join auction room" }).click();
    await expect(host.getByText("Audit Friend", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "I'm ready" }).click();
    await friend.getByRole("button", { name: "I'm ready" }).click();
    await host.getByRole("button", { name: "Start auction" }).click();
    await expect(host.locator(".auction-player-name")).toBeVisible();
    await expect(friend.locator(".auction-player-name")).toHaveText(
      await host.locator(".auction-player-name").textContent(),
    );
    await host.locator(".bid-button").click();
    await expect(host.locator(".bid-button")).toContainText("HIGHEST BIDDER");
    if (process.env.AUCTION_TEST_SCREENSHOTS) {
      fs.mkdirSync(process.env.AUCTION_TEST_SCREENSHOTS, { recursive: true });
      await host.screenshot({
        path: path.join(
          process.env.AUCTION_TEST_SCREENSHOTS,
          "auction-desktop.png",
        ),
        fullPage: true,
      });
      await friend.screenshot({
        path: path.join(
          process.env.AUCTION_TEST_SCREENSHOTS,
          "auction-mobile.png",
        ),
        fullPage: true,
      });
    }
    await host.reload();
    await expect(host.locator(".auction-player-name")).toBeVisible();
    await expect(host.locator(".bid-button")).toContainText("HIGHEST BIDDER");
    await expect(friend.locator(".connection")).toBeVisible();
    await friend.setViewportSize({ width: 320, height: 740 });
    const headerFits = await friend.evaluate(() => {
      const brand = document.querySelector(".brand").getBoundingClientRect();
      const controls = document
        .querySelector(".topbar-right")
        .getBoundingClientRect();
      return (
        brand.right <= controls.left && controls.right <= window.innerWidth
      );
    });
    assert.equal(
      headerFits,
      true,
      "mobile header controls should not overlap or be clipped",
    );
    assert.deepEqual(errors, []);
    await hostContext.close();
    await friendContext.close();
    await browser.close();
    await vite.close();
  },
);

test(
  "statistics dialog supports keyboard dismissal and focus restoration",
  { timeout: 30000 },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "auction-dialog-test-"),
    );
    t.after(() => {
      assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const token = "A".repeat(43);
    const team = game.FRANCHISES[0];
    const host = {
      id: "dialog-host",
      name: "Host",
      teamId: team.id,
      teamName: team.name,
      teamShort: team.short,
      teamColor: team.color,
      credentialHash: crypto.createHash("sha256").update(token).digest("hex"),
    };
    const room = game.createRoom("ABCDE", host, database);
    room.phase = "leagueComplete";
    createCheckpointStore({ enabled: true, directory }).save(room);
    const backend = await startServer(t, {
      ROOM_CHECKPOINTS: "1",
      ROOM_DATA_DIR: directory,
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
    t.after(() => vite.close());
    const localChrome =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync(localChrome) ? localChrome : undefined);
    const browser = await chromium.launch(
      executablePath ? { executablePath, headless: true } : { headless: true },
    );
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.addInitScript(
      ({ code, userId, reconnectToken }) => {
        localStorage.setItem("iplRoomCode", code);
        localStorage.setItem("iplUserId", userId);
        localStorage.setItem("iplReconnectToken", reconnectToken);
      },
      { code: room.code, userId: host.id, reconnectToken: token },
    );
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
    const open = page.getByRole("button", { name: /more stats/i });
    await open.click();
    await expect(
      page.getByRole("dialog", { name: /leaderboards/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(open).toBeFocused();
    await page.close();
    await browser.close();
    await vite.close();
  },
);
