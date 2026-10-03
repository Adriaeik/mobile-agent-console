export const NOTIFICATION_STORAGE_KEY = "mobile-agent-console:notifications";

export function notificationsEnabled({ NotificationApi = globalThis.Notification, storage = globalThis.localStorage } = {}) {
  try {
    return NotificationApi?.permission === "granted" && storage?.getItem(NOTIFICATION_STORAGE_KEY) === "enabled";
  } catch {
    return false;
  }
}

export async function requestNotificationOptIn({ NotificationApi = globalThis.Notification, storage = globalThis.localStorage } = {}) {
  if (!NotificationApi?.requestPermission) return false;
  const permission = NotificationApi.permission === "granted"
    ? "granted"
    : await NotificationApi.requestPermission();
  try {
    if (permission === "granted") storage?.setItem(NOTIFICATION_STORAGE_KEY, "enabled");
    else storage?.removeItem(NOTIFICATION_STORAGE_KEY);
  } catch { /* notifications still work when storage is unavailable */ }
  return permission === "granted";
}

export function disableNotifications(storage = globalThis.localStorage) {
  try { storage?.removeItem(NOTIFICATION_STORAGE_KEY); } catch { /* storage can be disabled */ }
}

export function notificationForTransition({ enabled, hidden, previous, next }) {
  if (!enabled || !hidden || previous === next) return null;
  if (next === "attention") return "attention";
  if (previous === "working" && next === "waiting") return "ready";
  return null;
}

export async function showAgentNotification(registration, kind) {
  if (!registration?.showNotification || !["ready", "attention"].includes(kind)) return false;
  const title = kind === "ready" ? "Agent is ready" : "Agent needs attention";
  const body = kind === "ready"
    ? "An active session is waiting for input."
    : "An active terminal session requested attention.";
  await registration.showNotification(title, {
    body,
    tag: `mobile-agent-console-${kind}`,
    renotify: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: "/" },
  });
  return true;
}
