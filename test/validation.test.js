import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { isInside, parseAllowedRoots, shellQuote, validateOption, validatePrompt, validateSessionName } from "../src/validation.js";

test("accepts safe tmux session names", () => {
  assert.equal(validateSessionName("api-refactor_2.0"), "api-refactor_2.0");
});

test("rejects names that could become tmux or shell syntax", () => {
  for (const value of ["", "-bad", "has space", "a:b", "$(touch nope)", "a".repeat(49)]) {
    assert.throws(() => validateSessionName(value));
  }
});

test("validates provider option values", () => {
  assert.equal(validateOption("gpt-5.6-sol", "Model"), "gpt-5.6-sol");
  assert.throws(() => validateOption("model; reboot", "Model"));
});

test("limits initial prompts", () => {
  assert.equal(validatePrompt("hello\nworld"), "hello\nworld");
  assert.throws(() => validatePrompt("x".repeat(8001)));
  assert.throws(() => validatePrompt("bad\0prompt"));
});

test("recognizes paths inside configured roots", () => {
  assert.equal(isInside("/home/developer/projects/app", "/home/developer/projects"), true);
  assert.equal(isInside("/home/developer/projectile", "/home/developer/projects"), false);
  assert.deepEqual(parseAllowedRoots("/one:/two:/one", os.homedir()), ["/one", "/two"]);
});

test("quotes arbitrary values for the tmux shell command", () => {
  assert.equal(shellQuote("it's safe"), `'it'"'"'s safe'`);
});
