import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import { assertSafeConfiguration, authMiddleware, authorizeRequest, isLoopback, validateOrigin } from "./security.js";
import { buildLaunch, loadProviders, publicProvider } from "./providers.js";
import { loadConversationForPane } from "./conversation.js";
import { submitTerminalInput } from "./terminal-input.js";
import { createSession, ensureTmuxMouse, getCopyModeState, getSessionPane, hasSessionId, killSession, listDirectories, listSessions, scrollCopyMode, setCopyMode } from "./tmux.js";
import { InputError, parseAllowedRoots, validateDirectory, validateOption, validatePrompt, validateSessionName } from "./validation.js";
import { API_PROTOCOL_VERSION, SERVER_INSTANCE_ID } from "./version.js";
import { heartbeatClients, markAlive } from "./heartbeat.js";
import { createBellDetector } from "./attention.js";
import { closeRuntime } from "./shutdown.js";
import { MAX_IMAGE_BYTES, saveImageUpload } from "./uploads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
assertSafeConfiguration();
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || "127.0.0.1";
const allowedRoots = parseAllowedRoots(process.env.ALLOWED_ROOTS);
const providers = await loadProviders();
const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  });
  next();
});
app.get("/healthz", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.sendStatus(404);
  res.json({ ok: true });
});
app.use(authMiddleware);
app.use(express.json({ limit: "16kb" }));

app.get("/vendor/xterm/xterm.js", (_req, res) => res.sendFile(path.join(root, "node_modules/@xterm/xterm/lib/xterm.js")));
app.get("/vendor/xterm/xterm.css", (_req, res) => res.sendFile(path.join(root, "node_modules/@xterm/xterm/css/xterm.css")));
app.get("/vendor/xterm/addon-fit.js", (_req, res) => res.sendFile(path.join(root, "node_modules/@xterm/addon-fit/lib/addon-fit.js")));

app.get("/api/config", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    apiProtocol: API_PROTOCOL_VERSION,
    instanceId: SERVER_INSTANCE_ID,
    identity: req.identity,
    roots: allowedRoots,
    providers: providers.map(publicProvider),
    publicOrigin: process.env.PUBLIC_ORIGIN || null,
    authMode: process.env.AUTH_MODE || "tailscale"
  });
});

app.get("/api/sessions", async (_req, res, next) => {
  try { res.json({ sessions: await listSessions() }); } catch (error) { next(error); }
});

app.get("/api/sessions/:id/conversation", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\$[0-9]+$/.test(id)) throw new InputError("Invalid tmux session id.");
    if (!await hasSessionId(id)) throw new InputError("Session not found.", 404);
    const pane = await getSessionPane(id);
    res.set("Cache-Control", "no-store");
    res.json(await loadConversationForPane(pane));
  } catch (error) { next(error); }
});

app.post(
  "/api/sessions/:id/uploads",
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      if (!/^\$[0-9]+$/.test(id)) throw new InputError("Invalid tmux session id.");
      if (!await hasSessionId(id)) throw new InputError("Session not found.", 404);
      const upload = await saveImageUpload({
        sessionId: id,
        contentType: req.get("content-type"),
        data: req.body,
      });
      res.status(201).json(upload);
    } catch (error) { next(error); }
  }
);

app.get("/api/directories", async (req, res, next) => {
  try { res.json(await listDirectories(String(req.query.path || ""), allowedRoots)); } catch (error) { next(error); }
});

app.post("/api/sessions", async (req, res, next) => {
  try {
    const name = validateSessionName(req.body.name);
    const cwd = await validateDirectory(req.body.path, allowedRoots);
    const providerId = validateOption(req.body.provider, "Provider", { optional: false });
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new InputError("Unknown provider.");
    if (!provider.available) throw new InputError(`${provider.label} is not installed on this host.`, 409);
    const permission = validateOption(req.body.permission, "Permission", { optional: false });
    const model = validateOption(req.body.model, "Model");
    const prompt = validatePrompt(req.body.prompt);
    const launch = buildLaunch(provider, { model, permission, prompt });
    if (launch.dangerous && req.body.confirmDangerous !== true) {
      throw new InputError("This permission profile requires explicit confirmation.", 409);
    }
    const session = await createSession({ name, cwd, launch });
    res.status(201).json(session);
  } catch (error) { next(error); }
});

app.delete("/api/sessions/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\$[0-9]+$/.test(id)) throw new InputError("Invalid tmux session id.");
    const name = String(req.query.confirm || "");
    if (!name) throw new InputError("Session deletion requires its exact name as confirmation.", 409);
    await killSession(id, name);
    res.sendStatus(204);
  } catch (error) { next(error); }
});

app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));
app.get("/{*path}", (_req, res) => res.sendFile(path.join(root, "public/index.html")));

