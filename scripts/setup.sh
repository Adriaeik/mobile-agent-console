#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${HOME}/.config/mobile-agent-console"
CONFIG_FILE="${AGENT_CONSOLE_ENV_FILE:-${CONFIG_DIR}/env}"

for command in node npm tmux tailscale systemctl; do
  if ! command -v "${command}" >/dev/null; then
    echo "Missing required command: ${command}" >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

mkdir -p "${CONFIG_DIR}"
if [[ ! -f "${CONFIG_FILE}" ]]; then
  install -m 600 "${REPO_DIR}/.env.example" "${CONFIG_FILE}"
  echo "Created ${CONFIG_FILE}."
  echo "Edit ALLOWED_TAILSCALE_USERS, PUBLIC_ORIGIN, and ALLOWED_ROOTS, then run this script again."
  exit 1
fi
chmod 600 "${CONFIG_FILE}"

node --env-file="${CONFIG_FILE}" "${REPO_DIR}/scripts/validate-config.mjs"
npm --prefix "${REPO_DIR}" ci
"${REPO_DIR}/scripts/install-user-service.sh"
AGENT_CONSOLE_ENV_FILE="${CONFIG_FILE}" "${REPO_DIR}/scripts/deploy-tailscale.sh"

echo
echo "Mobile Agent Console is installed."
node --env-file="${CONFIG_FILE}" --input-type=module -e 'console.log(process.env.PUBLIC_ORIGIN)'
