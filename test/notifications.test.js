import test from "node:test";
import assert from "node:assert/strict";
import { notificationForTransition, requestNotificationOptIn } from "../public/notifications.js";

test("notifies only for hidden-page ready or attention transitions", () => {
  assert.equal(notificationForTransition({ enabled: true, hidden: true, previous: "working", next: "waiting" }), "ready");
  assert.equal(notificationForTransition({ enabled: true, hidden: true, previous: "waiting", next: "attention" }), "attention");
  assert.equal(notificationForTransition({ enabled: true, hidden: false, previous: "working", next: "waiting" }), null);
  assert.equal(notificationForTransition({ enabled: false, hidden: true, previous: "working", next: "waiting" }), null);
  assert.equal(notificationForTransition({ enabled: true, hidden: true, previous: "waiting", next: "waiting" }), null);
});

test("notification opt-in persists only after permission is granted", async () => {
  const stored = [];
  const storage = { setItem: (...args) => stored.push(args), removeItem: () => {} };
  const NotificationApi = { permission: "default", requestPermission: async () => "granted" };
  assert.equal(await requestNotificationOptIn({ NotificationApi, storage }), true);
  assert.deepEqual(stored, [["mobile-agent-console:notifications", "enabled"]]);
});

test("denied notification permission cannot be enabled", async () => {
  const storage = { setItem: () => assert.fail("must not persist"), removeItem: () => {} };
  const NotificationApi = { permission: "default", requestPermission: async () => "denied" };
  assert.equal(await requestNotificationOptIn({ NotificationApi, storage }), false);
});
