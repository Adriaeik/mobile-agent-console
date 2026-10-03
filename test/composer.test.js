import test from "node:test";
import assert from "node:assert/strict";
import { messagePayload, shouldSubmitComposerKey } from "../public/composer.js";

test("Enter sends a chat message while Shift+Enter inserts a new line", () => {
  assert.equal(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(shouldSubmitComposerKey({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSubmitComposerKey({ key: "a", shiftKey: false, isComposing: false }), false);
});

test("single-line messages use the ordered submit protocol", () => {
  assert.deepEqual(messagePayload("Please run the tests"), {
    type: "submit-input",
    data: "Please run the tests"
  });
});

test("multi-line messages are sent intact for server-side bracketed paste", () => {
  assert.deepEqual(messagePayload("First line\nSecond line"), {
    type: "submit-input",
    data: "First line\nSecond line"
  });
});

test("blank messages are not submitted", () => {
  assert.equal(messagePayload(""), null);
});
