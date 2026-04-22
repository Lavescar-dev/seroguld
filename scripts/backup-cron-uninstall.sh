#!/usr/bin/env bash
set -euo pipefail

if ! command -v crontab >/dev/null 2>&1; then
  echo "[backup-cron] crontab komutu bulunamadı." >&2
  exit 1
fi

current="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "${current}" | awk '
  /# >>> seroguld-backup >>>/ {skip=1; next}
  /# <<< seroguld-backup <<</ {skip=0; next}
  skip==0 {print}
')"

if [[ -z "${cleaned//[[:space:]]/}" ]]; then
  crontab -r || true
else
  printf '%s\n' "${cleaned}" | crontab -
fi

echo "[backup-cron] seroguld backup cron satırları kaldırıldı."
