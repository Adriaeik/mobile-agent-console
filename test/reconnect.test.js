import test from "node:test";
import assert from "node:assert/strict";
import { reconnectDelay, shouldReconnect } from "../public/reconnect.js";

test("uses bounded exponential reconnect delays", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 8].map(reconnectDelay), [500, 1000, 2000, 4000, 8000, 10000]);
});

test("reconnects only for an active non-manual online session", () => {
  assert.equal(shouldReconnect({ active: true, manualClose: false, online: true }), true);
  assert.equal(shouldReconnect({ active: false, manualClose: false, online: true }), false);
  assert.equal(shouldReconnect({ active: true, manualClose: true, online: true }), false);
  assert.equal(shouldReconnect({ active: true, manualClose: false, online: false }), false);
});