app.use((error, _req, res, _next) => {
  const status = error.status || (error instanceof InputError ? 400 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "Internal server error." : error.message });
});

const server = http.createServer(app);
const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const terminals = new Set();
const heartbeatTimer = setInterval(() => heartbeatClients(sockets.clients), 30000);
heartbeatTimer.unref();
sockets.on("close", () => clearInterval(heartbeatTimer));

server.on("upgrade", async (req, socket, head) => {
  try {
    authorizeRequest(req);
    validateOrigin(req);
    const url = new URL(req.url, "http://localhost");
    const match = url.pathname.match(/^\/ws\/sessions\/(%24|\$)([0-9]+)$/i);
    const sessionId = match ? `$${match[2]}` : "";
    if (!sessionId || !await hasSessionId(sessionId)) throw new InputError("Session not found.", 404);
    await ensureTmuxMouse(sessionId);
    req.sessionId = sessionId;
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit("connection", ws, req));
  } catch (error) {
    const status = error.status || 401;
    socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
  }
});

sockets.on("connection", (ws, req) => {
  markAlive(ws);
  ws.on("pong", () => markAlive(ws));
  const target = `${req.sessionId}:0.0`;
  let controlQueue = Promise.resolve();
  let submissionQueue = Promise.resolve();
  const detectBell = createBellDetector();
  const sendJson = (message) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const sendControlState = async (state = null) => {
    const current = state || await getCopyModeState(target);
    sendJson({ type: "tmux-state", ...current });
  };
  const queueControl = (operation) => {
    controlQueue = controlQueue.then(operation).then(sendControlState).catch(async (error) => {
      console.error("tmux control failed:", error.message);
      sendJson({ type: "tmux-error", error: "tmux control failed; state was refreshed." });
      try { await sendControlState(); } catch { /* pane may have exited */ }
    });
  };
  const args = process.env.TMUX_SOCKET_NAME
    ? ["-L", process.env.TMUX_SOCKET_NAME, "attach-session", "-t", target]
    : ["attach-session", "-t", target];
  const terminal = pty.spawn("tmux", args, {
    name: "xterm-256color",
    cols: 100,
    rows: 32,
    cwd: process.env.HOME,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" }
  });
  terminals.add(terminal);
  terminal.onData((data) => {
    sendJson({ type: "output", data });
    if (detectBell(data)) sendJson({ type: "attention" });
  });
  terminal.onExit(({ exitCode }) => {
    terminals.delete(terminal);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "exit", exitCode }));
    ws.close();
  });
  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "input" && typeof message.data === "string" && message.data.length <= 65536) {
        terminal.write(message.data);
      } else if (message.type === "submit-input") {
        const submissionId = typeof message.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(message.id)
          ? message.id
          : null;
        const validData = typeof message.data === "string" && message.data.length > 0 &&
          message.data.length <= 8000 && !message.data.includes("\0");
        if (!submissionId || !validData) {
          sendJson({ type: "submission-result", id: submissionId, ok: false, error: "Invalid message." });
          return;
        }
        submissionQueue = submissionQueue.then(async () => {
          try {
            await submitTerminalInput(target, message.data);
            sendJson({ type: "submission-result", id: submissionId, ok: true });
          } catch (error) {
            console.error("terminal submission failed:", error.message);
            sendJson({ type: "submission-result", id: submissionId, ok: false, error: "The terminal did not accept the message." });
          }
        });
      } else if (message.type === "copy-mode" && typeof message.enabled === "boolean") {
        queueControl(() => setCopyMode(target, message.enabled));
      } else if (message.type === "copy-scroll") {
        queueControl(() => scrollCopyMode(target, message.action, message.count));
      } else if (message.type === "tmux-state") {
        queueControl(() => getCopyModeState(target));
      } else if (message.type === "resize") {
        const cols = Math.max(20, Math.min(300, Number(message.cols) || 100));
        const rows = Math.max(8, Math.min(120, Number(message.rows) || 32));
        terminal.resize(cols, rows);
      }
    } catch { /* ignore malformed client messages */ }
  });
  const killTerminal = () => {
    terminals.delete(terminal);
    try { terminal.kill(); } catch { /* already exited */ }
  };
  ws.on("close", killTerminal);
  ws.on("error", killTerminal);
  queueControl(() => getCopyModeState(target));
});

server.listen(port, host, () => {
  console.log(`Mobile Agent Console listening on http://${host}:${port}`);
  console.log(`Authentication mode: ${process.env.AUTH_MODE || "tailscale"}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(1), 8000);
  forceExit.unref();
  closeRuntime({ heartbeatTimer, sockets, terminals, server }, clearInterval, () => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

export { app, server };
