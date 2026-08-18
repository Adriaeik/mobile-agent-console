import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunch, BUILTIN_PROVIDERS, publicProvider } from "../src/providers.js";

test("builds Codex launch arguments without a shell", () => {
  const provider = { ...BUILTIN_PROVIDERS.find((item) => item.id === "codex"), executable: "/bin/codex" };
  const launch = buildLaunch(provider, { model: "gpt-5.6-sol", permission: "balanced", prompt: "inspect tests" });
  assert.equal(launch.command, "/bin/codex");
  assert.deepEqual(launch.args, [
    "--sandbox", "workspace-write", "--ask-for-approval", "on-request",
    "--model", "gpt-5.6-sol", "inspect tests"
  ]);
  assert.equal(launch.dangerous, false);
});

test("marks bypass modes and raw shells as dangerous", () => {
  const codex = BUILTIN_PROVIDERS.find((item) => item.id === "codex");
  const shell = BUILTIN_PROVIDERS.find((item) => item.id === "shell");
  assert.equal(buildLaunch(codex, { permission: "yolo" }).dangerous, true);
  assert.equal(buildLaunch(shell, { permission: "shell" }).dangerous, true);
});

test("does not disclose host executable paths to the browser", () => {
  const safe = publicProvider({ ...BUILTIN_PROVIDERS[0], executable: "/secret/path" });
  assert.equal("command" in safe, false);
  assert.equal("executable" in safe, false);
  assert.equal("baseArgs" in safe, false);
});
