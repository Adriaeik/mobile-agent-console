import {
  ScrollAccumulator,
  scrollTargetForPane,
  wheelDeltasForStep,
  wheelDeltaToPixels,
} from "./scroll.js";
import { conversationSignature, shouldFollowConversation } from "./conversation-view.js";
import { request } from "./api-client.js";
import { messagePayload, shouldSubmitComposerKey } from "./composer.js";
import { assertCompatibleConfig, deploymentChanged, IncompatibleServerError } from "./version.js";
import { reconnectDelay, shouldReconnect } from "./reconnect.js";
import { clearDraft, loadDraft, saveDraft } from "./drafts.js";
import { registerServiceWorker } from "./pwa.js";
import { attentionStatus, deriveAgentStatus } from "./agent-status.js";
import {
  disableNotifications,
  notificationForTransition,
  notificationsEnabled,
  requestNotificationOptIn,
  showAgentNotification,
} from "./notifications.js";

const $ = (selector) => document.querySelector(selector);
const state = {
  config: null, sessions: [], socket: null, terminal: null, fit: null, active: null,
  copyMode: false, copyModePending: false, copyModeAssumed: false,
  mouseTracking: false, alternateScreen: false,
  scrollInFlight: false, scrollTimer: null, stateRefreshTimer: null,
  lastScrollPosition: null, lastTuiPageAt: -Infinity, lastTuiPageAction: null,
  viewportTimer: null, conversationMode: false, conversationTimer: null,
  conversationLoading: false, conversationGeneration: 0, conversationSignature: null,
  composerBeforeConversation: false, reconnectTimer: null, reconnectAttempt: 0,
  manualClose: false, agentStatus: null, notificationEnabled: notificationsEnabled(),
  serviceWorkerRegistration: null
};

// Held keys and flicks would otherwise emit one websocket message per step; the
// accumulator batches them into a single counted tmux scroll per round trip.
const scroll = new ScrollAccumulator();
const SCROLL_ACK_TIMEOUT = 600;
const TUI_PAGE_INTERVAL = 180;
const TOUCH_SLOP = 8;
const REPEAT_DELAY = 350;
const REPEAT_INTERVAL = 55;
const REPEAT_FAST_INTERVAL = 22;
const REPEAT_ACCELERATE_AFTER = 6;
const MOMENTUM_FRICTION = 0.94;
const MOMENTUM_MIN_VELOCITY = 0.22;
const MOMENTUM_MAX_VELOCITY = 4;
const VIEWPORT_SETTLE = 120;

function showUpdateBanner(message = "The console was updated. Reload to use the current version.") {
  $("#update-message").textContent = message;
  $("#update-banner").classList.remove("hidden");
}

function syncNotificationUi() {
  const button = $("#notification-toggle");
  const supported = "Notification" in window && "serviceWorker" in navigator;
  button.disabled = !supported;
  button.setAttribute("aria-pressed", String(state.notificationEnabled));
  button.querySelector("span").textContent = supported ? (state.notificationEnabled ? "On" : "Off") : "Unavailable";
}

async function notifyForStatus(next) {
  const kind = notificationForTransition({
    enabled: state.notificationEnabled,
    hidden: document.hidden,
    previous: state.agentStatus?.id,
    next: next.id,
  });
  if (kind) {
    const registration = await state.serviceWorkerRegistration;
    await showAgentNotification(registration, kind);
  }
}

function setAgentStatus(next) {
  notifyForStatus(next).catch(() => {});
  state.agentStatus = next;
  const element = $("#agent-status");
  element.textContent = next.label;
  element.dataset.status = next.id;
}

async function checkDeployment() {
  try {
    const config = assertCompatibleConfig(await request("/api/config"));
    if (deploymentChanged(state.config?.instanceId, config.instanceId)) showUpdateBanner();
  } catch (error) {
    if (error instanceof IncompatibleServerError) showUpdateBanner(error.message);
  }
}

