const STATES = {
  disconnected: { id: "disconnected", label: "Disconnected" },
  exited: { id: "exited", label: "Exited" },
  connected: { id: "connected", label: "Connected" },
  starting: { id: "starting", label: "Starting" },
  working: { id: "working", label: "Working" },
  waiting: { id: "waiting", label: "Waiting for input" },
  attention: { id: "attention", label: "Needs attention" },
};

export function deriveAgentStatus(payload, { connected = true, exited = false } = {}) {
  if (exited) return STATES.exited;
  if (!connected) return STATES.disconnected;
  if (!payload?.available) return STATES.connected;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) return STATES.starting;
  return messages.at(-1)?.role === "user" ? STATES.working : STATES.waiting;
}

export function attentionStatus() {
  return STATES.attention;
}
