# ADR-0001: Use provider transcripts for Conversation view

## Status

Accepted

## Date

2026-10-03

## Context

Codex and Claude Code now own scrolling inside fullscreen TUIs. A terminal
screen is therefore only a rendered viewport: it does not reliably contain the
whole conversation and provides no semantic boundary between chat text,
reasoning, tool calls, command output, and diffs.

The console needs a filtered, mobile-readable view without replacing the live
tmux terminal or weakening its Tailscale authentication boundary. It must also
avoid selecting another concurrently running agent's history.

## Decision

Bind window 0, pane 0 to its descendant process tree and resolve exactly one
active provider session:

- Codex threads are identified from held thread-lock file descriptors. Only a
  single top-level user thread whose working directory matches the pane is
  accepted. Its local history projection is opened read-only and queried only
  for `userMessage` and `agentMessage` rows.
- Claude sessions are identified from PID metadata whose PID and working
  directory match the pane. Only the transcript with that exact session UUID is
  read, and only visible user text and assistant `text` blocks are accepted.

Normalize those records on the server and expose them through the authenticated
`GET /api/sessions/:id/conversation` endpoint. Unknown and ambiguous states fail
closed. Responses contain no transcript paths, provider session IDs, raw
records, or tool payloads and are bounded by message and byte limits.

The browser renders plain text with DOM `textContent`, polls only while the
optional view is open, and preserves an older reading position. The original
xterm/WebSocket connection remains alive so switching back restores the same
interactive terminal. Conversation input uses that same authenticated socket.
The server writes message text and Enter to the PTY as separate ordered events;
current agent TUIs can otherwise interpret a combined text-and-Enter write as a
paste and leave it unsubmitted in their editor.

## Alternatives considered

### Filter terminal escape sequences

Rejected because the alternate-screen viewport lacks complete history and has
no reliable message/tool semantics.

### Put tmux into copy mode

Rejected because modern Codex and Claude TUIs keep history inside the
application. Copy mode sees only the terminal viewport and can leave the TUI in
an awkward input state.

### Run a second Codex app-server client

Rejected for this thin wrapper because the app-server protocol is documented as
experimental and would still require binding its thread to the existing tmux
client. The local projection already used by that client provides the needed
read-only message boundary.

### Replace interactive CLIs with non-interactive JSON streaming

Rejected because it would stop being a wrapper around the exact long-running
tmux session and would require reimplementing approvals, queued input, and TUI
behavior.

## Consequences

- Conversation view is supported only for recognized active Codex and Claude
  sessions; raw shells and custom providers keep terminal mode.
- Messages entered in Conversation view still go to the live TUI rather than
  modifying provider transcript storage directly.
- Provider persistence schemas may change. All parsing is isolated, allowlisted,
  schema-tested, and designed to become unavailable rather than return unknown
  record types.
- The service can read local plaintext agent history because it already runs as
  that Unix user. Tailnet identity and origin restrictions therefore remain
  essential.
- Linux `/proc` is part of the binding mechanism, consistent with the project's
  Linux/systemd scope.

## References

- [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
  documents session resume identifiers and marks app-server as experimental.
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
  documents session UUIDs, resume behavior, and JSONL transcript paths.
- [Claude Code data usage](https://code.claude.com/docs/en/data-usage)
  documents plaintext local transcripts under `~/.claude/projects/`.
- [Node.js 22 SQLite API](https://nodejs.org/docs/latest-v22.x/api/sqlite.html#new-databasesyncpath-options)
  documents `DatabaseSync` read-only mode and prepared statements. Node 22.13
  is the minimum because it made `node:sqlite` available without a runtime flag.
