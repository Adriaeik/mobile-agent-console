# Implementation Plan: Mobile reliability and daily-use polish

## Overview

Finish the mobile console as a dependable daily interface while preserving its
core constraint: it remains a small Tailscale-protected wrapper around the live
tmux session. Work lands as independently testable vertical slices and is
merged only after unit, browser, and production smoke checks pass.

## Architecture decisions

- Keep the browser dependency-free. Render a conservative Markdown subset with
  DOM `textContent` rather than introducing an HTML sanitizer dependency.
- Detect dead WebSockets with the `ws` server's documented ping/pong pattern,
  then reconnect the browser with bounded exponential backoff.
- Keep unsent drafts in per-tab `sessionStorage`; clear them after a confirmed
  WebSocket send. Never put transcript or terminal output in browser storage.
- Add a web app manifest and a service worker for installability and mobile
  notifications, but no fetch handler or Cache Storage usage. The PWA therefore
  never caches authenticated pages, transcripts, terminal output, or API data.
- Request notification permission only from an explicit user gesture. Use
  `ServiceWorkerRegistration.showNotification()` because the app targets mobile.
- Derive portable agent status only from trusted normalized transcript state:
  `working` after a user message, `waiting` after an assistant response, and
  explicit disconnected/exited states from the terminal connection.
- Detect frontend/server incompatibility with a shared API protocol version and
  detect a restarted deployment with a per-process instance ID. A visible reload
  banner replaces raw JSON or missing-route failures.
- Keep pins and dashboard preferences local to the browser. They contain only
  tmux session names and UI preferences, never credentials or conversation text.

## Task list

### Phase 1: Reliability and installability

1. Add protocol and deployment compatibility checks.
2. Add WebSocket heartbeat, reconnect backoff, and resume triggers.
3. Preserve one bounded draft per open session across reconnect/reload.
4. Add a privacy-safe installable PWA shell and icons without offline caching.

### Checkpoint: reliability

- Full tests and checks pass.
- Browser test survives a forced socket termination and keeps its draft.
- Manifest is installable and Cache Storage stays empty.
- Merge and deploy the reliability PR.

### Phase 2: Status and notifications

5. Derive and expose normalized active-agent status.
6. Add opt-in notification controls and service-worker notification clicks.
7. Notify only on meaningful hidden-page transitions or terminal attention.

### Checkpoint: attention

- Permission is requested only from a click.
- No notification content includes transcript text, paths, or session names.
- Real Codex and Claude transitions are verified.
- Merge and deploy the status/notification PR.

### Phase 3: Conversation usability

8. Add safe Markdown structure and fenced code blocks.
9. Add copy controls, timestamps, search, and jump-to-latest.
10. Add an optimistic pending user message that reconciles with the transcript.

### Checkpoint: conversation

- Malicious-looking Markdown remains inert text.
- Search, copy, scroll retention, sending, and toggling pass mobile browser tests.
- Merge and deploy the conversation-polish PR.

### Phase 4: Session organization

11. Expose tmux last-activity metadata and stable provider categories.
12. Add tested search/filter/pin/recent ordering logic.
13. Add the compact dashboard controls and persisted non-sensitive preferences.

### Final checkpoint

- All repository tests, checks, audit, and browser harnesses pass.
- Production works through its Tailscale origin on a narrow mobile viewport.
- README, security notes, and decision records match shipped behavior.
- All feature PRs are merged, branches removed, and the service runs `main`.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Mobile suspends sockets without a close event | High | Server ping/pong plus online/visibility reconnect triggers |
| Service worker leaks authenticated content | High | No fetch event and no Cache Storage writes |
| Notifications become noisy or disclose data | High | Explicit opt-in, transition deduplication, generic text only |
| Provider schemas change | High | Continue allowlisted, fail-closed transcript parsing |
| Markdown introduces scriptable HTML | High | Parse a small subset and create nodes with `textContent` only |
| UI controls crowd narrow phones | Medium | 320 px automated layout smoke checks |
| Client/server files update at different times | Medium | Protocol check plus process-instance reload banner |

## Official source basis

- Web app manifests: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
- Service workers: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- Mobile notifications: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- Notification permission: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API
- Notification clicks: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event
- Per-tab drafts: https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
- Connectivity hints: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine
- `ws` heartbeat pattern: https://github.com/websockets/ws/blob/master/README.md#how-to-detect-and-close-broken-connections

## Open questions

None. The owner approved the complete feature set and asked that work continue
until every item is implemented.
