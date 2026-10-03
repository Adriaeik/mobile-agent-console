# ADR-0004: Organize sessions from bounded tmux metadata

## Status

Accepted

## Date

2026-10-03

## Context

A long-running workstation accumulates tmux sessions. Mobile users need recent
ordering, search, provider filters, and a few pinned sessions without creating a
new server-side database of projects or conversations.

## Decision

- Read creation and last-activity times from tmux session formats and command,
  path, dead state, and PID from window 0 pane 0.
- Classify only exact known executable names. `codex` and `claude` may be found
  in the bounded descendant process argument list because npm launchers can make
  tmux report `node`; recognized interactive shells use the pane command. All
  other commands remain **Other** rather than being guessed by substring.
- Search in memory across the returned session name, working directory, and
  current command. Sort pinned sessions first, then by last activity, with name
  as a deterministic tie-breaker.
- Persist only pinned tmux session names and the selected provider filter in
  browser `localStorage`. Do not persist search queries, paths, commands,
  terminal output, or conversation content.

## Consequences

- Classification describes the currently active pane process and can return to
  Shell or Other after an agent exits.
- Custom providers work normally but remain Other until an explicit generic
  provider-category mechanism is designed.
- Pins are device/browser preferences and do not synchronize through the server.
