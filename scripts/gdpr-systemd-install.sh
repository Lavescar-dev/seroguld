#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_SRC_DIR="${ROOT_DIR}/ops/systemd"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
SERVICE_PATH="${USER_SYSTEMD_DIR}/gdpr-runner.service"
TIMER_PATH="${USER_SYSTEMD_DIR}/gdpr-runner.timer"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[gdpr-systemd-install] systemctl bulunamadı." >&2
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "[gdpr-systemd-install] systemctl --user erişilemiyor. User bus aktif değil." >&2
  exit 1
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "[gdpr-systemd-install] python3 bulunamadı." >&2
  exit 1
fi

mkdir -p "${USER_SYSTEMD_DIR}"

sed \
  -e "s#{{ROOT_DIR}}#${ROOT_DIR}#g" \
  -e "s#{{PYTHON_BIN}}#${PYTHON_BIN}#g" \
  "${SYSTEMD_SRC_DIR}/gdpr-runner.service.in" > "${SERVICE_PATH}"

cp "${SYSTEMD_SRC_DIR}/gdpr-runner.timer" "${TIMER_PATH}"

systemctl --user daemon-reload
systemctl --user enable --now gdpr-runner.timer

echo "[gdpr-systemd-install] kuruldu:"
echo "  service=${SERVICE_PATH}"
echo "  timer=${TIMER_PATH}"
echo "[gdpr-systemd-install] durum için: make gdpr-systemd-status"
