import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCopyScroll, parsePaneState, shouldEnableTmuxMouse, tmuxMouseArgs } from "../src/tmux.js";

test("allows only known tmux copy-mode scroll actions", () => {
  assert.deepEqual(normalizeCopyScroll("line-up", 7), { command: "scroll-up", repetitions: 7 });
  assert.deepEqual(normalizeCopyScroll("page-down"), { command: "page-down", repetitions: 1 });
  assert.throws(() => normalizeCopyScroll("cancel; kill-server", 1));
});

test("bounds copy-mode scroll repetitions", () => {
  assert.equal(normalizeCopyScroll("line-down", 0).repetitions, 1);
  assert.equal(normalizeCopyScroll("line-down", 500).repetitions, 50);
  assert.equal(normalizeCopyScroll("line-down", "8.9").repetitions, 8);
});

test("enables tmux mouse forwarding unless explicitly disabled", () => {
  assert.equal(shouldEnableTmuxMouse(undefined), true);
  assert.equal(shouldEnableTmuxMouse("on"), true);
  assert.equal(shouldEnableTmuxMouse("off"), false);
  assert.equal(shouldEnableTmuxMouse("false"), false);
  assert.equal(shouldEnableTmuxMouse("0"), false);
});

test("enables mouse only for the session being opened", () => {
  assert.deepEqual(tmuxMouseArgs("$12"), ["set-option", "-t", "$12", "mouse", "on"]);
  assert.deepEqual(tmuxMouseArgs("agent-one"), ["set-option", "-t", "agent-one", "mouse", "on"]);
  assert.throws(() => tmuxMouseArgs("bad:target"));
});

test("reports whether the pane owns mouse input or alternate-screen history", () => {
  assert.deepEqual(parsePaneState("0\t\t\t0\t1\n"), {
    copyMode: false,
    paneMode: null,
    inMode: false,
    scrollPosition: 0,
    mouseTracking: false,
    alternateScreen: true,
  });
  assert.equal(parsePaneState("0\t\t0\t1\t1\n").mouseTracking, true);
});
