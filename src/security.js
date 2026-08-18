import crypto from "node:crypto";

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function isLoopback(address = "") {
  return address === "127.0.0.1" || address === "::1" || address.startsWith("::ffff:127.");
}

export function assertSafeConfiguration(env = process.env) {
  const mode = env.AUTH_MODE || "tailscale";
  const host = env.HOST || "127.0.0.1";
  if (!["tailscale", "local"].includes(mode)) throw new Error(`Unsupported AUTH_MODE: ${mode}`);
  if (!isLoopback(host)) {
    throw new Error("HOST must be a loopback address. Put Tailscale Serve in front of the application.");
  }
  if (mode === "local") {
    if (env.NODE_ENV === "production") throw new Error("AUTH_MODE=local is forbidden in production.");
    if (env.ALLOW_LOCAL_AUTH !== "true") {
      throw new Error("Local authentication is disabled. Set ALLOW_LOCAL_AUTH=true only for local development.");
    }
    if (env.PUBLIC_ORIGIN) throw new Error("PUBLIC_ORIGIN must not be set with AUTH_MODE=local.");
    return true;
  }
  const allowed = String(env.ALLOWED_TAILSCALE_USERS || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.length || allowed.some((value) => value.includes("your-login"))) {
    throw new Error("Set ALLOWED_TAILSCALE_USERS to at least one real Tailscale login.");
  }
  let origin;
  try { origin = new URL(env.PUBLIC_ORIGIN); } catch { throw new Error("Set PUBLIC_ORIGIN to the Tailscale Serve HTTPS URL."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("PUBLIC_ORIGIN must be a bare HTTPS origin without credentials, path, query, or fragment.");
  }
  return true;
}

export function getIdentity(req) {
  const login = String(req.headers["tailscale-user-login"] || "").trim().toLowerCase();
  const name = String(req.headers["tailscale-user-name"] || "").trim();
  return login ? { login, name: name || login } : null;
}

export function authorizeRequest(req, env = process.env) {
  const mode = env.AUTH_MODE || "tailscale";
  if (mode === "local") {
    if (!isLoopback(req.socket?.remoteAddress)) throw new AuthError("Local mode only accepts loopback connections.", 403);
    return { login: "local-development", name: "Local development" };
  }
  const identity = getIdentity(req);
  if (!identity) throw new AuthError("A verified Tailscale identity is required.");
  const allowed = String(env.ALLOWED_TAILSCALE_USERS || "")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) throw new AuthError("No Tailscale users are configured on the server.", 503);
  const loginBuffer = Buffer.from(identity.login);
  const match = allowed.some((entry) => {
    const entryBuffer = Buffer.from(entry);
    return entryBuffer.length === loginBuffer.length && crypto.timingSafeEqual(entryBuffer, loginBuffer);
  });
  if (!match) throw new AuthError("This Tailscale identity is not allowed.", 403);
  return identity;
}

export function validateOrigin(req, env = process.env) {
  const expected = String(env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if ((env.AUTH_MODE || "tailscale") === "local" && isLoopback(req.socket?.remoteAddress)) return true;
  if (!expected) throw new AuthError("PUBLIC_ORIGIN is not configured.", 503);
  if (origin && origin !== expected) throw new AuthError("Origin rejected.", 403);
  return true;
}

export function authMiddleware(req, res, next) {
  try {
    req.identity = authorizeRequest(req);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) validateOrigin(req);
    next();
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message });
  }
}
