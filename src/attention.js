export function createBellDetector({ cooldown = 5000, now = Date.now } = {}) {
  let lastBellAt = -Infinity;
  return (output) => {
    if (typeof output !== "string" || !output.includes("\u0007")) return false;
    const current = now();
    if (current - lastBellAt < cooldown) return false;
    lastBellAt = current;
    return true;
  };
}