function renderConversation(payload) {
  const root = $("#conversation");
  const messagesRoot = $("#conversation-messages");
  const empty = $("#conversation-empty");
  if (!payload.available) {
    messagesRoot.replaceChildren();
    empty.textContent = payload.reason || "Conversation view is unavailable for this session.";
    empty.classList.remove("hidden");
    state.conversationSignature = null;
    $("#terminal-state").textContent = "Conversation unavailable";
    return;
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const signature = conversationSignature(messages);
  $("#terminal-state").textContent = `Conversation · ${payload.provider === "claude" ? "Claude" : "Codex"}`;
  empty.textContent = "No user or assistant text has been recorded yet.";
  empty.classList.toggle("hidden", messages.length > 0);
  if (signature === state.conversationSignature) return;

  const follow = !messagesRoot.childElementCount || shouldFollowConversation(root);
  const fragment = document.createDocumentFragment();
  for (const message of messages) {
    if (!["user", "assistant"].includes(message.role) || typeof message.text !== "string") continue;
    const article = document.createElement("article");
    article.className = `conversation-message ${message.role}`;
    const label = document.createElement("span");
    label.textContent = message.role === "user" ? "You" : payload.provider === "claude" ? "Claude" : "Codex";
    const text = document.createElement("p");
    text.textContent = message.text;
    article.append(label, text);
    fragment.append(article);
  }
  messagesRoot.replaceChildren(fragment);
  state.conversationSignature = signature;
  if (follow) root.scrollTop = root.scrollHeight;
}

async function refreshConversation() {
  if (!state.active || state.conversationLoading) return;
  const generation = state.conversationGeneration;
  state.conversationLoading = true;
  try {
    const payload = await request(`/api/sessions/${encodeURIComponent(state.active.id)}/conversation`);
    if (generation === state.conversationGeneration) {
      setAgentStatus(deriveAgentStatus(payload, { connected: state.socket?.readyState === WebSocket.OPEN }));
      if (state.conversationMode) renderConversation(payload);
    }
  } catch (error) {
    if (state.conversationMode && generation === state.conversationGeneration) {
      renderConversation({ available: false, reason: error.message });
    }
  } finally {
    state.conversationLoading = false;
    if (state.active && generation === state.conversationGeneration) {
      state.conversationTimer = setTimeout(refreshConversation, document.hidden ? 5000 : 1500);
    }
  }
}

function setConversationMode(enabled, { focus = true } = {}) {
  const wasEnabled = state.conversationMode;
  state.conversationMode = Boolean(enabled);
  state.conversationGeneration += 1;
  state.conversationLoading = false;
  clearTimeout(state.conversationTimer);
  state.conversationTimer = null;
  state.conversationSignature = null;
  $("#terminal").classList.toggle("hidden", state.conversationMode);
  $("#conversation").classList.toggle("hidden", !state.conversationMode);
  $(".key-row").classList.toggle("hidden", state.conversationMode);
  $("#terminal-fit").classList.toggle("hidden", state.conversationMode);
  $("#conversation-toggle").setAttribute("aria-pressed", String(state.conversationMode));
  $("#conversation-toggle").querySelector("span").textContent = state.conversationMode ? "Hide" : "Show";
  $("#view-toggle").setAttribute("aria-pressed", String(state.conversationMode));
  $("#view-toggle").setAttribute("aria-label", state.conversationMode ? "Show terminal view" : "Show chat view");
  $("#view-toggle").textContent = state.conversationMode ? "Terminal" : "Chat";

  if (state.conversationMode) {
    if (!wasEnabled) state.composerBeforeConversation = !$("#composer").classList.contains("hidden");
    setComposerVisible(true, { focus: false });
    if (state.copyMode) requestCopyMode(false);
    $("#conversation-empty").textContent = "Loading conversation…";
    $("#conversation-empty").classList.remove("hidden");
    $("#conversation-messages").replaceChildren();
    $("#terminal-state").textContent = "Loading conversation…";
    if (focus) $("#conversation").focus({ preventScroll: true });
    refreshConversation();
  } else {
    if (wasEnabled) setComposerVisible(state.composerBeforeConversation, { focus: false });
    $("#conversation-messages").replaceChildren();
    $("#conversation-empty").classList.add("hidden");
    syncScrollUi();
    setTimeout(fitTerminal, 0);
    if (focus) state.terminal?.focus();
  }
  if (state.active) refreshConversation();
}

function showPage(id) {
  for (const page of ["dashboard", "create-page", "terminal-page"]) $(`#${page}`).classList.toggle("hidden", page !== id);
  trackViewport();
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

function sendSocket(message) {
  if (state.socket?.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(message));
  return true;
}

function send(data) {
  return sendSocket({ type: "input", data });
}

function sendTmuxKey(key) {
  send(`\u0002${key}`);
  state.terminal?.focus();
}

function scheduleTmuxStateRefresh() {
  clearTimeout(state.stateRefreshTimer);
  state.stateRefreshTimer = setTimeout(() => {
    state.stateRefreshTimer = null;
    sendSocket({ type: "tmux-state" });
  }, 100);
}

function activeScrollTarget() {
  return scrollTargetForPane(state);
}

function syncScrollUi() {
  const button = $("#tmux-copy");
  if (!button || state.copyMode) return;
  const tui = activeScrollTarget() !== "tmux";
  button.setAttribute("aria-pressed", "false");
  button.title = tui
    ? "Scroll up in the fullscreen application (PgUp)"
    : "Enter tmux copy mode (Ctrl-B then [)";
  if (!state.conversationMode && state.socket?.readyState === WebSocket.OPEN) {
    $("#terminal-state").textContent = tui ? "Live TUI · swipe to scroll" : "Live tmux · swipe to scroll";
  }
}

function setCopyMode(active) {
  const wasActive = state.copyMode;
  state.copyMode = active;
  state.copyModePending = false;
  if (wasActive && !active) {
    state.copyModeAssumed = false;
    stopMomentum();
    scroll.reset();
  }
  const button = $("#tmux-copy");
  button.classList.toggle("active", active);
  button.disabled = false;
  button.setAttribute("aria-pressed", String(active));
  button.title = active ? "Exit tmux copy mode (q)" : "Enter tmux copy mode (Ctrl-B then [)";
  $("#terminal").classList.toggle("copy-mode", active);
  if (!state.conversationMode && state.socket?.readyState === WebSocket.OPEN) {
    $("#terminal-state").textContent = active ? "Scroll mode · swipe or hold arrows" : "Live tmux · swipe to scroll";
  }
  syncScrollUi();
}

function requestCopyMode(enabled) {
  if (state.copyModePending || !sendSocket({ type: "copy-mode", enabled })) return;
  state.copyModePending = true;
  $("#tmux-copy").disabled = true;
  state.terminal?.focus();
}

function toggleCopyMode() {
  if (activeScrollTarget() !== "tmux") {
    queueScrollPage("page-up");
    state.terminal?.focus();
    return;
  }
  requestCopyMode(!state.copyMode);
}

function scrollCopyMode(action, count = 1) {
  sendSocket({ type: "copy-scroll", action, count });
  state.terminal?.focus();
}

function queueScrollPage(action) {
  if (activeScrollTarget() === "terminal-keys") {
    sendTuiPage(action, true);
    return;
  }
  const lines = Math.max(1, (state.terminal?.rows || 24) - 2);
  queueScrollLines(action === "page-up" ? lines : -lines);
}

function sendTuiPage(action, force = false) {
  const pageAction = ["line-up", "page-up"].includes(action) ? "page-up" : "page-down";
  const now = performance.now();
  if (!force && pageAction === state.lastTuiPageAction && now - state.lastTuiPageAt < TUI_PAGE_INTERVAL) return false;
  state.lastTuiPageAt = now;
  state.lastTuiPageAction = pageAction;
  return send(pageAction === "page-up" ? "\u001b[5~" : "\u001b[6~");
}

// tmux enters copy mode by itself on the first scroll-up, exactly like a wheel in a
// mouse-enabled terminal. Scrolling down while already live has nothing to reveal.
function scrolling() {
  return activeScrollTarget() !== "tmux" || state.copyMode || state.copyModeAssumed;
}

function dispatchTerminalScroll(step) {
  const element = state.terminal?.element;
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    deltaMode: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    view: window,
  };
  for (const deltaY of wheelDeltasForStep(step, lineHeight())) {
    element.dispatchEvent(new WheelEvent("wheel", { ...eventInit, deltaY }));
  }
  scheduleTmuxStateRefresh();
  return true;
}

function flushScroll() {
  if (state.scrollInFlight) return;
  if (!scrolling() && scroll.pending < 0) scroll.reset();
  const step = scroll.next();
  if (!step) return;
  const target = activeScrollTarget();
  if (target === "terminal") {
    if (!dispatchTerminalScroll(step)) scroll.reset();
    else if (scroll.pending) queueMicrotask(flushScroll);
    return;
  }
  if (target === "terminal-keys") {
    sendTuiPage(step.action);
    if (scroll.pending) queueMicrotask(flushScroll);
    return;
  }
  if (!sendSocket({ type: "copy-scroll", ...step })) {
    scroll.reset();
    return;
  }
  if (step.action === "line-up") state.copyModeAssumed = true;
  state.scrollInFlight = true;
  clearTimeout(state.scrollTimer);
  state.scrollTimer = setTimeout(acknowledgeScroll, SCROLL_ACK_TIMEOUT);
}

// Every tmux control reply releases the gate, so gestures stay in lockstep with the
// server instead of queueing up a backlog that keeps scrolling after the finger stops.
function acknowledgeScroll() {
  clearTimeout(state.scrollTimer);
  state.scrollTimer = null;
  clearTimeout(state.stateRefreshTimer);
  state.stateRefreshTimer = null;
  state.scrollInFlight = false;
  flushScroll();
}

function queueScrollLines(lines) {
  if (!lines) return;
  if (!scrolling() && lines < 0) return;
  scroll.addLines(lines);
  flushScroll();
}

function queueScrollPixels(pixels) {
  if (!pixels) return;
  if (!scrolling() && pixels < 0) return;
  if (scroll.addPixels(pixels, lineHeight())) flushScroll();
}

function lineHeight() {
  const row = $("#terminal").querySelector(".xterm-rows > div");
  const measured = row?.getBoundingClientRect().height || 0;
  if (measured > 4) return measured;
  const rows = state.terminal?.rows || 24;
  return Math.max(8, ($("#terminal").clientHeight || 240) / rows);
}

function handleTerminalInput(data) {
  if (!state.copyMode) return send(data);
  if (data === "q" || data === "\u001b" || data === "\r") return requestCopyMode(false);
  if (data === "\u001b[A") return queueScrollLines(1);
  if (data === "\u001b[B") return queueScrollLines(-1);
  return send(data);
}

const touch = { id: null, startX: 0, startY: 0, lastY: 0, lastTime: 0, velocity: 0, tracking: false, scrolling: false };
let momentum = null;

function stopMomentum() {
  if (momentum !== null) cancelAnimationFrame(momentum);
  momentum = null;
}

// A flick keeps scrolling briefly after release, the way a native list does.
function startMomentum(velocity) {
  if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) return;
  let current = Math.max(-MOMENTUM_MAX_VELOCITY, Math.min(MOMENTUM_MAX_VELOCITY, velocity));
  let previous = null;
  const step = (time) => {
    const elapsed = previous === null ? 16 : Math.min(32, time - previous);
    previous = time;
    queueScrollPixels(current * elapsed);
    current *= MOMENTUM_FRICTION ** (elapsed / 16);
    if (Math.abs(current) < MOMENTUM_MIN_VELOCITY / 2) return stopMomentum();
    momentum = requestAnimationFrame(step);
  };
  momentum = requestAnimationFrame(step);
}

