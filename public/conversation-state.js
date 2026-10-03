export function addPendingMessage(pending, text, timestamp = Date.now(), id = `pending-${timestamp}`) {
  return [...pending, { id, role: "user", text, timestamp, pending: true }];
}

export function mergePendingMessages(messages, pending, { reconcile = false } = {}) {
  const remaining = [...pending];
  if (reconcile) {
    for (const message of messages) {
      if (message.role !== "user") continue;
      const match = remaining.findIndex((item) => item.text === message.text &&
        (!message.timestamp || !item.timestamp || message.timestamp >= item.timestamp - 5000));
      if (match !== -1) remaining.splice(match, 1);
    }
  }
  const merged = [...messages, ...remaining];
  return reconcile ? { messages: merged, pending: remaining } : merged;
}

export function searchMessages(messages, query) {
  const wanted = String(query || "").trim().toLocaleLowerCase();
  if (!wanted) return [];
  const matches = [];
  messages.forEach((message, index) => {
    if (`${message.role} ${message.text}`.toLocaleLowerCase().includes(wanted)) matches.push(index);
  });
  return matches;
}
