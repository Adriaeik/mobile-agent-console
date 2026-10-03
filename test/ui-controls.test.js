import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offers the Codex Shift+Left shortcut for queued questions", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-key="\\u001b\[1;2D"/);
  assert.match(html, /Answer question/);
  assert.match(html, /Shift\+←/);
});
