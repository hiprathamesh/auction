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
    await expect(
      host.getByRole("button", { name: "Only allow identified users" }),
    ).toHaveCount(0);
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
    const base = Number(
      (await host.locator(".base-price-line strong").textContent()).replace(
        /[^\d.]/g,
        "",
      ),
    );
    const openingAmount = (multiplier) => {
      let amount = base;
      for (let step = 1; step < multiplier; step += 1) {
        const increment =
          amount < 1
            ? 0.05
            : amount < 2
              ? 0.1
              : amount < 5
                ? 0.2
                : amount < 10
                  ? 0.25
                  : 0.5;
        amount = Number((amount + increment).toFixed(2));
      }
      return amount;
    };
    for (const multiplier of [2, 5, 10]) {
      const amount = openingAmount(multiplier).toFixed(2).replace(/\.00$/, "");
      await expect(
        host
          .locator(".bid-multiplier-button")
          .filter({ hasText: `×${multiplier}` }),
      ).toHaveAttribute(
        "aria-label",
        `Opening bid: ₹${amount} Cr (base plus ${multiplier - 1} increments)`,
      );
    }
    await expect(host.locator(".timer-orb strong")).toHaveText(/^[1-6]$/, {
      timeout: 7000,
    });
    await host
      .locator(".bid-multiplier-button")
      .filter({ hasText: "×10" })
      .click();
    await expect(host.locator(".bid-button")).toContainText("HIGHEST BIDDER");
    await expect(
      friend.locator(".bid-price-line > div:first-child strong"),
    ).toHaveText(`₹${openingAmount(10).toFixed(2).replace(/\.00$/, "")} Cr`);
    const accepted = Number(
      (
        await friend
          .locator(".bid-price-line > div:first-child strong")
          .textContent()
      ).replace(/[^\d.]/g, ""),
    );
    assert.equal(accepted, openingAmount(10));
    await expect(host.locator(".timer-orb strong")).toHaveText(/^(9|10)$/);
    await expect(friend.locator(".timer-orb strong")).toHaveText(/^(9|10)$/);
    await expect(friend.locator(".timer-orb strong")).toHaveText(/^[1-6]$/, {
      timeout: 7000,
    });
    await friend.locator(".bid-button").click();
    await expect(friend.locator(".bid-button")).toContainText("HIGHEST BIDDER");
    await expect(host.locator(".timer-orb strong")).toHaveText(/^(9|10)$/);
    await expect(friend.locator(".timer-orb strong")).toHaveText(/^(9|10)$/);
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
    await expect(friend.locator(".bid-button")).toContainText("HIGHEST BIDDER");
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
    await host.getByRole("button", { name: /pause/i }).click();
    await expect(host.getByRole("button", { name: /resume/i })).toBeVisible();
    const seatId = await friend.evaluate(() =>
      localStorage.getItem("iplUserId"),
    );
    const name = await friend.locator(".auction-player-name").textContent();
    const profile = await friend
      .locator(".auction-profile-link")
      .getAttribute("href");
    assert.match(profile, /^\/p\/[a-z0-9-]+$/);
    for (const selector of [
      ".player-avatar-large",
      ".auction-player-name a",
      ".auction-profile-link",
    ]) {
      const link = friend.locator(selector);
      await expect(link).toHaveAttribute("href", profile);
      await link.click();
      await expect(friend).toHaveURL(url + profile);
      await expect(
        friend.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await friend.getByRole("link", { name: "PLAY", exact: true }).click();
      await expect(friend.locator(".auction-player-name")).toHaveText(name);
      assert.equal(
        await friend.evaluate(() => localStorage.getItem("iplUserId")),
        seatId,
      );
    }
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
