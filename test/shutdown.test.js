import test from "node:test";
import assert from "node:assert/strict";
import { closeRuntime } from "../src/shutdown.js";

test("shutdown closes sockets and their tmux PTYs before the HTTP server", () => {
  const calls = [];
  const socket = { close: (code) => calls.push(["socket", code]) };
  const terminal = { kill: () => calls.push(["terminal"]) };
  const resources = {
    heartbeatTimer: 42,
    sockets: { clients: new Set([socket]), close: () => calls.push(["websocket-server"]) },
    terminals: new Set([terminal]),
    server: { close: () => calls.push(["http-server"]) },
  };
  closeRuntime(resources, (timer) => calls.push(["timer", timer]));
  assert.deepEqual(calls, [
    ["timer", 42],
    ["socket", 1001],
    ["terminal"],
    ["websocket-server"],
    ["http-server"],
  ]);
});
