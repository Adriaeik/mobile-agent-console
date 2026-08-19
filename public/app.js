const $ = (selector) => document.querySelector(selector);
const state = { config: null, sessions: [], socket: null, terminal: null, fit: null, active: null, copyMode: false };

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function showPage(id) {
  for (const page of ["dashboard", "create-page", "terminal-page"]) $(`#${page}`).classList.toggle("hidden", page !== id);
}

function age(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function renderSessions() {
  const root = $("#sessions");
  root.replaceChildren();
  if (!state.sessions.length) return root.append($("#empty-template").content.cloneNode(true));
  for (const session of state.sessions) {
    const card = document.createElement("article");
    card.className = "session-card";
    card.innerHTML = `<div><h2></h2><p class="command"></p><p class="cwd"></p><div class="session-actions"><button class="open">Open terminal</button><button class="kill">End session</button></div></div><div class="session-meta"><span class="badge"></span></div>`;
    card.querySelector("h2").textContent = session.name;
    card.querySelector(".command").textContent = session.command || "unknown";
    card.querySelector(".cwd").textContent = session.cwd || "window 0 unavailable";
    const badge = card.querySelector(".badge");
    badge.textContent = session.dead ? "exited" : `${age(session.created)} · ${session.attached} attached`;
    badge.classList.toggle("live", !session.dead);
    card.querySelector(".open").addEventListener("click", () => openTerminal(session.id, session.name));
    card.querySelector(".kill").addEventListener("click", () => endSession(session.id, session.name));
    root.append(card);
  }
}

async function refreshSessions() {
  try {
    state.sessions = (await request("/api/sessions")).sessions;
    renderSessions();
  } catch (error) { $("#identity").textContent = error.message; }
}

function providerChanged() {
  const provider = state.config.providers.find((item) => item.id === $("#provider").value);
  const models = $("#model-options");
  models.replaceChildren(...provider.models.map((model) => Object.assign(document.createElement("option"), { value: model })));
  $("#model").value = "";
  $("#model").placeholder = provider.modelPlaceholder || "default";
  $("#model-field").classList.toggle("hidden", !provider.modelArgs && provider.id === "shell");
  const permissions = $("#permission");
  permissions.replaceChildren(...provider.permissions.map((mode) => Object.assign(document.createElement("option"), { value: mode.id, textContent: mode.label, selected: Boolean(mode.default) })));
  permissionChanged();
}

function permissionChanged() {
  const provider = state.config.providers.find((item) => item.id === $("#provider").value);
  const mode = provider.permissions.find((item) => item.id === $("#permission").value);
  $("#danger-warning").classList.toggle("hidden", !mode?.dangerous);
  if (!mode?.dangerous) $("#confirm-dangerous").checked = false;
}

async function createSession(event) {
  event.preventDefault();
  const error = $("#create-error");
  error.textContent = "";
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const payload = {
      name: $("#session-name").value.trim(),
      path: $("#session-path").value.trim(),
      provider: $("#provider").value,
      model: $("#model").value.trim(),
      permission: $("#permission").value,
      prompt: $("#initial-prompt").value,
      confirmDangerous: $("#confirm-dangerous").checked
    };
    const session = await request("/api/sessions", { method: "POST", body: JSON.stringify(payload) });
    event.target.reset();
    await refreshSessions();
    openTerminal(session.id, session.name);
  } catch (err) { error.textContent = err.message; } finally { submit.disabled = false; }
}

async function endSession(id, name) {
  if (!confirm(`End tmux session “${name}”? Any running command in it will stop.`)) return;
  try { await request(`/api/sessions/${encodeURIComponent(id)}?confirm=${encodeURIComponent(name)}`, { method: "DELETE" }); await refreshSessions(); }
  catch (error) { alert(error.message); }
}

function send(data) {
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "input", data }));
}

function sendTmuxKey(key) {
  send(`\u0002${key}`);
  if (key === "[") setCopyMode(true);
  state.terminal?.focus();
}

function setCopyMode(active) {
  state.copyMode = active;
  const button = $("#tmux-copy");
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
  button.title = active ? "Exit tmux copy mode (q)" : "Enter tmux copy mode (Ctrl-B then [)";
}

function toggleCopyMode() {
  if (state.copyMode) {
    send("q");
    setCopyMode(false);
  } else {
    sendTmuxKey("[");
  }
}

function closeTmuxControls() {
  $("#tmux-dialog").close();
  $("#tmux-error").textContent = "";
  $("#tmux-key").value = "";
  state.terminal?.focus();
}

function fitTerminal() {
  if (!state.fit || !state.socket) return;
  state.fit.fit();
  state.socket.send(JSON.stringify({ type: "resize", cols: state.terminal.cols, rows: state.terminal.rows }));
}

function closeTerminal() {
  state.socket?.close();
  state.socket = null;
  state.terminal?.dispose();
  state.terminal = null;
  state.fit = null;
  state.active = null;
  setCopyMode(false);
  setComposerVisible(false);
  showPage("dashboard");
  refreshSessions();
}

