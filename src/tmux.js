import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { InputError, isInside, shellQuote, validateDirectory, validateSessionName } from "./validation.js";

const execFileAsync = promisify(execFile);

function tmuxArgs(args) {
  return process.env.TMUX_SOCKET_NAME ? ["-L", process.env.TMUX_SOCKET_NAME, ...args] : args;
}

export async function runTmux(args, options = {}) {
  return execFileAsync("tmux", tmuxArgs(args), { maxBuffer: 2 * 1024 * 1024, ...options });
}

export async function hasSession(name) {
  try { await runTmux(["has-session", "-t", `=${name}`]); return true; } catch { return false; }
}

export async function hasSessionId(id) {
  if (!/^\$[0-9]+$/.test(id)) return false;
  try { await runTmux(["has-session", "-t", id]); return true; } catch { return false; }
}

function validatePaneTarget(target) {
  if (!/^\$[0-9]+:0\.0$/.test(target)) throw new InputError("Invalid tmux pane target.");
  return target;
}

export function normalizeCopyScroll(action, count = 1) {
  const commands = {
    "line-up": "scroll-up",
    "line-down": "scroll-down",
    "page-up": "page-up",
    "page-down": "page-down"
  };
  const command = commands[action];
  if (!command) throw new InputError("Invalid copy-mode action.");
  const repetitions = Math.max(1, Math.min(50, Math.trunc(Number(count) || 1)));
  return { command, repetitions };
}

export async function getCopyModeState(target) {
  validatePaneTarget(target);
  const { stdout } = await runTmux([
    "display-message", "-p", "-t", target,
    "#{pane_in_mode}\t#{pane_mode}\t#{scroll_position}"
  ]);
  const [inMode, paneMode, scrollPosition] = stdout.trimEnd().split("\t");
  return {
    copyMode: paneMode === "copy-mode",
    paneMode: paneMode || null,
    inMode: inMode === "1",
    scrollPosition: Number(scrollPosition) || 0
  };
}

export async function setCopyMode(target, enabled) {
  const current = await getCopyModeState(target);
  if (enabled && !current.copyMode) {
    if (current.inMode) await runTmux(["send-keys", "-X", "-t", target, "cancel"]);
    await runTmux(["copy-mode", "-t", target]);
  } else if (!enabled && current.inMode) {
    await runTmux(["send-keys", "-X", "-t", target, "cancel"]);
  }
  return getCopyModeState(target);
}

export async function scrollCopyMode(target, action, count) {
  const { command, repetitions } = normalizeCopyScroll(action, count);
  let state = await getCopyModeState(target);
  if (!state.copyMode) state = await setCopyMode(target, true);
  if (!state.copyMode) throw new Error("tmux did not enter copy mode.");
  await runTmux(["send-keys", "-X", "-N", String(repetitions), "-t", target, command]);
  return getCopyModeState(target);
}

export async function listSessions() {
  let stdout;
  try {
    ({ stdout } = await runTmux(["list-sessions", "-F", "#{session_id}\t#{session_name}\t#{session_created}\t#{session_attached}\t#{session_windows}"]));
  } catch (error) {
    if (String(error.stderr || error.message).includes("no server running") || error.code === 1) return [];
    throw error;
  }
  const sessions = stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [id, name, created, attached, windows] = line.split("\t");
    return { id, name, created: Number(created) * 1000, attached: Number(attached), windows: Number(windows) };
  });
  await Promise.all(sessions.map(async (session) => {
    try {
      const result = await runTmux(["list-panes", "-t", `${session.id}:0`, "-F", "#{pane_current_command}\t#{pane_current_path}\t#{pane_dead}\t#{pane_pid}"]);
      const [command, cwd, dead, pid] = result.stdout.trim().split("\t");
      Object.assign(session, { command, cwd, dead: dead === "1", pid: Number(pid) });
    } catch {
      Object.assign(session, { command: "unknown", cwd: "", dead: true, pid: 0 });
    }
  }));
  return sessions.sort((a, b) => b.created - a.created);
}

export async function createSession({ name, cwd, launch }) {
  validateSessionName(name);
  if (await hasSession(name)) throw new InputError("A tmux session with this name already exists.", 409);
  const command = `exec ${[launch.command, ...launch.args].map(shellQuote).join(" ")}`;
  await runTmux(["new-session", "-d", "-s", name, "-c", cwd, "-x", "120", "-y", "38", command]);
  try {
    await runTmux(["set-window-option", "-t", `${name}:0`, "remain-on-exit", "on"]);
    await runTmux(["set-window-option", "-t", `${name}:0`, "history-limit", "50000"]);
  } catch (error) {
    await runTmux(["kill-session", "-t", `=${name}`]).catch(() => {});
    throw error;
  }
  const { stdout } = await runTmux(["display-message", "-p", "-t", `${name}:0`, "#{session_id}"]);
  return { id: stdout.trim(), name };
}

export async function killSession(id, expectedName) {
  if (!await hasSessionId(id)) throw new InputError("Session not found.", 404);
  const { stdout } = await runTmux(["display-message", "-p", "-t", id, "#{session_name}"]);
  if (stdout.trim() !== expectedName) throw new InputError("Session confirmation does not match.", 409);
  await runTmux(["kill-session", "-t", id]);
}

export async function listDirectories(requested, allowedRoots) {
  const start = requested || allowedRoots[0];
  const current = await validateDirectory(start, allowedRoots);
  const entries = await readdir(current, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, path: path.join(current, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parentCandidate = await realpath(path.dirname(current));
  const parent = allowedRoots.some((root) => isInside(parentCandidate, root)) ? parentCandidate : null;
  return { current, parent, directories };
}
