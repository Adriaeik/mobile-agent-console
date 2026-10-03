// Scroll bookkeeping shared by the touch, wheel and held-key paths.
// Kept free of DOM access so it can be unit tested under node --test.

// tmux copy-mode accepts a repeat count; batching keeps one round trip per frame
// instead of one per gesture step.
export const MAX_LINES_PER_MESSAGE = 50;

// Positive line counts scroll toward older output ("line-up"), matching a finger
// dragged downwards and a wheel turned away from the user.
export class ScrollAccumulator {
  constructor(maxLinesPerMessage = MAX_LINES_PER_MESSAGE) {
    this.max = Math.max(1, Math.trunc(Number(maxLinesPerMessage) || MAX_LINES_PER_MESSAGE));
    this.pending = 0;
    this.residual = 0;
  }

  reset() {
    this.pending = 0;
    this.residual = 0;
  }

  addLines(lines) {
    const whole = Math.trunc(Number(lines) || 0);
    this.pending += whole;
    return whole;
  }

  // Sub-line movement is carried over so a slow drag still advances one line at a time.
  addPixels(pixels, lineHeight) {
    const height = Number(lineHeight) > 0 ? Number(lineHeight) : 16;
    this.residual += Number(pixels) || 0;
    const lines = Math.trunc(this.residual / height);
    if (!lines) return 0;
    this.residual -= lines * height;
    this.pending += lines;
    return lines;
  }

  next() {
    if (!this.pending) return null;
    const lines = Math.max(-this.max, Math.min(this.max, this.pending));
    this.pending -= lines;
    return { action: lines > 0 ? "line-up" : "line-down", count: Math.abs(lines) };
  }
}

export function wheelDeltaToPixels(deltaY, deltaMode, lineHeight) {
  const height = Number(lineHeight) > 0 ? Number(lineHeight) : 16;
  const delta = Number(deltaY) || 0;
  if (deltaMode === 1) return -delta * height;
  if (deltaMode === 2) return -delta * height * 10;
  return -delta;
}

// Fullscreen terminal applications keep their own history. When xterm reports
// that the application requested mouse tracking, wheel events must reach that
// application instead of opening tmux copy mode.
export function scrollTargetForMouseMode(mode) {
  return mode && mode !== "none" ? "terminal" : "tmux";
}

export function wheelDeltasForStep(step, lineHeight) {
  if (!step || !["line-up", "line-down"].includes(step.action)) return [];
  const count = Math.max(0, Math.min(MAX_LINES_PER_MESSAGE, Math.trunc(Number(step.count) || 0)));
  const height = Number(lineHeight) > 0 ? Number(lineHeight) : 16;
  const delta = step.action === "line-up" ? -height : height;
  return Array.from({ length: count }, () => delta);
}
