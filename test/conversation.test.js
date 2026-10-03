import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  collectProcessIds,
  loadConversationForPane,
  normalizeClaudeConversation,
  normalizeCodexConversation,
  selectCodexThread,
} from "../src/conversation.js";

test("Codex conversation includes only user and agent text items", () => {
  const messages = normalizeCodexConversation([
    {
      item_type: "userMessage",
      rollout_ordinal: 1,
      created_at_ms: 100,
      item_json: JSON.stringify({
        type: "userMessage",
        id: "user-1",
        content: [
          { type: "text", text: "Please fix the login flow" },
          { type: "image", url: "private-image" },
        ],
      }),
    },
    {
      item_type: "reasoning",
      rollout_ordinal: 2,
      created_at_ms: 110,
      item_json: JSON.stringify({ type: "reasoning", summary: "SECRET_REASONING" }),
    },
    {
      item_type: "commandExecution",
      rollout_ordinal: 3,
      created_at_ms: 120,
      item_json: JSON.stringify({ type: "commandExecution", command: "cat .env", aggregatedOutput: "SECRET_COMMAND_OUTPUT" }),
    },
    {
      item_type: "fileChange",
      rollout_ordinal: 4,
      created_at_ms: 130,
      item_json: JSON.stringify({ type: "fileChange", changes: [{ diff: "SECRET_DIFF" }] }),
    },
    {
      item_type: "agentMessage",
      rollout_ordinal: 5,
      created_at_ms: 140,
      item_json: JSON.stringify({
        type: "agentMessage",
        id: "agent-1",
        text: "I found and fixed the issue.",
        phase: "final_answer",
      }),
    },
  ]);

  assert.deepEqual(messages, [
    { id: "message-0", role: "user", text: "Please fix the login flow", timestamp: 100 },
    { id: "message-1", role: "assistant", text: "I found and fixed the issue.", timestamp: 140 },
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /SECRET_|cat \.env/);
});

test("Codex conversation fails closed for malformed and mismatched item schemas", () => {
  const messages = normalizeCodexConversation([
    { item_type: "userMessage", rollout_ordinal: 1, created_at_ms: 1, item_json: "not json" },
    { item_type: "userMessage", rollout_ordinal: 2, created_at_ms: 2, item_json: JSON.stringify({ type: "commandExecution", content: [{ type: "text", text: "LEAK" }] }) },
    { item_type: "agentMessage", rollout_ordinal: 3, created_at_ms: 3, item_json: JSON.stringify({ type: "agentMessage", text: "   " }) },
    { item_type: "unknown", rollout_ordinal: 4, created_at_ms: 4, item_json: JSON.stringify({ type: "agentMessage", text: "LEAK" }) },
  ]);

  assert.deepEqual(messages, []);
});

test("Claude conversation excludes meta prompts, thinking, tools, and tool results", () => {
  const messages = normalizeClaudeConversation([
    {
      type: "user",
      uuid: "user-1",
      timestamp: "2026-10-03T10:00:00.000Z",
      message: { content: "Explain the failing test" },
    },
    {
      type: "user",
      uuid: "meta-1",
      isMeta: true,
      message: { content: "SECRET_META_PROMPT" },
    },
    {
      type: "assistant",
      uuid: "thinking-1",
      message: { content: [{ type: "thinking", thinking: "SECRET_THINKING" }] },
    },
    {
      type: "assistant",
      uuid: "tool-1",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat .env" } }] },
    },
    {
      type: "user",
      uuid: "result-1",
      toolUseResult: { stdout: "SECRET_TOOL_RESULT" },
      message: { content: [{ type: "tool_result", content: "SECRET_TOOL_RESULT" }] },
    },
    {
      type: "user",
      uuid: "result-2",
      toolUseResult: { stdout: "SECRET_STRING_TOOL_RESULT" },
      message: { content: "SECRET_STRING_TOOL_RESULT" },
    },
    {
      type: "assistant",
      uuid: "assistant-1",
      timestamp: "2026-10-03T10:00:01.000Z",
      message: {
        content: [
          { type: "text", text: "The assertion uses the wrong status code." },
          { type: "tool_use", name: "Edit", input: { patch: "SECRET_PATCH" } },
        ],
      },
    },
  ]);

  assert.deepEqual(messages, [
    { id: "message-0", role: "user", text: "Explain the failing test", timestamp: 1791021600000 },
    { id: "message-1", role: "assistant", text: "The assertion uses the wrong status code.", timestamp: 1791021601000 },
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /SECRET_|cat \.env/);
});

test("Claude conversation ignores sidechains and records mixing user text with tool results", () => {
  const messages = normalizeClaudeConversation([
    {
      type: "assistant",
      uuid: "sidechain-1",
      isSidechain: true,
      message: { content: [{ type: "text", text: "SUBAGENT_TEXT" }] },
    },
    {
      type: "user",
      uuid: "mixed-1",
      message: { content: [{ type: "text", text: "NOT_A_USER_PROMPT" }, { type: "tool_result", content: "output" }] },
    },
  ]);

  assert.deepEqual(messages, []);
});

test("selects the single held top-level Codex thread for the tmux working directory", () => {
  const selected = selectCodexThread([
    { id: "parent", cwd: "/work/app", threadSource: "user", rolloutPath: "/sessions/parent.jsonl" },
    { id: "child", cwd: "/work/app", threadSource: "subagent", rolloutPath: "/sessions/child.jsonl" },
    { id: "other", cwd: "/work/other", threadSource: "user", rolloutPath: "/sessions/other.jsonl" },
  ], "/work/app");

  assert.equal(selected.id, "parent");
});

test("fails closed when the active Codex thread is ambiguous", () => {
  assert.equal(selectCodexThread([
    { id: "one", cwd: "/work/app", threadSource: "user" },
    { id: "two", cwd: "/work/app", threadSource: "user" },
  ], "/work/app"), null);
});

async function fakeProcess(procRoot, pid, children = []) {
  await mkdir(path.join(procRoot, String(pid), "task", String(pid)), { recursive: true });
  await mkdir(path.join(procRoot, String(pid), "fd"), { recursive: true });
  await writeFile(path.join(procRoot, String(pid), "task", String(pid), "children"), children.join(" "));
}

test("walks only numeric descendants from the tmux pane process", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conversation-proc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await fakeProcess(root, 100, [101, 102]);
  await fakeProcess(root, 101, [103]);
  await fakeProcess(root, 102);
  await fakeProcess(root, 103);

  assert.deepEqual(await collectProcessIds(100, root), [100, 101, 102, 103]);
  assert.deepEqual(await collectProcessIds("not-a-pid", root), []);
});

test("binds a Codex pane to its held top-level thread and reads only message rows", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conversation-codex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const procRoot = path.join(root, "proc");
  const parentId = "01a10000-0000-7000-8000-000000000001";
  const childId = "01a10000-0000-7000-8000-000000000002";
  const lockRoot = path.join(home, ".codex", "thread-writer-locks");
  await mkdir(lockRoot, { recursive: true });
  await fakeProcess(procRoot, 200, [201]);
  await fakeProcess(procRoot, 201);
  for (const [fd, id] of [["7", parentId], ["8", childId]]) {
    const lock = path.join(lockRoot, `${id}.lock`);
    await writeFile(lock, "");
    await symlink(lock, path.join(procRoot, "201", "fd", fd));
  }

  const stateDb = new DatabaseSync(path.join(home, ".codex", "state_5.sqlite"));
  stateDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT, thread_source TEXT, rollout_path TEXT)");
  const insertThread = stateDb.prepare("INSERT INTO threads VALUES (?, ?, ?, ?)");
  insertThread.run(parentId, "/work/app", "user", "/sessions/parent.jsonl");
  insertThread.run(childId, "/work/app", "subagent", "/sessions/child.jsonl");
  stateDb.close();

  const historyDb = new DatabaseSync(path.join(home, ".codex", "thread_history_1.sqlite"));
  historyDb.exec("CREATE TABLE thread_items (thread_id TEXT, item_type TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT)");
  const insertItem = historyDb.prepare("INSERT INTO thread_items VALUES (?, ?, ?, ?, ?)");
  insertItem.run(parentId, "userMessage", 1, 10, JSON.stringify({ type: "userMessage", content: [{ type: "text", text: "Fix it" }] }));
  insertItem.run(parentId, "commandExecution", 2, 20, JSON.stringify({ type: "commandExecution", aggregatedOutput: "PRIVATE_OUTPUT" }));
  insertItem.run(parentId, "agentMessage", 3, 30, JSON.stringify({ type: "agentMessage", text: "Fixed." }));
  historyDb.close();

  const result = await loadConversationForPane({ pid: 200, cwd: "/work/app", home, procRoot });

  assert.equal(result.available, true);
  assert.equal(result.provider, "codex");
  assert.deepEqual(result.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Fix it" },
    { role: "assistant", text: "Fixed." },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OUTPUT|rolloutPath/);
  assert.equal(JSON.stringify(result).includes(parentId), false);
});

