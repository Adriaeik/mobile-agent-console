import test from "node:test";
import assert from "node:assert/strict";
import { submitTerminalInput } from "../src/terminal-input.js";

test("submits text and Enter as separate ordered terminal writes", async () => {
  const writes = [];
  let continueAfterText;
  const pause = () => new Promise((resolve) => { continueAfterText = resolve; });
  const submission = submitTerminalInput({ write: (data) => writes.push(data) }, "Run the tests", pause);

  assert.deepEqual(writes, ["Run the tests"]);
  continueAfterText();
  await submission;
  assert.deepEqual(writes, ["Run the tests", "\r"]);
});

test("uses bracketed paste for multi-line terminal input", async () => {
  const writes = [];
  await submitTerminalInput(
    { write: (data) => writes.push(data) },
    "First line\nSecond line",
    () => Promise.resolve()
  );

  assert.deepEqual(writes, ["\u001b[200~First line\nSecond line\u001b[201~", "\r"]);
});
