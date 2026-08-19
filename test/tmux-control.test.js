import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCopyScroll } from "../src/tmux.js";

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
