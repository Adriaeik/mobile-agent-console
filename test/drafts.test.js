import test from "node:test";
import assert from "node:assert/strict";
import { clearDraft, loadDraft, saveDraft } from "../public/drafts.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("saves and restores a bounded draft for one session", () => {
  const storage = memoryStorage();
  saveDraft(storage, "$4", "x".repeat(9000));
  assert.equal(loadDraft(storage, "$4").length, 8000);
  assert.equal(loadDraft(storage, "$5"), "");
});

test("clears drafts after a successful send", () => {
  const storage = memoryStorage();
  saveDraft(storage, "$4", "keep me");
  clearDraft(storage, "$4");
  assert.equal(loadDraft(storage, "$4"), "");
});

test("storage failures leave the composer usable", () => {
  const storage = {
    getItem: () => { throw new Error("disabled"); },
    setItem: () => { throw new Error("disabled"); },
    removeItem: () => { throw new Error("disabled"); },
  };
  assert.doesNotThrow(() => saveDraft(storage, "$4", "draft"));
  assert.equal(loadDraft(storage, "$4"), "");
  assert.doesNotThrow(() => clearDraft(storage, "$4"));
});
