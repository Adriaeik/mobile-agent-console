export function markAlive(client) {
  client.isAlive = true;
}

export function heartbeatClients(clients) {
  for (const client of clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}
