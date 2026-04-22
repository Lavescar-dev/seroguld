#!/usr/bin/env bash
set -euo pipefail

TIMER_NAME="gdpr-runner.timer"
SERVICE_NAME="gdpr-runner.service"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[gdpr-systemd-status] systemctl bulunamadı." >&2
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "[gdpr-systemd-status] systemctl --user erişilemiyor. User bus aktif değil." >&2
  exit 1
fi

read_prop() {
  local unit="$1"
  local prop="$2"
  systemctl --user show "${unit}" -p "${prop}" --value 2>/dev/null || true
}

unit_state() {
  local verb="$1"
  local unit="$2"
  local value
  value="$(systemctl --user "${verb}" "${unit}" 2>/dev/null || true)"
  if [[ -z "${value}" ]]; then
    printf '—'
  else
    printf '%s' "${value}"
  fi
}

show_value() {
  local value="$1"
  if [[ -z "${value}" || "${value}" == "n/a" || "${value}" == "0" ]]; then
    printf '—'
  else
    printf '%s' "${value}"
  fi
}

timer_load="$(read_prop "${TIMER_NAME}" LoadState)"
service_load="$(read_prop "${SERVICE_NAME}" LoadState)"
timer_enabled="$(unit_state is-enabled "${TIMER_NAME}")"
timer_active="$(unit_state is-active "${TIMER_NAME}")"
service_active="$(unit_state is-active "${SERVICE_NAME}")"
service_result="$(read_prop "${SERVICE_NAME}" Result)"
service_exit_status="$(read_prop "${SERVICE_NAME}" ExecMainStatus)"

if [[ "${service_load}" == "not-found" ]]; then
  service_result=""
  service_exit_status=""
fi

echo "[gdpr-systemd-status]"
echo "  timer_load=$(show_value "${timer_load}")"
echo "  timer_enabled=$(show_value "${timer_enabled}")"
echo "  timer_active=$(show_value "${timer_active}")"
echo "  next_run=$(show_value "$(read_prop "${TIMER_NAME}" NextElapseUSecRealtime)")"
echo "  last_trigger=$(show_value "$(read_prop "${TIMER_NAME}" LastTriggerUSec)")"
echo "  service_load=$(show_value "${service_load}")"
echo "  service_active=$(show_value "${service_active}")"
echo "  service_result=$(show_value "${service_result}")"
echo "  service_exit_status=$(show_value "${service_exit_status}")"
