# ADR-0003: Derive status from visible turns and keep notifications generic

## Status

Accepted

## Date

2026-10-03

## Context

A phone user needs to know when an active agent has finished and may need input.
Provider internals and terminal output are not a stable or safe notification
format: either can contain private code, commands, paths, or credentials.

## Decision

- Derive a small status vocabulary from the already allowlisted conversation:
  a final user turn means **Working**, and a final assistant turn means
  **Waiting for input**. Disconnected and exited transport states take
  precedence. Unknown providers remain **Connected** rather than being guessed.
- Treat an ASCII terminal bell as a separate **Needs attention** signal and
  deduplicate bells at the server. Send only an event type over the socket,
  never the surrounding terminal output.
- Keep operating-system notifications disabled until the user presses the
  Notifications control and the browser grants permission. Notify only while
  the page is hidden and only on a working-to-waiting transition or a new bell.
- Use fixed generic notification text. Notification clicks focus an existing
  console window or open the authenticated root page.

## Consequences

- The status is intentionally approximate and describes visible conversational
  turns, not provider implementation details.
- A provider that does not expose a recognized active transcript still works as
  a terminal, but does not claim Working or Waiting status.
- No transcript text, terminal output, session name, or path reaches the system
  notification surface.

## References

- [MDN: Using the Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)
- [MDN: ServiceWorkerRegistration.showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification)
- [MDN: notificationclick](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event)
