import test from "node:test";
import assert from "node:assert/strict";
import { MAX_LINES_PER_MESSAGE, ScrollAccumulator, wheelDeltaToPixels } from "../public/scroll.js";

test("batches rapid line requests into one counted tmux scroll", () => {
  const scroll = new ScrollAccumulator();
  for (let index = 0; index < 12; index += 1) scroll.addLines(1);
  assert.deepEqual(scroll.next(), { action: "line-up", count: 12 });
  assert.equal(scroll.next(), null);
});

test("splits batches larger than one tmux repeat count", () => {
  const scroll = new ScrollAccumulator();
  scroll.addLines(MAX_LINES_PER_MESSAGE + 8);
  assert.deepEqual(scroll.next(), { action: "line-up", count: MAX_LINES_PER_MESSAGE });
  assert.deepEqual(scroll.next(), { action: "line-up", count: 8 });
  assert.equal(scroll.next(), null);
});

test("maps drag direction to tmux scroll direction", () => {
  const scroll = new ScrollAccumulator();
  scroll.addPixels(-40, 20);
  assert.deepEqual(scroll.next(), { action: "line-down", count: 2 });
});

test("carries sub-line drag distance instead of dropping it", () => {
  const scroll = new ScrollAccumulator();
  assert.equal(scroll.addPixels(9, 20), 0);
  assert.equal(scroll.next(), null);
  assert.equal(scroll.addPixels(9, 20), 0);
  assert.equal(scroll.addPixels(9, 20), 1);
  assert.deepEqual(scroll.next(), { action: "line-up", count: 1 });
});

test("nets out a reversed drag", () => {
  const scroll = new ScrollAccumulator();
  scroll.addPixels(100, 20);
  scroll.addPixels(-60, 20);
  assert.deepEqual(scroll.next(), { action: "line-up", count: 2 });
});

test("reset drops pending movement and residue", () => {
  const scroll = new ScrollAccumulator();
  scroll.addPixels(35, 20);
  scroll.reset();
  assert.equal(scroll.next(), null);
  assert.equal(scroll.addPixels(15, 20), 0);
});

test("survives a missing or absurd line height", () => {
  const scroll = new ScrollAccumulator();
  assert.equal(scroll.addPixels(32, 0), 2);
  assert.equal(scroll.addPixels(0, 20), 0);
  assert.equal(new ScrollAccumulator().addPixels(Number.NaN, 20), 0);
});

test("converts every wheel delta mode to pixels", () => {
  assert.equal(wheelDeltaToPixels(-120, 0, 18), 120);
  assert.equal(wheelDeltaToPixels(3, 1, 18), -54);
  assert.equal(wheelDeltaToPixels(1, 2, 18), -180);
});
