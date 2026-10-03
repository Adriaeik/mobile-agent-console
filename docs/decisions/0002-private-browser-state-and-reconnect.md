# ADR-0002: Keep browser reliability state local and content uncached

## Status

Accepted

## Date

2026-10-03

## Context

Mobile networks routinely suspend tabs and change connectivity. The console
must recover without losing a composed message, but terminal output and agent
transcripts can contain source code, credentials, or operational data. An
installable web app must not turn those responses into a second persistent
history store.

Browser and server files can also be deployed at different moments. An old app
must not silently continue against an incompatible API.

## Decision

- Give the HTTP API an integer protocol version and each server process a random
  instance ID. The browser rejects mismatched protocols and shows a reload
  banner when the process changes.
- Reconnect active terminal sockets with bounded exponential backoff. Online and
  visible-page events retry immediately. Explicitly leaving a session disables
  retries. Server WebSockets use ping/pong heartbeats to retire dead clients.
- Store one bounded composer draft per tmux session in `sessionStorage`. Clear it
  only after the browser successfully writes the message to an open socket.
- Provide a manifest and install/activate-only service worker. The worker has no
  fetch handler and uses no Cache Storage, so authenticated application,
  terminal, and transcript responses retain their normal online-only behavior.

## Consequences

- A tab reload and transient disconnect preserve an unsent message; closing the
  tab clears that tab's storage according to browser session-storage behavior.
- The installed app requires network access to the private deployment and does
  not offer an offline transcript.
- Replacing the server produces a short reconnect and a visible reload prompt,
  while a genuinely incompatible frontend stops rather than guessing.
- Drafts are browser-side sensitive data even though they are tab-scoped and
  bounded. Shared-device users should close the tab after use.

## References

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN: Using service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
- [MDN: sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)
- [ws: detecting broken connections](https://github.com/websockets/ws/blob/master/README.md#how-to-detect-and-close-broken-connections)
