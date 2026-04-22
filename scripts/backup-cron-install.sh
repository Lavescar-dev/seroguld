#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
RUN_DIR="${ROOT_DIR}/.run/cron"

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

BACKUP_CRON_HOURLY="${BACKUP_CRON_HOURLY:-$(read_env_value BACKUP_CRON_HOURLY)}"
BACKUP_CRON_VERIFY="${BACKUP_CRON_VERIFY:-$(read_env_value BACKUP_CRON_VERIFY)}"
BACKUP_CRON_RESTORE_DRILL="${BACKUP_CRON_RESTORE_DRILL:-$(read_env_value BACKUP_CRON_RESTORE_DRILL)}"
BACKUP_CRON_OFFSITE="${BACKUP_CRON_OFFSITE:-$(read_env_value BACKUP_CRON_OFFSITE)}"
BACKUP_CRON_DRY_RUN="${BACKUP_CRON_DRY_RUN:-$(read_env_value BACKUP_CRON_DRY_RUN)}"

BACKUP_CRON_HOURLY="${BACKUP_CRON_HOURLY:-7 * * * *}"
BACKUP_CRON_VERIFY="${BACKUP_CRON_VERIFY:-17 0 * * *}"
BACKUP_CRON_RESTORE_DRILL="${BACKUP_CRON_RESTORE_DRILL:-32 0 * * *}"
BACKUP_CRON_OFFSITE="${BACKUP_CRON_OFFSITE:-47 * * * *}"
BACKUP_CRON_DRY_RUN="${BACKUP_CRON_DRY_RUN:-false}"

mkdir -p "${RUN_DIR}"

if ! command -v crontab >/dev/null 2>&1; then
  if [[ "${BACKUP_CRON_DRY_RUN}" == "true" ]]; then
    current=""
  else
    echo "[backup-cron] crontab komutu bulunamadı." >&2
    exit 1
  fi
else
  current="$(crontab -l 2>/dev/null || true)"
fi

backup_cmd="cd ${ROOT_DIR} && make backup >> ${RUN_DIR}/backup.log 2>&1"
verify_cmd="cd ${ROOT_DIR} && make backup-verify >> ${RUN_DIR}/backup-verify.log 2>&1"
restore_cmd="cd ${ROOT_DIR} && make backup-restore-drill >> ${RUN_DIR}/backup-restore-drill.log 2>&1"
offsite_cmd="cd ${ROOT_DIR} && make backup-offsite >> ${RUN_DIR}/backup-offsite.log 2>&1"

new_block="$(cat <<EOF
# >>> seroguld-backup >>>
${BACKUP_CRON_HOURLY} ${backup_cmd}
${BACKUP_CRON_VERIFY} ${verify_cmd}
${BACKUP_CRON_RESTORE_DRILL} ${restore_cmd}
${BACKUP_CRON_OFFSITE} ${offsite_cmd}
# <<< seroguld-backup <<<
EOF
)"

cleaned="$(printf '%s\n' "${current}" | awk '
  /# >>> seroguld-backup >>>/ {skip=1; next}
  /# <<< seroguld-backup <<</ {skip=0; next}
  skip==0 {print}
')"

final_content="$(printf '%s\n%s\n' "${cleaned}" "${new_block}" | sed '/^[[:space:]]*$/N;/^\n$/D')"

if [[ "${BACKUP_CRON_DRY_RUN}" == "true" ]]; then
  echo "[backup-cron] dry-run modunda. Yazılacak cron içeriği:"
  echo "----------------------------------------"
  printf '%s\n' "${final_content}"
  echo "----------------------------------------"
  exit 0
fi

printf '%s\n' "${final_content}" | crontab -

echo "[backup-cron] yüklendi"
echo "  hourly: ${BACKUP_CRON_HOURLY}"
echo "  verify: ${BACKUP_CRON_VERIFY}"
echo "  restore-drill: ${BACKUP_CRON_RESTORE_DRILL}"
echo "  offsite: ${BACKUP_CRON_OFFSITE}"
