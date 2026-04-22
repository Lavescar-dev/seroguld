#!/usr/bin/env bash
set -euo pipefail

USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_PATH="${USER_SYSTEMD_DIR}/gdpr-runner.service"
TIMER_PATH="${USER_SYSTEMD_DIR}/gdpr-runner.timer"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[gdpr-systemd-uninstall] systemctl bulunamadı." >&2
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "[gdpr-systemd-uninstall] systemctl --user erişilemiyor. User bus aktif değil." >&2
  exit 1
fi

systemctl --user disable --now gdpr-runner.timer >/dev/null 2>&1 || true
systemctl --user stop gdpr-runner.service >/dev/null 2>&1 || true

rm -f "${SERVICE_PATH}" "${TIMER_PATH}"

systemctl --user daemon-reload
systemctl --user reset-failed gdpr-runner.service gdpr-runner.timer >/dev/null 2>&1 || true

echo "[gdpr-systemd-uninstall] kaldırıldı:"
echo "  service=${SERVICE_PATH}"
echo "  timer=${TIMER_PATH}"