function startScrollTouch(event) {
  stopMomentum();
  if (event.touches.length !== 1) {
    touch.tracking = false;
    return;
  }
  const point = event.touches[0];
  Object.assign(touch, {
    id: point.identifier, startX: point.clientX, startY: point.clientY, lastY: point.clientY,
    lastTime: event.timeStamp, velocity: 0, tracking: true, scrolling: false
  });
}

function trackScrollTouch(event) {
  if (!touch.tracking) return;
  // A second finger means pinch or selection; hand the gesture back untouched.
  if (event.touches.length !== 1) {
    touch.tracking = false;
    touch.scrolling = false;
    return;
  }
  const point = event.touches[0];
  if (point.identifier !== touch.id) return;
  if (!touch.scrolling) {
    const dy = point.clientY - touch.startY;
    const dx = point.clientX - touch.startX;
    // Wait for a clearly vertical drag so taps still reach xterm and horizontal
    // swipes stay available to the terminal itself.
    if (Math.abs(dy) < TOUCH_SLOP || Math.abs(dy) <= Math.abs(dx)) return;
    touch.scrolling = true;
    touch.lastY = point.clientY;
    touch.lastTime = event.timeStamp;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const moved = point.clientY - touch.lastY;
  const elapsed = Math.max(1, event.timeStamp - touch.lastTime);
  touch.lastY = point.clientY;
  touch.lastTime = event.timeStamp;
  touch.velocity = moved / elapsed;
  queueScrollPixels(moved);
}

function finishScrollTouch(event) {
  if (!touch.tracking) return;
  touch.tracking = false;
  if (!touch.scrolling) return;
  touch.scrolling = false;
  // Swallow the tap the browser would synthesise from this drag, which is what
  // used to reach the page as a second tap and trigger double-tap zoom.
  event.preventDefault();
  event.stopImmediatePropagation();
  startMomentum(touch.velocity);
}

function cancelScrollTouch() {
  touch.tracking = false;
  touch.scrolling = false;
}

function closeTmuxControls() {
  $("#tmux-dialog").close();
  $("#tmux-error").textContent = "";
  $("#tmux-key").value = "";
  state.terminal?.focus();
}

// The on-screen keyboard shrinks the visual viewport but not the layout viewport, so a
// fixed, inset-0 page keeps its full height and hides its own bottom rows — the key row,
// the composer, and the shell's input line — behind the keyboard. Binding the page to the
// visual viewport lifts the whole toolbar above it and lets tmux reflow into what is left.
function trackViewport() {
  const view = window.visualViewport;
  const page = $("#terminal-page");
  if (!view) return;
  if (page.classList.contains("hidden")) {
    page.style.removeProperty("height");
    page.style.removeProperty("top");
    page.style.removeProperty("bottom");
    return;
  }
  page.style.height = `${Math.round(view.height)}px`;
  page.style.top = `${Math.round(view.offsetTop)}px`;
  page.style.bottom = "auto";
  clearTimeout(state.viewportTimer);
  state.viewportTimer = setTimeout(fitTerminal, VIEWPORT_SETTLE);
}

function fitTerminal() {
  if (state.conversationMode || !state.fit || state.socket?.readyState !== WebSocket.OPEN) return;
  state.fit.fit();
  state.socket.send(JSON.stringify({ type: "resize", cols: state.terminal.cols, rows: state.terminal.rows }));
}

function closeTerminal() {
  state.manualClose = true;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  stopRepeat();
  stopMomentum();
  scroll.reset();
  clearTimeout(state.scrollTimer);
  state.scrollTimer = null;
  state.scrollInFlight = false;
  state.lastScrollPosition = null;
  state.mouseTracking = false;
  state.alternateScreen = false;
  state.lastTuiPageAt = -Infinity;
  state.lastTuiPageAction = null;
  state.copyModeAssumed = false;
  setConversationMode(false, { focus: false });
  const socket = state.socket;
  state.socket = null;
  state.active = null;
  state.agentStatus = null;
  socket?.close();
  state.terminal?.dispose();
  state.terminal = null;
  state.fit = null;
  state.reconnectAttempt = 0;
  state.copyModePending = false;
  $("#message").value = "";
  setCopyMode(false);
  setComposerVisible(false);
  showPage("dashboard");
  refreshSessions();
}

function setComposerVisible(visible, { focus = true } = {}) {
  $("#composer").classList.toggle("hidden", !visible);
  $("#composer-toggle").setAttribute("aria-expanded", String(visible));
  $("#composer-toggle").querySelector("span").textContent = visible ? "Hide" : "Show";
  setTimeout(fitTerminal, 0);
  if (focus) {
    if (visible) $("#message").focus();
    else state.terminal?.focus();
  }
}

function handleSocketMessage(data) {
  const message = JSON.parse(data);
  if (message.type === "output") state.terminal.write(message.data, () => {
    syncScrollUi();
    scheduleTmuxStateRefresh();
  });
  if (message.type === "exit") {
    state.manualClose = true;
    setAgentStatus(deriveAgentStatus(null, { exited: true }));
    $("#terminal-state").textContent = `Terminal exited (${message.exitCode})`;
  }
  if (message.type === "attention") setAgentStatus(attentionStatus());
  if (message.type === "tmux-state") {
    // Momentum that no longer moves the pane has hit the top of the history.
    state.mouseTracking = message.mouseTracking === true;
    state.alternateScreen = message.alternateScreen === true;
    const copyMode = message.copyMode === true;
    if (momentum !== null && scrollTargetForPane({ ...state, copyMode }) === "tmux" &&
        message.scrollPosition === state.lastScrollPosition) stopMomentum();
    state.lastScrollPosition = message.scrollPosition;
    setCopyMode(copyMode);
    acknowledgeScroll();
  }
  if (message.type === "tmux-error") {
    state.copyModePending = false;
    state.copyModeAssumed = false;
    stopMomentum();
    scroll.reset();
    acknowledgeScroll();
    $("#tmux-copy").disabled = false;
    $("#terminal-state").textContent = message.error;
  }
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (!shouldReconnect({ active: state.active, manualClose: state.manualClose, online: navigator.onLine !== false })) {
    if (state.active && navigator.onLine === false) {
      setAgentStatus(deriveAgentStatus(null, { connected: false }));
      $("#terminal-state").textContent = "Offline · waiting to reconnect";
    }
    return;
  }
  const delay = reconnectDelay(state.reconnectAttempt);
  state.reconnectAttempt += 1;
  $("#terminal-state").textContent = `Reconnecting in ${Math.ceil(delay / 1000)}s…`;
  setAgentStatus(deriveAgentStatus(null, { connected: false }));
  state.reconnectTimer = setTimeout(connectTerminalSocket, delay);
}

function connectTerminalSocket() {
  if (!state.active || state.manualClose) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws/sessions/${encodeURIComponent(state.active.id)}`);
  state.socket = socket;
  $("#terminal-state").textContent = state.reconnectAttempt ? "Reconnecting…" : "Connecting…";
  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;
    state.reconnectAttempt = 0;
    setAgentStatus(deriveAgentStatus({ available: false }));
    if (!state.conversationMode) $("#terminal-state").textContent = "Live tmux · window 0";
    fitTerminal();
    if (!state.conversationMode) state.terminal.focus();
    checkDeployment();
  });
  socket.addEventListener("message", ({ data }) => {
    if (state.socket === socket) handleSocketMessage(data);
  });
  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.socket = null;
    stopRepeat();
    setCopyMode(false);
    if (!state.manualClose) scheduleReconnect();
  });
  socket.addEventListener("error", () => socket.close());
}

function reconnectNow() {
  if (!shouldReconnect({ active: state.active, manualClose: state.manualClose, online: navigator.onLine !== false })) return;
  if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(state.socket?.readyState)) return;
  state.reconnectAttempt = 0;
  state.agentStatus = null;
  connectTerminalSocket();
}

function openTerminal(id, name) {
  showPage("terminal-page");
  state.active = { id, name };
  state.manualClose = false;
  state.reconnectAttempt = 0;
  setConversationMode(false, { focus: false });
  setCopyMode(false);
  $("#terminal-name").textContent = name;
  setAgentStatus(deriveAgentStatus(null, { connected: false }));
  $("#terminal-state").textContent = "Connecting…";
  $("#message").value = loadDraft(sessionStorage, id);
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
  state.terminal.onData(handleTerminalInput);
  connectTerminalSocket();
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
  state.config = assertCompatibleConfig(await request("/api/config"));
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
  setInterval(checkDeployment, 60000);
}

$("#refresh").addEventListener("click", refreshSessions);
$("#reload-app").addEventListener("click", () => location.reload());
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
$("#view-toggle").addEventListener("click", () => setConversationMode(!state.conversationMode));
window.addEventListener("resize", () => setTimeout(fitTerminal, 80));
window.addEventListener("online", reconnectNow);
window.addEventListener("offline", () => {
  if (state.active) $("#terminal-state").textContent = "Offline · waiting to reconnect";
});
window.visualViewport?.addEventListener("resize", trackViewport);
window.visualViewport?.addEventListener("scroll", trackViewport);
// Focusing an input is what raises the keyboard; iOS reports the new viewport late.
document.addEventListener("focusin", () => setTimeout(trackViewport, 50));
document.addEventListener("focusout", () => setTimeout(trackViewport, 50));
const repeat = { button: null, timer: null, ticks: 0 };

function pressKey(button) {
  handleTerminalInput(JSON.parse(`"${button.dataset.key}"`));
}

function stopRepeat() {
  clearTimeout(repeat.timer);
  repeat.button?.classList.remove("held");
  repeat.button = null;
  repeat.timer = null;
  repeat.ticks = 0;
}

function repeatTick() {
  if (!repeat.button) return;
  repeat.ticks += 1;
  pressKey(repeat.button);
  const interval = repeat.ticks >= REPEAT_ACCELERATE_AFTER ? REPEAT_FAST_INTERVAL : REPEAT_INTERVAL;
  repeat.timer = setTimeout(repeatTick, interval);
}

document.querySelectorAll("button[data-key]").forEach((button) => {
  const repeatable = button.dataset.repeat !== undefined;
  button.addEventListener("click", (event) => {
    // Repeating keys already fired on pointerdown. Keyboard and assistive-technology
    // activation reports detail 0 and still has to be handled here.
    if (repeatable && event.detail !== 0) return;
    pressKey(button);
    if (button.closest("dialog")) closeTmuxControls();
  });
  if (!repeatable) return;
  button.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) return;
    // Suppressing the default keeps focus on the terminal, stops the long-press
    // callout, and prevents the synthesised taps that the browser reads as a
    // double-tap zoom when the key is pressed quickly.
    event.preventDefault();
    stopRepeat();
    repeat.button = button;
    button.classList.add("held");
    pressKey(button);
    repeat.timer = setTimeout(repeatTick, REPEAT_DELAY);
    // Capture keeps the repeat alive when a finger drifts off a small key.
    try { button.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, stopRepeat);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});
window.addEventListener("pointerup", stopRepeat);
window.addEventListener("blur", stopRepeat);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRepeat();
    stopMomentum();
  } else {
    reconnectNow();
    checkDeployment();
  }
});
$("#tmux-copy").addEventListener("click", toggleCopyMode);
$("#conversation-toggle").addEventListener("click", () => {
  const enabled = !state.conversationMode;
  closeTmuxControls();
  setConversationMode(enabled);
});
$("#tmux-exit-copy").addEventListener("click", () => { requestCopyMode(false); closeTmuxControls(); });
document.querySelectorAll("[data-copy-scroll]").forEach((button) => button.addEventListener("click", () => {
  if (activeScrollTarget() !== "tmux") {
    queueScrollPage(button.dataset.copyScroll);
    state.terminal?.focus();
  } else {
    scrollCopyMode(button.dataset.copyScroll);
  }
  closeTmuxControls();
}));
$("#tmux-controls").addEventListener("click", () => { $("#tmux-dialog").showModal(); $("#tmux-key").focus(); });
$("#composer-toggle").addEventListener("click", () => {
  const visible = $("#composer").classList.contains("hidden");
  closeTmuxControls();
  setComposerVisible(visible);
});
$("#notification-toggle").addEventListener("click", async () => {
  if (state.notificationEnabled) {
    disableNotifications();
    state.notificationEnabled = false;
  } else {
    state.notificationEnabled = await requestNotificationOptIn();
  }
  syncNotificationUi();
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
  const payload = messagePayload(field.value);
  if (!payload) return;
  if (!sendSocket(payload)) {
    $("#terminal-state").textContent = "Disconnected · message not sent";
    return;
  }
  clearDraft(sessionStorage, state.active.id);
  field.value = "";
  field.focus({ preventScroll: true });
  if (state.conversationMode) $("#terminal-state").textContent = "Message sent · waiting for agent";
});
$("#message").addEventListener("input", (event) => {
  if (state.active) saveDraft(sessionStorage, state.active.id, event.currentTarget.value);
});
$("#message").addEventListener("keydown", (event) => {
  if (!shouldSubmitComposerKey(event)) return;
  event.preventDefault();
  $("#composer").requestSubmit();
});

$("#terminal").addEventListener("touchstart", startScrollTouch, { passive: false, capture: true });
$("#terminal").addEventListener("touchmove", trackScrollTouch, { passive: false, capture: true });
$("#terminal").addEventListener("touchend", finishScrollTouch, { passive: false, capture: true });
$("#terminal").addEventListener("touchcancel", cancelScrollTouch, { capture: true });
$("#terminal").addEventListener("wheel", (event) => {
  if (event.deltaY === 0) return;
  // xterm translates native wheel events into the mouse protocol requested by
  // tmux/fullscreen TUIs. Let its target listener see the event unchanged.
  if (activeScrollTarget() === "terminal") {
    scheduleTmuxStateRefresh();
    return;
  }
  const pixels = wheelDeltaToPixels(event.deltaY, event.deltaMode, lineHeight());
  if (!scrolling() && pixels < 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  queueScrollPixels(pixels);
}, { passive: false, capture: true });

state.serviceWorkerRegistration = registerServiceWorker().catch(() => null);
syncNotificationUi();

init().catch((error) => {
  $("#identity").textContent = error.message;
  if (error instanceof IncompatibleServerError) showUpdateBanner(error.message);
});
