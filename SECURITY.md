# Security policy

Mobile Agent Console provides interactive shell access as the Unix user that
runs it. A deployment mistake can expose the host.

## Supported versions

Only the latest release on the default branch receives security fixes.

## Reporting a vulnerability

If private vulnerability reporting is enabled, use the repository's
**Security** tab. Otherwise, open a minimal issue asking the maintainer for a
private contact channel without including vulnerability details. Do not
publish an unpatched vulnerability in an issue.

## Deployment invariants

- Keep `HOST` on a loopback address.
- Use Tailscale Serve, never Tailscale Funnel or a public reverse proxy.
- Configure an explicit `ALLOWED_TAILSCALE_USERS` allowlist.
- Restrict `ALLOWED_ROOTS` to directories the console genuinely needs.
- Treat raw shell, full-host, and sandbox-bypass profiles as administrative
  access to the machine.
- Treat Conversation view as access to local Codex and Claude transcripts. Its
  endpoint returns only user and assistant text, but that text can still contain
  sensitive project or operational information.
- Never commit the runtime environment file or provider credentials.
- The optional installable app registers a service worker, but deliberately has
  no fetch handler or content cache. Do not add offline transcript or terminal
  caching without a separate security review.
- Unsent composer drafts live only in per-tab `sessionStorage`, are bounded to
  8,000 characters, and are removed after a successful socket send. A draft can
  still contain sensitive text, so close the tab to discard its tab-scoped data.

The server refuses to start in production with local authentication or a
non-loopback listener. Tailscale identity headers are trusted only because the
backend is loopback-only and Tailscale Serve is the sole ingress.

Conversation view binds a validated tmux pane to the active provider process
before reading history. Codex databases are opened read-only; Claude transcript
records are accepted only from the exact active session ID. Unknown, ambiguous,
meta, sidechain, reasoning, tool, command, and file-change records fail closed.