test("binds a Claude pane through validated process metadata and its exact transcript", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conversation-claude-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const procRoot = path.join(root, "proc");
  const sessionId = "550e8400-e29b-41d4-a716-446655440000";
  await fakeProcess(procRoot, 300, [301]);
  await fakeProcess(procRoot, 301);
  await mkdir(path.join(home, ".claude", "sessions"), { recursive: true });
  await writeFile(path.join(home, ".claude", "sessions", "301.json"), JSON.stringify({ pid: 301, cwd: "/work/app", sessionId }));
  const project = path.join(home, ".claude", "projects", "-work-app");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", uuid: "u1", message: { content: "Review this" } }),
    JSON.stringify({ type: "assistant", uuid: "a1", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat .env" } }] } }),
    JSON.stringify({ type: "assistant", uuid: "a2", message: { content: [{ type: "text", text: "The review is complete." }] } }),
  ].join("\n"));

  const result = await loadConversationForPane({ pid: 300, cwd: "/work/app", home, procRoot });

  assert.equal(result.available, true);
  assert.equal(result.provider, "claude");
  assert.deepEqual(result.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Review this" },
    { role: "assistant", text: "The review is complete." },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /cat \.env|sessionId/);

  const cached = await loadConversationForPane({ pid: 300, cwd: "/work/app", home, procRoot });
  assert.deepEqual(cached.messages.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "Review this" },
    { role: "assistant", text: "The review is complete." },
  ]);
});

test("does not bind Claude metadata with a mismatched PID or working directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "conversation-claude-mismatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const procRoot = path.join(root, "proc");
  await fakeProcess(procRoot, 400, [401]);
  await fakeProcess(procRoot, 401);
  await mkdir(path.join(home, ".claude", "sessions"), { recursive: true });
  await writeFile(path.join(home, ".claude", "sessions", "401.json"), JSON.stringify({
    pid: 999,
    cwd: "/work/other",
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
  }));

  const result = await loadConversationForPane({ pid: 400, cwd: "/work/app", home, procRoot });
  assert.deepEqual(result, { available: false, reason: "No supported active agent conversation was found." });
});
