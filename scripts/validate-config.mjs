import { access } from "node:fs/promises";
import { assertSafeConfiguration } from "../src/security.js";
import { parseAllowedRoots } from "../src/validation.js";

assertSafeConfiguration(process.env);

const appPort = Number(process.env.PORT || 3210);
const httpsPort = Number(process.env.TAILSCALE_HTTPS_PORT || 8443);
for (const [label, value] of [["PORT", appPort], ["TAILSCALE_HTTPS_PORT", httpsPort]]) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${label} must be a valid TCP port.`);
}

const origin = new URL(process.env.PUBLIC_ORIGIN);
const originPort = Number(origin.port || 443);
if (originPort !== httpsPort) {
  throw new Error("PUBLIC_ORIGIN and TAILSCALE_HTTPS_PORT must use the same port.");
}

const roots = parseAllowedRoots(process.env.ALLOWED_ROOTS);
if (!process.env.ALLOWED_ROOTS || roots.length === 0 || roots.some((root) => root.includes("your-user"))) {
  throw new Error("Set ALLOWED_ROOTS to one or more real absolute directories separated by colons.");
}
for (const root of roots) await access(root);

console.log("Configuration is valid.");
