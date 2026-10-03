import test from "node:test";
import assert from "node:assert/strict";
import { submitTerminalInput } from "../src/terminal-input.js";

test("pastes text and sends Enter as ordered tmux commands", async () => {
  const calls = [];
  await submitTerminalInput("$7:0.0", "Run the tests", {
    bufferName: "submission-test",
    loadBuffer: async (name, data) => calls.push(["load", name, data]),
    runTmux: async (args) => calls.push(["tmux", args]),
  });

  assert.deepEqual(calls, [
    ["load", "submission-test", "Run the tests"],
    ["tmux", ["paste-buffer", "-p", "-r", "-d", "-b", "submission-test", "-t", "$7:0.0"]],
    ["tmux", ["send-keys", "-t", "$7:0.0", "Enter"]],
  ]);
});

test("preserves multi-line input through the tmux paste buffer", async () => {
  const calls = [];
  await submitTerminalInput(
    "$2:0.0",
    "First line\nSecond line",
    {
      bufferName: "submission-lines",
      loadBuffer: async (name, data) => calls.push(["load", name, data]),
      runTmux: async (args) => calls.push(["tmux", args]),
    }
  );

  assert.deepEqual(calls[0], ["load", "submission-lines", "First line\nSecond line"]);
  assert.deepEqual(calls.at(-1), ["tmux", ["send-keys", "-t", "$2:0.0", "Enter"]]);
});

test("removes a tmux buffer if pasting fails", async () => {
  const commands = [];
  await assert.rejects(
    submitTerminalInput("$4:0.0", "Do work", {
      bufferName: "submission-failure",
      loadBuffer: async () => {},
      runTmux: async (args) => {
        commands.push(args);
        if (args[0] === "paste-buffer") throw new Error("pane closed");
      },
    }),
    /pane closed/
  );
  assert.deepEqual(commands.at(-1), ["delete-buffer", "-b", "submission-failure"]);
});
