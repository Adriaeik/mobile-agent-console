import path from "node:path";
import { realpath, stat } from "node:fs/promises";

const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const OPTION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/;

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "InputError";
    this.status = status;
  }
}

export function validateSessionName(value) {
  if (typeof value !== "string" || !SESSION_NAME.test(value)) {
    throw new InputError("Session names must be 1-48 characters: letters, numbers, dot, dash or underscore.");
  }
  return value;
}

export function validateOption(value, label, { optional = true } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return "";
  if (typeof value !== "string" || !OPTION_VALUE.test(value)) {
    throw new InputError(`${label} contains unsupported characters.`);
  }
  return value;
}

export function validatePrompt(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 8000 || value.includes("\0")) {
    throw new InputError("The initial prompt must be text no longer than 8,000 characters.");
  }
  return value;
}

export function parseAllowedRoots(value, home = process.env.HOME) {
  const roots = (value || path.join(home, "projects"))
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  return [...new Set(roots)];
}

export function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function validateDirectory(value, allowedRoots) {
  if (typeof value !== "string" || !value.trim()) throw new InputError("Choose a working directory.");
  let resolved;
  try {
    resolved = await realpath(path.resolve(value));
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new InputError("The selected working directory does not exist or is not accessible.");
  }
  if (!allowedRoots.some((root) => isInside(resolved, root))) {
    throw new InputError("The selected directory is outside the configured roots.", 403);
  }
  return resolved;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
