#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RCLONE_BIN="${RCLONE_BIN:-}"
if [[ -z "${RCLONE_BIN}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    RCLONE_BIN="$(command -v rclone)"
  elif [[ -x "${ROOT_DIR}/tools/rclone/rclone" ]]; then
    RCLONE_BIN="${ROOT_DIR}/tools/rclone/rclone"
  else
    echo "[simply-offsite] rclone bulunamadı. Önce 'make backup-rclone-setup' çalıştırın." >&2
    exit 1
  fi
fi

SIMPLY_SFTP_HOST="${SIMPLY_SFTP_HOST:-linux185.unoeuro.com}"
SIMPLY_SFTP_PORT="${SIMPLY_SFTP_PORT:-22}"
SIMPLY_SFTP_USER="${SIMPLY_SFTP_USER:-}"
SIMPLY_SFTP_PASSWORD="${SIMPLY_SFTP_PASSWORD:-}"
SIMPLY_SFTP_KEY_FILE="${SIMPLY_SFTP_KEY_FILE:-}"
SIMPLY_SFTP_KEY_USE_AGENT="${SIMPLY_SFTP_KEY_USE_AGENT:-false}"
SIMPLY_SFTP_REMOTE="${SIMPLY_SFTP_REMOTE:-simply-sftp}"
SIMPLY_CRYPT_REMOTE="${SIMPLY_CRYPT_REMOTE:-simply-crypt}"
SIMPLY_REMOTE_PATH="${SIMPLY_REMOTE_PATH:-seroguld-crm-backups}"
SIMPLY_CRYPT_PASSWORD="${SIMPLY_CRYPT_PASSWORD:-}"
SIMPLY_CRYPT_SALT="${SIMPLY_CRYPT_SALT:-}"
SIMPLY_OFFSITE_DRY_RUN="${SIMPLY_OFFSITE_DRY_RUN:-false}"

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "[simply-offsite] ${name} boş." >&2
    exit 1
  fi
}

prompt_secret_if_needed() {
  local var_name="$1"
  local prompt="$2"
  local current_value="$3"

  if [[ -n "${current_value}" || "${SIMPLY_OFFSITE_DRY_RUN}" == "true" ]]; then
    printf '%s' "${current_value}"
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "[simply-offsite] ${var_name} env olarak verilmedi ve terminal interaktif değil." >&2
    exit 1
  fi

  local entered=""
  read -r -s -p "${prompt}: " entered
  echo >&2
  printf '%s' "${entered}"
}

remote_exists() {
  local name="$1"
  "${RCLONE_BIN}" listremotes | grep -Fxq "${name}:"
}

run_or_print() {
  if [[ "${SIMPLY_OFFSITE_DRY_RUN}" == "true" ]]; then
    printf '[simply-offsite] dry-run:'
    for arg in "$@"; do
      case "${arg}" in
        "${SIMPLY_SFTP_PASSWORD}"|"${SIMPLY_CRYPT_PASSWORD}"|"${SIMPLY_CRYPT_SALT}")
          printf ' ****'
          ;;
        *)
          printf ' %q' "${arg}"
          ;;
      esac
    done
    printf '\n'
    return 0
  fi

  "$@"
}

require_value "SIMPLY_SFTP_USER" "${SIMPLY_SFTP_USER}"
if [[ -z "${SIMPLY_SFTP_KEY_FILE}" && "${SIMPLY_SFTP_KEY_USE_AGENT}" != "true" ]]; then
  echo "[simply-offsite] SIMPLY_SFTP_KEY_FILE verin veya SIMPLY_SFTP_KEY_USE_AGENT=true kullanın." >&2
  exit 1
fi

SIMPLY_SFTP_PASSWORD="$(prompt_secret_if_needed SIMPLY_SFTP_PASSWORD "Simply SFTP password" "${SIMPLY_SFTP_PASSWORD}")"
SIMPLY_CRYPT_PASSWORD="$(prompt_secret_if_needed SIMPLY_CRYPT_PASSWORD "rclone crypt password" "${SIMPLY_CRYPT_PASSWORD}")"
SIMPLY_CRYPT_SALT="$(prompt_secret_if_needed SIMPLY_CRYPT_SALT "rclone crypt salt/password2" "${SIMPLY_CRYPT_SALT}")"

if [[ "${SIMPLY_OFFSITE_DRY_RUN}" != "true" ]]; then
  require_value "SIMPLY_CRYPT_PASSWORD" "${SIMPLY_CRYPT_PASSWORD}"
fi

sftp_args=(
  "${SIMPLY_SFTP_REMOTE}"
  sftp
  host "${SIMPLY_SFTP_HOST}"
  user "${SIMPLY_SFTP_USER}"
  port "${SIMPLY_SFTP_PORT}"
  shell_type unix
  disable_hashcheck true
)

if [[ -n "${SIMPLY_SFTP_PASSWORD}" ]]; then
  sftp_args+=(pass "${SIMPLY_SFTP_PASSWORD}")
fi

if [[ -n "${SIMPLY_SFTP_KEY_FILE}" ]]; then
  sftp_args+=(key_file "${SIMPLY_SFTP_KEY_FILE}")
fi

if [[ "${SIMPLY_SFTP_KEY_USE_AGENT}" == "true" ]]; then
  sftp_args+=(key_use_agent true)
fi

if remote_exists "${SIMPLY_SFTP_REMOTE}"; then
  run_or_print "${RCLONE_BIN}" config update "${sftp_args[@]}" --obscure
else
  run_or_print "${RCLONE_BIN}" config create "${sftp_args[@]}" --obscure
fi

run_or_print "${RCLONE_BIN}" mkdir "${SIMPLY_SFTP_REMOTE}:${SIMPLY_REMOTE_PATH}"

crypt_args=(
  "${SIMPLY_CRYPT_REMOTE}"
  crypt
  remote "${SIMPLY_SFTP_REMOTE}:${SIMPLY_REMOTE_PATH}"
  filename_encryption standard
  directory_name_encryption true
  password "${SIMPLY_CRYPT_PASSWORD}"
)

if [[ -n "${SIMPLY_CRYPT_SALT}" ]]; then
  crypt_args+=(password2 "${SIMPLY_CRYPT_SALT}")
fi

if remote_exists "${SIMPLY_CRYPT_REMOTE}"; then
  run_or_print "${RCLONE_BIN}" config update "${crypt_args[@]}" --obscure
else
  run_or_print "${RCLONE_BIN}" config create "${crypt_args[@]}" --obscure
fi

run_or_print "${RCLONE_BIN}" lsf "${SIMPLY_CRYPT_REMOTE}:"

echo "[simply-offsite] tamamlandı"
echo "  BACKUP_OFFSITE_ENABLED=true"
echo "  BACKUP_OFFSITE_TARGET=${SIMPLY_CRYPT_REMOTE}:"
echo "  BACKUP_OFFSITE_MODE=copy"
echo "  BACKUP_OFFSITE_EXTRA_ARGS=--transfers=2 --checkers=4"
