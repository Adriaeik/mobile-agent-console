import path from "node:path";
import { readFile } from "node:fs/promises";

const SHELLS = new Set(["bash", "dash", "fish", "sh", "zsh"]);
const MAX_PROCESSES = 128;

function executableNames(values) {
  const names = new Set();
  for (const value of values) {
    for (const token of String(value || "").split(/[\0\s]+/)) {
      if (token) names.add(path.basename(token).toLowerCase());
    }
  }
  return names;
}

export function classifyProvider({ paneCommand = "", processArguments = [] } = {}) {
  const command = path.basename(String(paneCommand)).toLowerCase();
  const names = executableNames([command, ...processArguments]);
  if (names.has("codex")) return "codex";
  if (names.has("claude")) return "claude";
  if (SHELLS.has(command)) return "shell";
  return "other";
}

export function parseSessionList(output) {
  return String(output).trim().split("\n").filter(Boolean).map((line) => {
    const [id, name, created, activity, attached, windows] = line.split("\t");
    return {
      id,
      name,
      created: Number(created) * 1000,
      lastActivity: Number(activity || created) * 1000,
      attached: Number(attached),
      windows: Number(windows),
    };
  });
}

export function parsePaneMetadata(output) {
  const [command, cwd, dead, pid] = String(output).trimEnd().split("\t");
  return { command, cwd, dead: dead === "1", pid: Number(pid) };
}

export async function collectProcessArguments(rootPid, procRoot = "/proc") {
  const first = Number(rootPid);
  if (!Number.isSafeInteger(first) || first <= 0) return [];
  const queue = [first];
  const seen = new Set();
  const argumentsList = [];
  while (queue.length && seen.size < MAX_PROCESSES) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const cmdline = await readFile(path.join(procRoot, String(pid), "cmdline"), "utf8");
      if (cmdline) argumentsList.push(cmdline);
    } catch { /* process may exit while tmux metadata is collected */ }
    try {
      const children = await readFile(path.join(procRoot, String(pid), "task", String(pid), "children"), "utf8");
      for (const value of children.trim().split(/\s+/)) {
        const child = Number(value);
        if (Number.isSafeInteger(child) && child > 0 && !seen.has(child)) queue.push(child);
      }
    } catch { /* leaf or exited process */ }
  }
  return argumentsList;
}

export async function detectProvider(pane, procRoot = "/proc") {
  const direct = classifyProvider({ paneCommand: pane.command });
  if (direct !== "other") return direct;
  const processArguments = await collectProcessArguments(pane.pid, procRoot);
  return classifyProvider({ paneCommand: pane.command, processArguments });
}
