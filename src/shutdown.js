export function closeRuntime({ heartbeatTimer, sockets, terminals, server }, clearTimer = clearInterval, onClose) {
  clearTimer(heartbeatTimer);
  for (const socket of sockets.clients) {
    try { socket.close(1001, "Server restarting"); } catch { socket.terminate?.(); }
  }
  for (const terminal of terminals) {
    try { terminal.kill(); } catch { /* already exited */ }
  }
  sockets.close();
  server.close(onClose);
}
