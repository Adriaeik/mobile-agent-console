import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const BUILTIN_PROVIDERS = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    models: [],
    modelPlaceholder: "default or model id",
    baseArgs: [],
    modelArgs: ["--model", "{model}"],
    permissions: [
      { id: "read-only", label: "Read only", args: ["--sandbox", "read-only", "--ask-for-approval", "untrusted"] },
      { id: "balanced", label: "Workspace + approvals", args: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"], default: true },
      { id: "autonomous", label: "Workspace autonomous", args: ["--sandbox", "workspace-write", "--ask-for-approval", "never"] },
      { id: "full", label: "Full host access", args: ["--sandbox", "danger-full-access", "--ask-for-approval", "never"], dangerous: true },
      { id: "yolo", label: "Bypass sandbox + approvals", args: ["--dangerously-bypass-approvals-and-sandbox"], dangerous: true }
    ]
  },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    models: ["sonnet", "opus", "haiku"],
    modelPlaceholder: "default, sonnet, opus, haiku or model id",
    baseArgs: [],
    modelArgs: ["--model", "{model}"],
    permissions: [
      { id: "plan", label: "Plan only", args: ["--permission-mode", "plan"] },
      { id: "default", label: "Ask as needed", args: ["--permission-mode", "default"], default: true },
      { id: "accept-edits", label: "Accept file edits", args: ["--permission-mode", "acceptEdits"] },
      { id: "bypass", label: "Bypass permissions", args: ["--dangerously-skip-permissions"], dangerous: true }
    ]
  },
  {
    id: "shell",
    label: "Raw shell",
    command: process.env.SHELL || "/bin/bash",
    models: [],
    modelPlaceholder: "not used",
    baseArgs: ["-l"],
    modelArgs: [],
    permissions: [
      { id: "shell", label: "Direct shell access", args: [], dangerous: true, default: true }
    ]
  }
];

function validProvider(provider) {
  return provider && typeof provider.id === "string" && typeof provider.label === "string" &&
    typeof provider.command === "string" && Array.isArray(provider.baseArgs) &&
    Array.isArray(provider.permissions) && provider.permissions.length > 0;
}

export async function loadProviders(file = process.env.AGENT_CONSOLE_PROVIDERS_FILE) {
  let providers = structuredClone(BUILTIN_PROVIDERS);
  if (file) {
    const custom = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(custom) || !custom.every(validProvider)) throw new Error("Invalid provider configuration.");
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    for (const provider of custom) byId.set(provider.id, provider);
    providers = [...byId.values()];
  }
  return Promise.all(providers.map(async (provider) => {
    const executable = await findExecutable(provider.command);
    const discoveredModels = executable && provider.id === "codex" ? await discoverCodexModels(executable) : [];
    return {
      ...provider,
      models: discoveredModels.length ? discoveredModels : provider.models,
      executable,
      available: Boolean(executable)
    };
  }));
}

async function discoverCodexModels(executable) {
  try {
    const { stdout } = await execFileAsync(executable, ["debug", "models", "--bundled"], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    return (payload.models || []).map((model) => model.slug || model.id).filter(Boolean);
  } catch {
    return [];
  }
}

export async function findExecutable(command, searchPath = process.env.PATH || "") {
  if (path.isAbsolute(command)) {
    try { await access(command, constants.X_OK); return command; } catch { return null; }
  }
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  return null;
}

export function buildLaunch(provider, { model = "", permission, prompt = "" }) {
  const mode = provider.permissions.find((item) => item.id === permission);
  if (!mode) throw new Error("Unknown permission profile.");
  const args = [...(provider.baseArgs || []), ...(mode.args || [])];
  if (model && provider.modelArgs?.length) {
    args.push(...provider.modelArgs.map((item) => item === "{model}" ? model : item));
  }
  if (prompt && provider.id !== "shell") args.push(prompt);
  return { command: provider.executable || provider.command, args, dangerous: Boolean(mode.dangerous) };
}

export function publicProvider(provider) {
  const { command, executable, baseArgs, modelArgs, ...safe } = provider;
  return safe;
}
