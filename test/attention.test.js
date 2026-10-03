import test from "node:test";
import assert from "node:assert/strict";
import { createBellDetector } from "../src/attention.js";

test("terminal bells are detected without exposing their surrounding output", () => {
  let now = 10000;
  const detect = createBellDetector({ cooldown: 5000, now: () => now });
  assert.equal(detect("private output\u0007secret"), true);
  now += 100;
  assert.equal(detect("\u0007"), false);
  now += 5000;
  assert.equal(detect("\u0007"), true);
  assert.equal(detect("ordinary output"), false);
});
