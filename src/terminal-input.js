import { randomUUID } from "node:crypto";
import { loadTmuxBuffer, runTmux } from "./tmux.js";

export async function submitTerminalInput(target, value, dependencies = {}) {
  const loadBuffer = dependencies.loadBuffer || loadTmuxBuffer;
  const tmux = dependencies.runTmux || runTmux;
  const bufferName = dependencies.bufferName || `mobile-agent-console-${randomUUID()}`;
  let pasted = false;
  await loadBuffer(bufferName, value);
  try {
    // tmux waits until the paste has reached the pane before processing the
    // explicit Enter key. This avoids TUIs interpreting a combined PTY write as
    // pasted text followed by a literal newline.
    await tmux(["paste-buffer", "-p", "-r", "-d", "-b", bufferName, "-t", target]);
    pasted = true;
    await tmux(["send-keys", "-t", target, "Enter"]);
  } catch (error) {
    if (!pasted) await tmux(["delete-buffer", "-b", bufferName]).catch(() => {});
    throw error;
  }
}
