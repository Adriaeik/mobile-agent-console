import path from "node:path";
import { lstat, open, readFile, readdir, readlink, stat } from "node:fs/promises";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROCESSES = 256;
const MAX_MESSAGES = 500;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CLAUDE_READ_BYTES = 64 * 1024 * 1024;
const MAX_CLAUDE_REMAINDER_BYTES = 1024 * 1024;
const MAX_CACHE_ENTRIES = 32;
const claudeCache = new Map();

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_MESSAGE_BYTES);
}

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicMessages(messages) {
  const kept = [];
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0 && kept.length < MAX_MESSAGES; index -= 1) {
    const message = messages[index];
    const size = Buffer.byteLength(message.text, "utf8");
    if (kept.length && bytes + size > MAX_RESPONSE_BYTES) break;
    bytes += size;
    kept.push(message);
  }
  kept.reverse();
  return kept.map((message, index) => ({ id: `message-${index}`, ...message }));
}

export function normalizeCodexConversation(rows) {
  const messages = [];
  for (const row of rows) {
    if (!row || !["userMessage", "agentMessage"].includes(row.item_type)) continue;
    let item;
    try { item = JSON.parse(row.item_json); } catch { continue; }
    if (!item || item.type !== row.item_type) continue;

    if (row.item_type === "userMessage") {
      if (!Array.isArray(item.content)) continue;
      const text = item.content
        .filter((part) => part?.type === "text")
        .map((part) => cleanText(part.text))
        .filter(Boolean)
        .join("\n\n");
      if (text) messages.push({ role: "user", text, timestamp: timestamp(row.created_at_ms) });
      continue;
    }

    const text = cleanText(item.text);
    if (text) messages.push({ role: "assistant", text, timestamp: timestamp(row.created_at_ms) });
  }
  return publicMessages(messages);
}

export function normalizeClaudeConversation(records) {
  const messages = [];
  for (const record of records) {
    if (!record || record.isMeta === true || record.isSidechain === true) continue;
    const content = record.message?.content;

    if (record.type === "user") {
      if (record.toolUseResult !== undefined || record.sourceToolAssistantUUID) continue;
      let text = "";
      if (typeof content === "string") {
        text = cleanText(content);
      } else if (Array.isArray(content) && !content.some((part) => part?.type === "tool_result")) {
        text = content
          .filter((part) => part?.type === "text")
          .map((part) => cleanText(part.text))
          .filter(Boolean)
          .join("\n\n");
      }
      if (text) messages.push({ role: "user", text, timestamp: timestamp(record.timestamp) });
      continue;
    }

    if (record.type !== "assistant" || !Array.isArray(content)) continue;
    const text = content
      .filter((part) => part?.type === "text")
      .map((part) => cleanText(part.text))
      .filter(Boolean)
      .join("\n\n");
    if (text) messages.push({ role: "assistant", text, timestamp: timestamp(record.timestamp) });
  }
  return publicMessages(messages);
}

export function selectCodexThread(candidates, cwd) {
  const matching = candidates.filter((candidate) => candidate.threadSource === "user" && candidate.cwd === cwd);
  return matching.length === 1 ? matching[0] : null;
}

export async function collectProcessIds(rootPid, procRoot = "/proc") {
  const first = Number(rootPid);
  if (!Number.isSafeInteger(first) || first <= 0) return [];
  const found = [];
  const pending = [first];
  const seen = new Set();
  while (pending.length && found.length < MAX_PROCESSES) {
    const pid = pending.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    found.push(pid);
    try {
      const children = await readFile(path.join(procRoot, String(pid), "task", String(pid), "children"), "utf8");
      for (const value of children.trim().split(/\s+/)) {
        const child = Number(value);
        if (Number.isSafeInteger(child) && child > 0 && !seen.has(child)) pending.push(child);
      }
    } catch { /* a process can exit while its tree is being inspected */ }
  }
  return found;
}

