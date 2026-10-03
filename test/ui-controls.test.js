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

test("keeps a terminal and chat view toggle in the session header", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /class="terminal-header"[\s\S]*id="view-toggle"/);
  assert.match(html, /id="view-toggle"[^>]+aria-controls="terminal conversation"/);
  assert.match(html, />Chat<\/button>/);
});

test("offers an accessible message composer for the active agent", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="composer"[^>]+aria-label="Send message to agent"/);
  assert.match(html, /id="message"[^>]+placeholder="Message the agent…"/);
});

test("offers a reload banner for a changed server deployment", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="update-banner"[^>]+role="status"/);
  assert.match(html, /id="reload-app"/);
});

test("offers an explicit notification opt-in in session controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="notification-toggle"/);
  assert.match(html, /Notifications/);
});

test("conversation view offers compact search and jump controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="conversation-search"[^>]+type="search"/);
  assert.match(html, /id="conversation-search-count"[^>]+aria-live="polite"/);
  assert.match(html, /id="conversation-latest"/);
});

test("dashboard offers session search, provider filter, and pin controls", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="session-search"[^>]+type="search"/);
  assert.match(html, /id="session-provider"/);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /pin-session/);
});
