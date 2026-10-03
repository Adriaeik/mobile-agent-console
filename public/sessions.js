export const PINS_STORAGE_KEY = "mobile-agent-console:pins";
export const PROVIDER_STORAGE_KEY = "mobile-agent-console:session-provider";
const PROVIDERS = new Set(["all", "codex", "claude", "shell", "other"]);

export function loadPins(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(PINS_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.filter((name) => typeof name === "string" && name.length <= 48) : []);
  } catch {
    return new Set();
  }
}

export function savePins(storage, pins) {
  try { storage?.setItem(PINS_STORAGE_KEY, JSON.stringify([...pins].sort())); } catch { /* preferences are optional */ }
}

export function togglePin(pins, name) {
  const next = new Set(pins);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  return next;
}

export function loadProviderFilter(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(PROVIDER_STORAGE_KEY) || "all";
    return PROVIDERS.has(value) ? value : "all";
  } catch {
    return "all";
  }
}

export function saveProviderFilter(storage, provider) {
  if (!PROVIDERS.has(provider)) return;
  try { storage?.setItem(PROVIDER_STORAGE_KEY, provider); } catch { /* preferences are optional */ }
}

export function organizeSessions(sessions, { query = "", provider = "all", pins = new Set() } = {}) {
  const wanted = String(query).trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    if (provider !== "all" && session.provider !== provider) return false;
    if (!wanted) return true;
    return [session.name, session.cwd, session.command]
      .some((value) => String(value || "").toLocaleLowerCase().includes(wanted));
  }).sort((left, right) => {
    const pinDifference = Number(pins.has(right.name)) - Number(pins.has(left.name));
    if (pinDifference) return pinDifference;
    const activityDifference = Number(right.lastActivity || right.created || 0) - Number(left.lastActivity || left.created || 0);
    return activityDifference || left.name.localeCompare(right.name);
  });
}
