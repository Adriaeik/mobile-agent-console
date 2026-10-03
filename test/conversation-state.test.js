import test from "node:test";
import assert from "node:assert/strict";
import { addPendingMessage, mergePendingMessages, searchMessages } from "../public/conversation-state.js";

test("a sent message appears immediately as pending", () => {
  const pending = addPendingMessage([], "Deploy now", 1000, "local-1");
  assert.deepEqual(pending, [{ id: "local-1", role: "user", text: "Deploy now", timestamp: 1000, pending: true }]);
  const merged = mergePendingMessages([{ id: "server-0", role: "assistant", text: "Ready" }], pending);
  assert.equal(merged.at(-1).pending, true);
});

test("matching transcript turns reconcile pending text without duplication", () => {
  const pending = [
    { id: "local-1", role: "user", text: "Deploy now", timestamp: 1000, pending: true },
    { id: "local-2", role: "user", text: "Then verify", timestamp: 2000, pending: true },
  ];
  const messages = [
    { id: "server-0", role: "user", text: "Deploy now", timestamp: 1500 },
    { id: "server-1", role: "assistant", text: "Working", timestamp: 1600 },
  ];
  const { messages: merged, pending: remaining } = mergePendingMessages(messages, pending, { reconcile: true });
  assert.equal(merged.filter(({ text }) => text === "Deploy now").length, 1);
  assert.deepEqual(remaining.map(({ text }) => text), ["Then verify"]);
});

test("conversation search is case-insensitive and includes roles", () => {
  const messages = [
    { role: "user", text: "Deploy production" },
    { role: "assistant", text: "Tests passed" },
  ];
  assert.deepEqual(searchMessages(messages, "PASS"), [1]);
  assert.deepEqual(searchMessages(messages, "user"), [0]);
  assert.deepEqual(searchMessages(messages, ""), []);
});