async function heldCodexThreadIds(pids, home, procRoot) {
  const lockRoot = path.resolve(home, ".codex", "thread-writer-locks");
  const ids = new Set();
  for (const pid of pids) {
    const fdRoot = path.join(procRoot, String(pid), "fd");
    let descriptors;
    try { descriptors = await readdir(fdRoot); } catch { continue; }
    for (const descriptor of descriptors) {
      let target;
      try { target = await readlink(path.join(fdRoot, descriptor)); } catch { continue; }
      const resolved = path.resolve(fdRoot, target);
      if (path.dirname(resolved) !== lockRoot || path.extname(resolved) !== ".lock") continue;
      const id = path.basename(resolved, ".lock");
      if (UUID.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

async function openReadOnlyDatabase(file) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(file, { readOnly: true });
}

async function loadCodexConversation({ pids, cwd, home, procRoot }) {
  const ids = await heldCodexThreadIds(pids, home, procRoot);
  if (!ids.length) return null;

  let stateDb;
  try {
    stateDb = await openReadOnlyDatabase(path.join(home, ".codex", "state_5.sqlite"));
    const placeholders = ids.map(() => "?").join(", ");
    const rows = stateDb.prepare(`
      SELECT id, cwd, thread_source AS threadSource
      FROM threads WHERE id IN (${placeholders})
    `).all(...ids);
    const selected = selectCodexThread(rows, cwd);
    if (!selected) return null;

    let historyDb;
    try {
      historyDb = await openReadOnlyDatabase(path.join(home, ".codex", "thread_history_1.sqlite"));
      const items = historyDb.prepare(`
        SELECT item_type, rollout_ordinal, created_at_ms, item_json
        FROM (
          SELECT item_type, rollout_ordinal, created_at_ms, item_json
          FROM thread_items
          WHERE thread_id = ? AND item_type IN ('userMessage', 'agentMessage')
          ORDER BY rollout_ordinal DESC LIMIT 1000
        )
        ORDER BY rollout_ordinal ASC
      `).all(selected.id);
      return { available: true, provider: "codex", messages: normalizeCodexConversation(items) };
    } finally {
      historyDb?.close();
    }
  } finally {
    stateDb?.close();
  }
}

async function findExactFile(root, filename) {
  const matches = [];
  let directories;
  try { directories = await readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(root, directory.name, filename);
    try {
      if ((await lstat(candidate)).isFile()) matches.push(candidate);
    } catch { /* not in this project */ }
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

function normalizeTrailingClaudeRecord(remainder) {
  if (!remainder) return [];
  try { return normalizeClaudeConversation([JSON.parse(remainder)]).map(({ id, ...message }) => message); }
  catch { return []; }
}

async function readClaudeMessages(file) {
  const info = await stat(file);
  let cached = claudeCache.get(file);
  if (!cached || info.dev !== cached.dev || info.ino !== cached.ino || info.size < cached.offset ||
      (info.size === cached.offset && info.mtimeMs !== cached.mtimeMs)) cached = null;
  if (cached && info.size === cached.offset && info.mtimeMs === cached.mtimeMs) {
    return publicMessages([...cached.messages, ...normalizeTrailingClaudeRecord(cached.remainder)]);
  }

  if (cached && info.size - cached.offset > MAX_CLAUDE_READ_BYTES) cached = null;
  const initialOffset = cached ? cached.offset : Math.max(0, info.size - MAX_CLAUDE_READ_BYTES);
  const length = info.size - initialOffset;
  const handle = await open(file, "r");
  let text;
  try {
    const buffer = Buffer.alloc(length);
    if (length) await handle.read(buffer, 0, length, initialOffset);
    text = buffer.toString("utf8");
  } finally {
    await handle.close();
  }

  if (!cached && initialOffset > 0) {
    const firstLine = text.indexOf("\n");
    text = firstLine === -1 ? "" : text.slice(firstLine + 1);
  } else if (cached?.remainder) {
    text = cached.remainder + text;
  }

  const lines = text.split("\n");
  const trailing = lines.pop() || "";
  const remainder = Buffer.byteLength(trailing, "utf8") <= MAX_CLAUDE_REMAINDER_BYTES ? trailing : "";
  const records = [];
  for (const line of lines) {
    if (!line) continue;
    try { records.push(JSON.parse(line)); } catch { /* unknown/corrupt lines fail closed */ }
  }
  const fresh = normalizeClaudeConversation(records).map(({ id, ...message }) => message);
  const messages = [...(cached?.messages || []), ...fresh].slice(-MAX_MESSAGES);
  if (!claudeCache.has(file) && claudeCache.size >= MAX_CACHE_ENTRIES) {
    claudeCache.delete(claudeCache.keys().next().value);
  }
  claudeCache.set(file, { offset: info.size, remainder, messages, dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs });
  return publicMessages([...messages, ...normalizeTrailingClaudeRecord(remainder)]);
}

async function loadClaudeConversation({ pids, cwd, home }) {
  const candidates = [];
  for (const pid of pids) {
    let metadata;
    try {
      metadata = JSON.parse(await readFile(path.join(home, ".claude", "sessions", `${pid}.json`), "utf8"));
    } catch { continue; }
    if (metadata?.pid !== pid || metadata.cwd !== cwd || !UUID.test(metadata.sessionId || "")) continue;
    candidates.push(metadata);
  }
  if (candidates.length !== 1) return null;
  const transcript = await findExactFile(path.join(home, ".claude", "projects"), `${candidates[0].sessionId}.jsonl`);
  if (!transcript) return null;
  return { available: true, provider: "claude", messages: await readClaudeMessages(transcript) };
}

export async function loadConversationForPane({ pid, cwd, home = process.env.HOME, procRoot = "/proc" }) {
  const unavailable = { available: false, reason: "No supported active agent conversation was found." };
  if (!home || typeof cwd !== "string") return unavailable;
  const pids = await collectProcessIds(pid, procRoot);
  if (!pids.length) return unavailable;
  try {
    const codex = await loadCodexConversation({ pids, cwd, home, procRoot });
    if (codex) return codex;
  } catch { /* provider changes or missing storage disable the optional view */ }
  try {
    const claude = await loadClaudeConversation({ pids, cwd, home });
    if (claude) return claude;
  } catch { /* provider changes or missing storage disable the optional view */ }
  return unavailable;
}
