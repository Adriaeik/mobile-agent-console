import test from "node:test";
import assert from "node:assert/strict";
import { deriveAgentStatus } from "../public/agent-status.js";

test("derives working and waiting states from the last visible turn", () => {
  assert.equal(deriveAgentStatus({ available: true, messages: [{ role: "user", text: "Fix it" }] }).id, "working");
  assert.equal(deriveAgentStatus({ available: true, messages: [{ role: "assistant", text: "Done" }] }).id, "waiting");
});

test("connection and exit states take precedence", () => {
  const payload = { available: true, messages: [{ role: "assistant", text: "Done" }] };
  assert.equal(deriveAgentStatus(payload, { connected: false }).id, "disconnected");
  assert.equal(deriveAgentStatus(payload, { exited: true }).id, "exited");
});

test("unknown transcripts stay generic", () => {
  assert.equal(deriveAgentStatus({ available: false }).id, "connected");
  assert.equal(deriveAgentStatus({ available: true, messages: [] }).id, "starting");
});
