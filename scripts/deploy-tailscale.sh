#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="${AGENT_CONSOLE_ENV_FILE:-${HOME}/.config/mobile-agent-console/env}"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing configuration: ${CONFIG_FILE}" >&2
  exit 1
fi

read_setting() {
  node --env-file="${CONFIG_FILE}" --input-type=module -e "process.stdout.write(process.env[process.argv[1]] || '')" "$1"
}

HTTPS_PORT="${HTTPS_PORT:-$(read_setting TAILSCALE_HTTPS_PORT)}"
LOCAL_PORT="${PORT:-$(read_setting PORT)}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
LOCAL_PORT="${LOCAL_PORT:-3210}"
EXPECTED_PROXY="http://127.0.0.1:${LOCAL_PORT}"
PUBLIC_ORIGIN="$(read_setting PUBLIC_ORIGIN)"

if ! [[ "${HTTPS_PORT}" =~ ^[0-9]+$ ]] || (( HTTPS_PORT < 1 || HTTPS_PORT > 65535 )); then
  echo "HTTPS_PORT must be a valid TCP port." >&2
  exit 1
fi

TAILSCALE_STATUS="$(tailscale status --json 2>/dev/null || true)"
BACKEND_STATE="$(node --input-type=module -e '
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try { process.stdout.write(JSON.parse(Buffer.concat(chunks)).BackendState || ""); } catch {}
' <<<"${TAILSCALE_STATUS}")"
if [[ "${BACKEND_STATE}" != "Running" ]]; then
  echo "Tailscale is not connected. Run 'sudo tailscale up' first." >&2
  exit 1
fi

TAILSCALE_DNS="$(node --input-type=module -e '
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const dns = JSON.parse(Buffer.concat(chunks)).Self?.DNSName || "";
  process.stdout.write(dns.replace(/\.$/, ""));
' <<<"${TAILSCALE_STATUS}")"
ORIGIN_HOST="$(node --input-type=module -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "${PUBLIC_ORIGIN}")"
if [[ -z "${TAILSCALE_DNS}" || "${ORIGIN_HOST}" != "${TAILSCALE_DNS}" ]]; then
  echo "PUBLIC_ORIGIN host (${ORIGIN_HOST}) does not match this machine (${TAILSCALE_DNS:-unknown})." >&2
  exit 1
fi

STATUS_JSON="$(tailscale serve status --json 2>/dev/null || printf '{}')"
# The single quotes deliberately protect JavaScript template expressions from Bash.
# shellcheck disable=SC2016
CONFLICT="$(node --input-type=module -e '
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  const port = process.argv[1];
  const expected = process.argv[2];
  const entries = Object.entries(data.Web || {}).filter(([host]) => host.endsWith(`:${port}`));
  for (const [host, config] of entries) {
    const root = config.Handlers?.["/"];
    if (!root || root.Proxy !== expected) process.stdout.write(`${host} is already configured`);
  }
  if (data.TCP?.[port] && entries.length === 0) process.stdout.write(`port ${port} is already configured`);
' "${HTTPS_PORT}" "${EXPECTED_PROXY}" <<<"${STATUS_JSON}")"

if [[ -n "${CONFLICT}" ]]; then
  echo "Refusing to replace an existing Tailscale Serve listener: ${CONFLICT}" >&2
  echo "Choose another TAILSCALE_HTTPS_PORT in ${CONFIG_FILE}." >&2
  exit 1
fi

echo "Existing Tailscale Serve configuration:"
tailscale serve status || true
echo
echo "Adding Agent Console on dedicated HTTPS port ${HTTPS_PORT}; existing listeners are retained."
tailscale serve --bg --https="${HTTPS_PORT}" "${EXPECTED_PROXY}"
tailscale serve status
