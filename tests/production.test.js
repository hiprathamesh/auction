const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer } = require("./helpers/server");

test(
  "a production build is served with fresh HTML and cacheable hashed assets",
  { timeout: 30000 },
  async (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "auction-production-test-"),
    );
    t.after(() => {
      assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const { build } = await import("vite");
    await build({
      build: { outDir: directory, emptyOutDir: false },
      logLevel: "silent",
    });
    const server = await startServer(t, { DIST_DIR: directory });
    const index = await fetch(server.url);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("cache-control"), /no-cache/);
    const html = await index.text();
    const script = html.match(/src="([^"]+\.js)"/);
    assert.ok(script);
    const asset = await fetch(new URL(script[1], server.url));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control"), /immutable/);
    assert.equal((await fetch(`${server.url}/api/health`)).status, 200);
  },
);
