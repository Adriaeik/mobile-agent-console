# Conversation view

## Goal

Add an optional, mobile-friendly conversation view for active Codex and Claude
Code tmux sessions. It shows only visible user and assistant text while hiding
reasoning, tool calls, tool results, command output, file changes, and other TUI
chrome. The existing terminal view remains the default and remains fully
interactive.

## Architecture

1. Add `src/conversation.js` as a provider-aware, read-only transcript adapter.
   It resolves the agent process from the validated tmux pane PID and binds it
   to exactly one active conversation:
   - Codex: walk Linux `/proc` descendants, discover held Codex thread lock
     file descriptors, and select the top-level `thread_source=user` thread
     matching the pane working directory.
   - Claude Code: walk descendants, read the matching
     `~/.claude/sessions/<pid>.json` metadata, validate its PID/CWD/session ID,
     and locate that session's exact transcript below `~/.claude/projects`.
2. Read only allowlisted message records:
   - Codex: query the read-only `thread_history_1.sqlite` projection for
     `userMessage` and `agentMessage` items only.
   - Claude Code: parse the bound JSONL transcript and accept only non-meta,
     non-sidechain user text and assistant `text` blocks.
   All unknown record and content types fail closed. Paths, raw records, tool
   payloads, and internal IDs are never returned to the browser.
3. Add an authenticated `GET /api/sessions/:id/conversation` endpoint. It
   validates that the tmux session still exists, returns a small normalized
   payload, and reports a clear unavailable state for shells, unsupported
   providers, stopped agents, or missing local history.
4. Add a **Conversation view** toggle to the existing terminal controls dialog.
   The new view occupies the terminal area, renders safe plain text with user
   and assistant styling, follows new messages when already near the bottom,
   and polls only while visible. The key row is hidden in conversation mode;
   the optional composer can remain available for sending a reply to the live
   terminal.
5. Keep the feature generic and opt-in. No credentials, private paths, tailnet
   names, transcript content, or provider-specific user data enter source
   control. Raw shells and custom providers continue to use terminal mode.

## Verification strategy

1. RED: add fixture-based unit tests that demonstrate tool/reasoning/file
   records currently cannot be converted to a safe conversation payload.
2. GREEN: implement the smallest adapters and resolver needed to pass them.
3. Add resolver tests with temporary `/proc`-like and transcript layouts,
   including ambiguous/mismatched sessions and fail-closed cases.
4. Add API and browser tests for toggling views, mobile scrolling, live refresh,
   composer coexistence, and returning to a usable terminal.
5. Verify against one real authenticated Codex session and one real Claude Code
   session without printing their content: assert visible role/message counts,
   absence of tool record types, scrolling, and terminal restoration.
6. Run `npm test`, `npm run check`, `npm audit --omit=dev`, and the relevant
   Playwright harness. Review the diff for secrets before opening the PR.

## Compatibility and risks

- This relies on local provider persistence formats. Parsing is deliberately
  isolated behind adapters and guarded by schema tests so a provider update
  disables the view instead of leaking internal records.
- Node's built-in read-only SQLite API is available in the project's supported
  Node 22+ range; production currently runs Node 24. No database writes are
  performed.
- Large Claude JSONL files need a bounded parser/cache so polling does not read
  the entire file repeatedly. The implementation will retain only normalized
  text messages and enforce response limits.
- Linux `/proc` is intentional because this application already targets Linux
  systemd/tmux hosts.

## Source basis

- OpenAI's CLI reference documents stable resume-by-session-ID behavior and
  identifies the app-server protocol as experimental; the adapter therefore
  reads the local, read-only projection instead of coupling the console to a
  second experimental app-server client.
- Anthropic's CLI reference documents `--session-id`, `--resume`, and `.jsonl`
  transcript paths. Its data-usage documentation confirms local plaintext
  transcripts under `~/.claude/projects/`.
- Local schema inspection on Codex CLI 0.160.0 and Claude Code 2.1.288 confirmed
  the exact allowlisted message types and active-process metadata used above.
