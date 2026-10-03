const MAX_DRAFT_LENGTH = 8000;
const PREFIX = "mobile-agent-console:draft:";

function key(sessionId) {
  return `${PREFIX}${encodeURIComponent(String(sessionId))}`;
}

export function loadDraft(storage, sessionId) {
  try {
    return String(storage.getItem(key(sessionId)) || "").slice(0, MAX_DRAFT_LENGTH);
  } catch {
    return "";
  }
}

export function saveDraft(storage, sessionId, value) {
  try {
    const draft = String(value).slice(0, MAX_DRAFT_LENGTH);
    if (draft) storage.setItem(key(sessionId), draft);
    else storage.removeItem(key(sessionId));
  } catch { /* storage can be disabled without breaking terminal input */ }
}

export function clearDraft(storage, sessionId) {
  try { storage.removeItem(key(sessionId)); } catch { /* storage may be disabled */ }
}
