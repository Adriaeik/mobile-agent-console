import test from "node:test";
import assert from "node:assert/strict";
import { heartbeatClients, markAlive } from "../src/heartbeat.js";

test("marks a client alive after a pong", () => {
  const client = { isAlive: false };
  markAlive(client);
  assert.equal(client.isAlive, true);
});

test("pings live clients and terminates clients that missed a heartbeat", () => {
  const events = [];
  const live = { isAlive: true, ping: () => events.push("ping") };
  const stale = { isAlive: false, terminate: () => events.push("terminate") };

  heartbeatClients([live, stale]);

  assert.deepEqual(events, ["ping", "terminate"]);
  assert.equal(live.isAlive, false);
});
