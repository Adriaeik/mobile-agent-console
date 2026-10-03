import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("provides an installable standalone web app manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/app.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Mobile Agent Console");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(manifest.icons.map(({ sizes, type }) => ({ sizes, type })), [
    { sizes: "192x192", type: "image/png" },
    { sizes: "512x512", type: "image/png" },
  ]);
  assert.ok(manifest.icons.every((icon) => icon.purpose.includes("maskable")));
});

test("ships both required raster icon sizes", async () => {
  assert.ok((await stat(new URL("../public/icons/icon-192.png", import.meta.url))).size > 1000);
  assert.ok((await stat(new URL("../public/icons/icon-512.png", import.meta.url))).size > 1000);
});

test("service worker intentionally caches no authenticated content", async () => {
  const worker = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /addEventListener\s*\(\s*["']fetch["']/);
  assert.doesNotMatch(worker, /\bcaches\b|CacheStorage/);
});

test("links the authenticated manifest from the app shell", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /rel="manifest"[^>]+href="\/app\.webmanifest"[^>]+crossorigin="use-credentials"/);
  assert.match(html, /rel="apple-touch-icon"/);
});
