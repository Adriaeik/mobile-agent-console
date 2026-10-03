import test from "node:test";
import assert from "node:assert/strict";
import { classifyProvider, parsePaneMetadata, parseSessionList } from "../src/session-metadata.js";

test("parses tmux creation and activity timestamps", () => {
  assert.deepEqual(parseSessionList("$2\tagent\t100\t200\t1\t2\n"), [{
    id: "$2", name: "agent", created: 100000, lastActivity: 200000, attached: 1, windows: 2,
  }]);
});

test("parses pane metadata without guessing a provider", () => {
  assert.deepEqual(parsePaneMetadata("python\t/work/app\t0\t123\n"), {
    command: "python", cwd: "/work/app", dead: false, pid: 123,
  });
  assert.equal(classifyProvider({ paneCommand: "python", processArguments: ["python server.py"] }), "other");
});

test("classifies only exact known executable names", () => {
  assert.equal(classifyProvider({ paneCommand: "node", processArguments: ["node /opt/bin/codex resume"] }), "codex");
  assert.equal(classifyProvider({ paneCommand: "claude", processArguments: ["claude --resume abc"] }), "claude");
  assert.equal(classifyProvider({ paneCommand: "bash", processArguments: ["-bash"] }), "shell");
  assert.equal(classifyProvider({ paneCommand: "my-codex-proxy", processArguments: ["my-codex-proxy"] }), "other");
});
