import test from "node:test";
import assert from "node:assert/strict";
import { API_PROTOCOL_VERSION as SERVER_PROTOCOL } from "../src/version.js";
import {
  API_PROTOCOL_VERSION as BROWSER_PROTOCOL,
  assertCompatibleConfig,
  deploymentChanged,
} from "../public/version.js";

test("browser and server use the same API protocol", () => {
  assert.equal(BROWSER_PROTOCOL, SERVER_PROTOCOL);
});

test("rejects a missing or incompatible server protocol", () => {
  assert.throws(() => assertCompatibleConfig({}), /restart.*reload/i);
  assert.throws(
    () => assertCompatibleConfig({ apiProtocol: BROWSER_PROTOCOL + 1, instanceId: "next" }),
    /restart.*reload/i
  );
});

test("accepts a compatible config with a process instance", () => {
  const config = { apiProtocol: BROWSER_PROTOCOL, instanceId: "current" };
  assert.equal(assertCompatibleConfig(config), config);
});

test("detects a server process change without treating first load as an update", () => {
  assert.equal(deploymentChanged(null, "current"), false);
  assert.equal(deploymentChanged("current", "current"), false);
  assert.equal(deploymentChanged("current", "next"), true);
});
