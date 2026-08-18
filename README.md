# Mobile Agent Console

A small, self-hosted mobile UI for Codex, Claude Code, shells, and other
terminal agents running in tmux.

![Mobile dashboard showing two tmux sessions](docs/mobile-dashboard.png)

## Why

Start an agent at your desk, then safely reconnect from your phone to answer an
approval prompt, check a deploy, or continue the full terminal session. The
agent keeps running in tmux when the browser disconnects.

The console can:

- list, open, create, and stop named tmux sessions;
- launch an agent in a selected project with a model and permission profile;
- stream the real terminal UI through xterm.js and WebSockets; and
- send text, Escape, Ctrl-C, Tab, arrows, Enter, and terminal resize events.

> [!CAUTION]
> This is interactive shell access as the Unix user running the service. Use
> Tailscale Serve, never Funnel or a public reverse proxy. Read
> [SECURITY.md](SECURITY.md) before deploying.

## Requirements

- Linux with systemd user services
- Node.js 22+, tmux, and Tailscale with tailnet HTTPS enabled
- Codex, Claude Code, or another terminal agent

Optional built-in agents can be installed with:

```bash
npm install --global @openai/codex @anthropic-ai/claude-code
```

Authenticate each agent using its own official CLI. Credentials remain outside
this repository.

## Install

```bash
git clone https://github.com/Adriaeik/mobile-agent-console.git
cd mobile-agent-console
mkdir -p ~/.config/mobile-agent-console
cp .env.example ~/.config/mobile-agent-console/env
chmod 600 ~/.config/mobile-agent-console/env
${EDITOR:-nano} ~/.config/mobile-agent-console/env
```

Change these three settings:

- `ALLOWED_TAILSCALE_USERS`: exact Tailscale login, or a comma-separated list;
- `PUBLIC_ORIGIN`: this machine's tailnet URL, including its HTTPS port; and
- `ALLOWED_ROOTS`: project directories the console may access, separated by
  colons.

Then run:

```bash
./scripts/setup.sh
```

The script validates the config, installs locked dependencies and a systemd
user service, then adds a dedicated Tailscale Serve listener. Port 8443 is the
default; an existing listener is never overwritten.

If the service must survive logout, enable lingering once:

```bash
sudo loginctl enable-linger "$USER"
```

Configuration stays in `~/.config/mobile-agent-console/env`, outside Git. See
[.env.example](.env.example) for optional ports, tmux socket isolation, and
custom provider configuration. A provider example lives in
[config/providers.example.json](config/providers.example.json).

## Security defaults

- loopback-only backend behind Tailscale Serve;
- explicit Tailscale identity allowlist and exact browser-origin checks;
- canonical project paths restricted to `ALLOWED_ROOTS`;
- validated session, provider, model, and permission values; and
- separate confirmation for raw-shell and sandbox-bypass modes.

Production refuses local authentication and non-loopback listeners.

## Development

```bash
npm ci
npm run dev
# open http://127.0.0.1:3210
```

```bash
npm test
npm run check
npm audit --omit=dev
```

Useful production checks:

```bash
systemctl --user status mobile-agent-console
journalctl --user -u mobile-agent-console -f
tailscale serve status
```

## License and references

[MIT](LICENSE) · [Codex commands](https://developers.openai.com/codex/cli/reference)
· [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
· [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
