#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
RUN_DIR="${ROOT_DIR}/.run"

read_env_value() {
  local key="$1"
  if [[ ! -f "${ENV_FILE}" ]]; then
    return 0
  fi
  python3 - "${ENV_FILE}" "${key}" <<'PY'
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
target_key = sys.argv[2]

for raw in env_path.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == target_key:
        print(value.strip())
        break
PY
}

BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-$(read_env_value BACKUP_ROOT_DIR)}"
BACKUP_OFFSITE_ENABLED="${BACKUP_OFFSITE_ENABLED:-$(read_env_value BACKUP_OFFSITE_ENABLED)}"
BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-$(read_env_value BACKUP_OFFSITE_TARGET)}"
BACKUP_OFFSITE_MODE="${BACKUP_OFFSITE_MODE:-$(read_env_value BACKUP_OFFSITE_MODE)}"
BACKUP_OFFSITE_EXTRA_ARGS="${BACKUP_OFFSITE_EXTRA_ARGS:-$(read_env_value BACKUP_OFFSITE_EXTRA_ARGS)}"

BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-./data/backups}"
BACKUP_OFFSITE_ENABLED="${BACKUP_OFFSITE_ENABLED:-false}"
BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"
BACKUP_OFFSITE_MODE="${BACKUP_OFFSITE_MODE:-sync}"
BACKUP_OFFSITE_EXTRA_ARGS="${BACKUP_OFFSITE_EXTRA_ARGS:---transfers=4 --checkers=8}"

if [[ "${BACKUP_ROOT_DIR}" = /* ]]; then
  BACKUP_DIR="${BACKUP_ROOT_DIR}"
else
  BACKUP_DIR="${ROOT_DIR}/${BACKUP_ROOT_DIR#./}"
fi

mkdir -p "${RUN_DIR}"

if [[ "${BACKUP_OFFSITE_ENABLED}" != "true" ]]; then
  echo "[backup-offsite] pasif (BACKUP_OFFSITE_ENABLED=true ayarlayın)."
  exit 0
fi

if [[ -z "${BACKUP_OFFSITE_TARGET}" ]]; then
  echo "[backup-offsite] BACKUP_OFFSITE_TARGET boş. Örn: onedrive:seroguld-crm-backups" >&2
  exit 1
fi

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "[backup-offsite] Lokal backup dizini bulunamadı: ${BACKUP_DIR}" >&2
  exit 1
fi

RCLONE_BIN="${RCLONE_BIN:-}"
if [[ -z "${RCLONE_BIN}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    RCLONE_BIN="$(command -v rclone)"
  elif [[ -x "${ROOT_DIR}/tools/rclone/rclone" ]]; then
    RCLONE_BIN="${ROOT_DIR}/tools/rclone/rclone"
  else
    echo "[backup-offsite] rclone bulunamadı. Önce 'make backup-rclone-setup' çalıştırın." >&2
    exit 1
  fi
fi

if [[ "${BACKUP_OFFSITE_MODE}" != "sync" && "${BACKUP_OFFSITE_MODE}" != "copy" ]]; then
  echo "[backup-offsite] BACKUP_OFFSITE_MODE sadece 'sync' veya 'copy' olabilir." >&2
  exit 1
fi

extra_args=()
if [[ -n "${BACKUP_OFFSITE_EXTRA_ARGS}" ]]; then
  # shellcheck disable=SC2206
  extra_args=(${BACKUP_OFFSITE_EXTRA_ARGS})
fi

cmd=("${RCLONE_BIN}" "${BACKUP_OFFSITE_MODE}" "${BACKUP_DIR}" "${BACKUP_OFFSITE_TARGET}" --fast-list --create-empty-src-dirs)
if [[ "${#extra_args[@]}" -gt 0 ]]; then
  cmd+=("${extra_args[@]}")
fi

echo "[backup-offsite] başlıyor"
echo "  mode: ${BACKUP_OFFSITE_MODE}"
echo "  source: ${BACKUP_DIR}"
echo "  target: ${BACKUP_OFFSITE_TARGET}"

"${cmd[@]}"

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "${RUN_DIR}/backup-offsite-last-sync.json" <<EOF
{
  "timestamp_utc": "${timestamp}",
  "source": "${BACKUP_DIR}",
  "target": "${BACKUP_OFFSITE_TARGET}",
  "mode": "${BACKUP_OFFSITE_MODE}"
}
EOF

echo "[backup-offsite] tamamlandı"
echo "  kayıt: ${RUN_DIR}/backup-offsite-last-sync.json"
