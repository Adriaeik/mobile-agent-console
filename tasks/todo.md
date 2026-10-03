# Mobile reliability and daily-use polish

## Task 1: Protocol compatibility

**Acceptance criteria:**
- [x] Browser rejects an incompatible API with a useful reload/restart message.
- [x] A server process change produces a non-blocking update banner.

**Verification:** focused protocol tests, browser mismatch test, full test suite.

**Dependencies:** None
**Files likely touched:** `src/server.js`, `src/version.js`, `public/app.js`, `public/version.js`, protocol tests
**Estimated scope:** Medium

## Task 2: Resilient terminal reconnect

**Acceptance criteria:**
- [x] Dead sockets reconnect with bounded exponential backoff.
- [x] Manual close never reconnects; online/visible events retry immediately.
- [x] Server heartbeat terminates unresponsive clients.

**Verification:** focused reconnect/heartbeat tests and forced-disconnect browser test.

**Dependencies:** Task 1
**Files likely touched:** `public/reconnect.js`, `public/app.js`, `src/server.js`, reconnect tests
**Estimated scope:** Medium

## Task 3: Draft preservation

**Acceptance criteria:**
- [x] Each active session restores at most 8,000 characters from `sessionStorage`.
- [x] Successful send clears the draft; disconnect leaves it intact.

**Verification:** focused storage tests and browser reload/reconnect test.

**Dependencies:** Task 2
**Files likely touched:** `public/drafts.js`, `public/app.js`, draft tests
**Estimated scope:** Small

## Task 4: Privacy-safe PWA

**Acceptance criteria:**
- [x] Manifest supplies standalone display, theme, name, and maskable icons.
- [x] Service worker registers but has no fetch handler or content cache.

**Verification:** manifest/static tests, browser service-worker inspection, empty Cache Storage.

**Dependencies:** Task 1
**Files likely touched:** `public/index.html`, `public/app.webmanifest`, `public/service-worker.js`, icons, PWA tests
**Estimated scope:** Medium

## Checkpoint: reliability PR

- [x] Tasks 1–4 pass all tests and browser verification.
- [x] PR merged, branch removed, production restarted and healthy.

## Task 5: Agent status

**Acceptance criteria:**
- [x] Active Codex/Claude sessions show Working or Waiting for input.
- [x] Disconnected and exited states take precedence.

**Verification:** status derivation tests and real-provider browser checks.

**Dependencies:** Task 2
**Files likely touched:** `src/conversation.js`, `public/agent-status.js`, `public/app.js`, status tests
**Estimated scope:** Medium

## Task 6: Opt-in notifications

**Acceptance criteria:**
- [x] Permission is requested only by the notification toggle click.
- [x] Hidden-page ready/attention transitions use generic service-worker notifications.
- [x] Clicking a notification focuses or opens the console.

**Verification:** notification decision tests and browser API instrumentation.

**Dependencies:** Tasks 4–5
**Files likely touched:** `public/notifications.js`, `public/service-worker.js`, `public/app.js`, `public/index.html`, notification tests
**Estimated scope:** Medium

## Task 7: Terminal attention

**Acceptance criteria:**
- [x] Terminal bell produces a deduplicated attention event.
- [x] No terminal contents are copied into notification text.

**Verification:** WebSocket event tests and browser notification instrumentation.

**Dependencies:** Task 6
**Files likely touched:** `src/server.js`, `public/app.js`, terminal-attention tests
**Estimated scope:** Small

## Checkpoint: status PR

- [x] Tasks 5–7 pass all tests and real-provider verification.
- [x] PR merged, branch removed, production healthy.

## Task 8: Safe Markdown

**Acceptance criteria:**
- [x] Paragraphs, headings, lists, inline code, and fenced code render readably.
- [x] HTML/script-like input remains inert text.

**Verification:** parser/renderer tests with hostile fixtures.

**Dependencies:** None
**Files likely touched:** `public/safe-markdown.js`, `public/app.js`, Markdown tests
**Estimated scope:** Medium

## Task 9: Conversation navigation

**Acceptance criteria:**
- [x] Copy, timestamps, search, and jump-to-latest work without losing scroll position.
- [x] Controls remain usable at 320 px.

**Verification:** focused UI tests and mobile browser interactions.

**Dependencies:** Task 8
**Files likely touched:** `public/index.html`, `public/styles.css`, `public/app.js`, conversation tests
**Estimated scope:** Medium

## Task 10: Optimistic sending

**Acceptance criteria:**
- [x] Sent text appears immediately as pending.
- [x] Transcript reconciliation removes the pending state without duplication.

**Verification:** state tests and real Codex/Claude send/reply checks.

**Dependencies:** Task 9
**Files likely touched:** `public/conversation-view.js`, `public/app.js`, optimistic-state tests
**Estimated scope:** Small

## Checkpoint: conversation PR

- [x] Tasks 8–10 pass all tests and real-provider verification.
- [x] PR merged, branch removed, production healthy.

## Task 11: Session metadata

**Acceptance criteria:**
- [x] Session API includes last activity and a stable provider category.
- [x] Unknown commands remain generic rather than guessed.

**Verification:** tmux parsing tests.

**Dependencies:** None
**Files likely touched:** `src/tmux.js`, tmux tests
**Estimated scope:** Small

## Task 12: Organization logic

**Acceptance criteria:**
- [x] Search covers name, path, and command.
- [x] Provider filter and pinned-first recent ordering are deterministic.

**Verification:** pure organization tests.

**Dependencies:** Task 11
**Files likely touched:** `public/sessions.js`, session tests
**Estimated scope:** Small

## Task 13: Dashboard organization UI

**Acceptance criteria:**
- [x] Compact search/filter/pin controls work on mobile.
- [x] Pins and UI preferences persist without storing conversation content.

**Verification:** mobile browser dashboard flow and storage inspection.

**Dependencies:** Task 12
**Files likely touched:** `public/index.html`, `public/styles.css`, `public/app.js`, dashboard tests
**Estimated scope:** Medium

## Final checkpoint

- [ ] Tasks 1–13 complete.
- [ ] Full tests, check, audit, shell E2E, and real-agent E2E pass.
- [ ] Documentation and security notes are current.
- [ ] All PRs merged and production runs clean `main`.