function setComposerVisible(visible) {
  $("#composer").classList.toggle("hidden", !visible);
  $("#composer-toggle").setAttribute("aria-expanded", String(visible));
  $("#composer-toggle").querySelector("span").textContent = visible ? "Hide" : "Show";
  setTimeout(fitTerminal, 0);
  if (visible) $("#message").focus();
  else state.terminal?.focus();
}

function openTerminal(id, name) {
  showPage("terminal-page");
  state.active = name;
  setCopyMode(false);
  $("#terminal-name").textContent = name;
  $("#terminal-state").textContent = "Connecting…";
  $("#terminal").replaceChildren();
  state.terminal = new Terminal({
    cursorBlink: true,
    convertEol: false,
    scrollback: 5000,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: window.innerWidth < 500 ? 12 : 14,
    theme: { background: "#050607", foreground: "#edf2f5", cursor: "#b9ff66", selectionBackground: "#557a2b88" }
  });
  state.fit = new FitAddon.FitAddon();
  state.terminal.loadAddon(state.fit);
  state.terminal.open($("#terminal"));
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.socket = new WebSocket(`${protocol}//${location.host}/ws/sessions/${encodeURIComponent(id)}`);
  state.socket.addEventListener("open", () => { $("#terminal-state").textContent = "Live tmux · window 0"; fitTerminal(); state.terminal.focus(); });
  state.socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "output") state.terminal.write(message.data);
    if (message.type === "exit") $("#terminal-state").textContent = `Terminal exited (${message.exitCode})`;
  });
  state.socket.addEventListener("close", () => { $("#terminal-state").textContent = "Disconnected"; });
  state.terminal.onData(send);
  setTimeout(fitTerminal, 50);
}

async function browseDirectory(path) {
  try {
    const data = await request(`/api/directories?path=${encodeURIComponent(path || $("#session-path").value)}`);
    $("#directory-current").textContent = data.current;
    const list = $("#directory-list");
    list.replaceChildren();
    if (data.parent) {
      const up = Object.assign(document.createElement("button"), { textContent: "↰  Parent folder" });
      up.addEventListener("click", () => browseDirectory(data.parent));
      list.append(up);
    }
    for (const directory of data.directories) {
      const button = Object.assign(document.createElement("button"), { textContent: `▸  ${directory.name}` });
      button.addEventListener("click", () => browseDirectory(directory.path));
      list.append(button);
    }
    $("#directory-dialog").showModal();
  } catch (error) { $("#create-error").textContent = error.message; }
}

async function init() {
  state.config = await request("/api/config");
  $("#identity").textContent = state.config.authMode === "tailscale"
    ? `${state.config.identity.name} · verified by Tailscale`
    : "Local development mode";
  $("#session-path").value = state.config.roots[0];
  const options = state.config.providers.map((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = `${provider.label}${provider.available ? "" : " (not installed)"}`;
    option.disabled = !provider.available;
    return option;
  });
  $("#provider").replaceChildren(...options);
  providerChanged();
  await refreshSessions();
  setInterval(() => { if (!state.active) refreshSessions(); }, 5000);
}

$("#refresh").addEventListener("click", refreshSessions);
$("#new-session").addEventListener("click", () => showPage("create-page"));
document.querySelectorAll(".back").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.target)));
$("#provider").addEventListener("change", providerChanged);
$("#permission").addEventListener("change", permissionChanged);
$("#create-form").addEventListener("submit", createSession);
$("#browse").addEventListener("click", () => browseDirectory());
$("#directory-close").addEventListener("click", () => $("#directory-dialog").close());
$("#directory-select").addEventListener("click", () => { $("#session-path").value = $("#directory-current").textContent; $("#directory-dialog").close(); });
$("#terminal-back").addEventListener("click", closeTerminal);
$("#terminal-fit").addEventListener("click", fitTerminal);
window.addEventListener("resize", () => setTimeout(fitTerminal, 80));
document.querySelectorAll("button[data-key]").forEach((button) => button.addEventListener("click", () => {
  send(JSON.parse(`"${button.dataset.key}"`));
  if (button.closest("dialog")) closeTmuxControls();
}));
$("#tmux-copy").addEventListener("click", toggleCopyMode);
$("#tmux-controls").addEventListener("click", () => { $("#tmux-dialog").showModal(); $("#tmux-key").focus(); });
$("#composer-toggle").addEventListener("click", () => {
  const visible = $("#composer").classList.contains("hidden");
  closeTmuxControls();
  setComposerVisible(visible);
});
$("#tmux-close").addEventListener("click", closeTmuxControls);
document.querySelectorAll("[data-tmux-key]").forEach((button) => button.addEventListener("click", () => {
  sendTmuxKey(button.dataset.tmuxKey);
  closeTmuxControls();
}));
$("#tmux-custom-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const key = $("#tmux-key").value;
  if (!/^[\x20-\x7e]$/.test(key)) {
    $("#tmux-error").textContent = "Enter one printable key.";
    return;
  }
  sendTmuxKey(key);
  closeTmuxControls();
});
$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const field = $("#message");
  if (!field.value) return;
  const text = field.value.includes("\n") ? `\u001b[200~${field.value}\u001b[201~\r` : `${field.value}\r`;
  send(text);
  field.value = "";
});

init().catch((error) => { $("#identity").textContent = error.message; });
