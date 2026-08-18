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
- Never commit the runtime environment file or provider credentials.

The server refuses to start in production with local authentication or a
non-loopback listener. Tailscale identity headers are trusted only because the
backend is loopback-only and Tailscale Serve is the sole ingress.
