import test from "node:test";
import assert from "node:assert/strict";
import { loadPins, organizeSessions, savePins, togglePin } from "../public/sessions.js";

const sessions = [
  { name: "api", cwd: "/work/services/api", command: "codex", provider: "codex", lastActivity: 200 },
  { name: "docs", cwd: "/work/docs", command: "claude", provider: "claude", lastActivity: 300 },
  { name: "shell", cwd: "/work/apps/web", command: "bash", provider: "shell", lastActivity: 100 },
];

test("search covers name, path, and command and provider filters are exact", () => {
  assert.deepEqual(organizeSessions(sessions, { query: "services" }).map(({ name }) => name), ["api"]);
  assert.deepEqual(organizeSessions(sessions, { query: "bash" }).map(({ name }) => name), ["shell"]);
  assert.deepEqual(organizeSessions(sessions, { query: "DOC" }).map(({ name }) => name), ["docs"]);
  assert.deepEqual(organizeSessions(sessions, { provider: "claude" }).map(({ name }) => name), ["docs"]);
});

test("pinned sessions sort first and each group is recent-first", () => {
  assert.deepEqual(organizeSessions(sessions, { pins: new Set(["shell"]) }).map(({ name }) => name), ["shell", "docs", "api"]);
  assert.deepEqual([...togglePin(new Set(["shell"]), "api")].sort(), ["api", "shell"]);
  assert.deepEqual([...togglePin(new Set(["shell"]), "shell")], []);
});

test("pin storage contains names only and fails closed", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  savePins(storage, new Set(["docs", "api"]));
  assert.deepEqual([...loadPins(storage)].sort(), ["api", "docs"]);
  values.set("mobile-agent-console:pins", "not-json");
  assert.deepEqual([...loadPins(storage)], []);
});
