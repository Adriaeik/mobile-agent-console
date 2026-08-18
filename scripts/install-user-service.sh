#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${HOME}/.config/mobile-agent-console"
INSTALL_LINK="${HOME}/.local/share/mobile-agent-console"

mkdir -p "${CONFIG_DIR}"
if [[ ! -f "${CONFIG_DIR}/env" ]]; then
  install -m 600 "${REPO_DIR}/.env.example" "${CONFIG_DIR}/env"
  echo "Created ${CONFIG_DIR}/env." >&2
  echo "Edit its three required settings, then run ./scripts/setup.sh again." >&2
  exit 1
fi
chmod 600 "${CONFIG_DIR}/env"

mkdir -p "$(dirname "${INSTALL_LINK}")"
if [[ -e "${INSTALL_LINK}" && ! -L "${INSTALL_LINK}" ]]; then
  echo "Refusing to replace existing path: ${INSTALL_LINK}" >&2
  exit 1
fi
ln -sfn "${REPO_DIR}" "${INSTALL_LINK}"

systemctl --user link "${REPO_DIR}/systemd/mobile-agent-console.service"
systemctl --user daemon-reload
systemctl --user enable mobile-agent-console.service
systemctl --user restart mobile-agent-console.service
systemctl --user --no-pager status mobile-agent-console.service
