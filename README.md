# Mobile Agent Console

A thin, self-hosted, mobile-first wrapper around terminal coding agents running
in tmux. It keeps the real terminal UI intact instead of reimplementing Codex,
Claude Code, or a shell as a chat protocol.

> [!CAUTION]
> This application is equivalent to interactive shell access as the Unix user
> running it. Deploy it only behind Tailscale Serve and treat it like SSH.

## Features

- Lists tmux sessions as mobile-friendly chats.
- Attaches a real PTY to window `0`, pane `0` of the selected session.
- Streams the complete terminal through xterm.js over a WebSocket.
- Starts Codex, Claude Code, a raw shell, or a configured third-party agent.
- Selects a working directory, model, and permission profile per session.
- Includes mobile controls for Escape, Ctrl-C, Tab, arrows, Enter, resize, and
  multi-line paste.
- Leaves processes running in tmux when the browser disconnects.

## Requirements

- Linux with systemd user services
- Node.js 22 or newer
- tmux and Tailscale, with HTTPS enabled for the tailnet
- At least one terminal agent such as Codex or Claude Code

Install optional built-in providers using their official packages:

```bash
npm install --global @openai/codex @anthropic-ai/claude-code
```

Provider authentication stays outside this repository. Run each provider once
in a local terminal to complete its official interactive login.

## Install

Clone the repository, create the local configuration, and edit three values:

```bash
git clone https://github.com/Adriaeik/mobile-agent-console.git
cd mobile-agent-console
mkdir -p ~/.config/mobile-agent-console
cp .env.example ~/.config/mobile-agent-console/env
chmod 600 ~/.config/mobile-agent-console/env
${EDITOR:-nano} ~/.config/mobile-agent-console/env
```

Set:

- `ALLOWED_TAILSCALE_USERS` to the exact login shown by Tailscale, with commas
  between multiple users.
- `PUBLIC_ORIGIN` to this machine's Tailscale HTTPS URL. Include the port when
  it is not 443, for example `https://host.tailnet-name.ts.net:8443`.
- `ALLOWED_ROOTS` to one or more absolute directories, separated by colons.

`TAILSCALE_HTTPS_PORT` defaults to `8443` to avoid taking over the common HTTPS
listener on port 443. Choose another unused port when needed.

Then run the idempotent setup:

```bash
./scripts/setup.sh
```

The setup validates the configuration, installs exact npm dependencies, links
the clone into `~/.local/share/mobile-agent-console`, installs a systemd user
service, and adds one dedicated Tailscale Serve listener. It inspects the
existing Serve configuration and refuses to replace a listener owned by
another service.

To keep the user service running without an interactive login, enable systemd
linger once if it is not already enabled:

```bash
sudo loginctl enable-linger "$USER"
```

No Tailscale auth key, provider token, or application secret belongs in the
repository.

## Configuration

Runtime configuration lives at `~/.config/mobile-agent-console/env`, outside
the clone and Git history. `.env.example` documents every supported setting.

| Variable | Purpose | Default |
| --- | --- | --- |
| `ALLOWED_TAILSCALE_USERS` | Required identity allowlist | none |
| `PUBLIC_ORIGIN` | Required exact browser origin | none |
| `ALLOWED_ROOTS` | Directories available to new sessions | `~/projects` |
| `TAILSCALE_HTTPS_PORT` | Dedicated Tailscale Serve port | `8443` |
| `PORT` | Local application port | `3210` |
| `HOST` | Local bind address; must be loopback | `127.0.0.1` |
| `TMUX_SOCKET_NAME` | Optional isolated tmux socket | default socket |
| `AGENT_CONSOLE_PROVIDERS_FILE` | Optional custom provider JSON | none |

For custom agents, copy `config/providers.example.json` outside the repository
and point `AGENT_CONSOLE_PROVIDERS_FILE` at it. Provider commands and argument
templates are trusted administrator configuration. Browser values are passed
as argument arrays, never evaluated as shell fragments; `{model}` is the only
template placeholder.

## Security model

- The backend is hard-limited to a loopback listener.
- Tailscale requests require the `Tailscale-User-Login` identity header and an
  explicit allowlist match.
- Mutating HTTP requests and WebSocket upgrades validate `PUBLIC_ORIGIN`.
- Paths are canonicalized and restricted to `ALLOWED_ROOTS`.
- Session names, model values, provider ids, and permission ids are validated.
- Dangerous provider modes require confirmation in both the UI and API.
- Production refuses `AUTH_MODE=local`; local development requires an explicit
  `ALLOW_LOCAL_AUTH=true` opt-in.

Tailscale identity headers are trustworthy only when the backend listens on
localhost and all access passes through Tailscale Serve. Never use Funnel, a
public reverse proxy, or a network bind address. See [SECURITY.md](SECURITY.md)
before deploying.

## Permission profiles

Codex includes read-only, workspace-with-approval, workspace-autonomous,
full-host, and explicit sandbox-bypass profiles. Claude Code includes plan,
default, accept-edits, and permission-bypass profiles. Raw shell access is
always marked dangerous.

The wrapper selects startup flags only. Once attached, keyboard commands,
slash commands, approvals, pickers, and full-screen interactions belong to the
underlying agent TUI. Codex flags follow the current [official OpenAI command
reference](https://developers.openai.com/codex/cli/reference).

## Development

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:3210`. Development mode accepts only loopback requests,
requires an explicit opt-in, and cannot run with `NODE_ENV=production`.

```bash
npm test
npm run check
npm audit --omit=dev
```

## Operations

```bash
systemctl --user status mobile-agent-console
journalctl --user -u mobile-agent-console -f
tailscale serve status
```

Rerun `./scripts/setup.sh` after updating the clone. Existing tmux sessions and
unrelated Tailscale Serve listeners are left intact.

## License

[MIT](LICENSE)

## Upstream documentation

- [OpenAI Codex commands](https://developers.openai.com/codex/cli/reference)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Tailscale Serve and identity headers](https://tailscale.com/docs/features/tailscale-serve)
