const MIN_RECONNECT_DELAY = 500;
const MAX_RECONNECT_DELAY = 10000;

export function reconnectDelay(attempt) {
  const exponent = Math.max(0, Number(attempt) || 0);
  return Math.min(MIN_RECONNECT_DELAY * (2 ** exponent), MAX_RECONNECT_DELAY);
}

export function shouldReconnect({ active, manualClose, online }) {
  return Boolean(active && !manualClose && online);
}
