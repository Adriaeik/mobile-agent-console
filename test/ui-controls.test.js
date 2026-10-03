import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offers the Codex Shift+Left shortcut for queued questions", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-key="\\u001b\[1;2D"/);
  assert.match(html, /Answer question/);
  assert.match(html, /Shift\+←/);
});

test("offers an optional conversation view without replacing the terminal", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="conversation"/);
  assert.match(html, /id="conversation-toggle"/);
  assert.match(html, /Conversation view/);
  assert.match(html, /id="terminal"/);
});
