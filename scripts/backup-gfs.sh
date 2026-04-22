#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

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

DATABASE_URL="${DATABASE_URL:-$(read_env_value DATABASE_URL)}"
MEDIA_ROOT_DIR="${MEDIA_ROOT_DIR:-$(read_env_value MEDIA_ROOT_DIR)}"
BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-$(read_env_value BACKUP_ROOT_DIR)}"
BACKUP_KEEP_HOURLY="${BACKUP_KEEP_HOURLY:-$(read_env_value BACKUP_KEEP_HOURLY)}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-$(read_env_value BACKUP_KEEP_DAILY)}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-$(read_env_value BACKUP_KEEP_WEEKLY)}"
BACKUP_DAILY_HOUR_UTC="${BACKUP_DAILY_HOUR_UTC:-$(read_env_value BACKUP_DAILY_HOUR_UTC)}"
BACKUP_WEEKLY_DAY_UTC="${BACKUP_WEEKLY_DAY_UTC:-$(read_env_value BACKUP_WEEKLY_DAY_UTC)}"
BACKUP_ALLOW_SQLITE_FALLBACK="${BACKUP_ALLOW_SQLITE_FALLBACK:-$(read_env_value BACKUP_ALLOW_SQLITE_FALLBACK)}"
BACKUP_FALLBACK_SQLITE_PATH="${BACKUP_FALLBACK_SQLITE_PATH:-$(read_env_value BACKUP_FALLBACK_SQLITE_PATH)}"

DATABASE_URL="${DATABASE_URL:-sqlite+aiosqlite:///${ROOT_DIR}/data/desktop.db}"
MEDIA_ROOT_DIR="${MEDIA_ROOT_DIR:-./data/uploads}"
BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-./data/backups}"
BACKUP_KEEP_HOURLY="${BACKUP_KEEP_HOURLY:-48}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-30}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-12}"
BACKUP_DAILY_HOUR_UTC="${BACKUP_DAILY_HOUR_UTC:-00}"
BACKUP_WEEKLY_DAY_UTC="${BACKUP_WEEKLY_DAY_UTC:-1}"
BACKUP_ALLOW_SQLITE_FALLBACK="${BACKUP_ALLOW_SQLITE_FALLBACK:-true}"
BACKUP_FALLBACK_SQLITE_PATH="${BACKUP_FALLBACK_SQLITE_PATH:-${ROOT_DIR}/data/desktop.db}"

if [[ "${MEDIA_ROOT_DIR}" = /* ]]; then
  MEDIA_DIR="${MEDIA_ROOT_DIR}"
else
  MEDIA_DIR="${ROOT_DIR}/${MEDIA_ROOT_DIR#./}"
fi

if [[ "${BACKUP_ROOT_DIR}" = /* ]]; then
  BACKUP_DIR="${BACKUP_ROOT_DIR}"
else
  BACKUP_DIR="${ROOT_DIR}/${BACKUP_ROOT_DIR#./}"
fi

prune_stage() {
  local stage_dir="$1"
  local keep="$2"
  mkdir -p "${stage_dir}"
  mapfile -t files < <(ls -1t "${stage_dir}"/*.tar.gz 2>/dev/null || true)
  if [[ "${#files[@]}" -le "${keep}" ]]; then
    return 0
  fi
  for old_file in "${files[@]:${keep}}"; do
    rm -f "${old_file}"
  done
}

timestamp="$(date -u +%Y%m%d-%H%M%S)"
hour_utc="$(date -u +%H)"
weekday_utc="$(date -u +%u)"

hourly_dir="${BACKUP_DIR}/hourly"
daily_dir="${BACKUP_DIR}/daily"
weekly_dir="${BACKUP_DIR}/weekly"

mkdir -p "${hourly_dir}" "${daily_dir}" "${weekly_dir}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

db_format="unknown"
db_source="-"

backup_sqlite_file() {
  local sqlite_path="$1"
  if [[ ! -f "${sqlite_path}" ]]; then
    echo "[backup] SQLite dosyası bulunamadı: ${sqlite_path}" >&2
    return 1
  fi
  cp "${sqlite_path}" "${tmp_dir}/db.sqlite3"
  db_format="sqlite_file"
  db_source="${sqlite_path}"
  return 0
}

if [[ "${DATABASE_URL}" == sqlite+aiosqlite:///* || "${DATABASE_URL}" == sqlite:///* ]]; then
  sqlite_path="${DATABASE_URL#sqlite+aiosqlite:///}"
  sqlite_path="${sqlite_path#sqlite:///}"
  if [[ "${sqlite_path}" != /* ]]; then
    sqlite_path="${ROOT_DIR}/${sqlite_path#./}"
  fi

  backup_sqlite_file "${sqlite_path}"
elif [[ "${DATABASE_URL}" == postgresql+asyncpg://* || "${DATABASE_URL}" == postgresql://* ]]; then
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "[backup] PostgreSQL için pg_dump bulunamadı." >&2
    exit 1
  fi
  pg_url="${DATABASE_URL/postgresql+asyncpg:\/\//postgresql://}"
  if pg_dump --no-owner --no-acl --format=plain --file "${tmp_dir}/db.sql" "${pg_url}"; then
    db_format="postgres_sql"
    db_source="postgresql"
  else
    if [[ "${BACKUP_ALLOW_SQLITE_FALLBACK}" == "true" ]]; then
      fallback_sqlite="${BACKUP_FALLBACK_SQLITE_PATH}"
      if [[ "${fallback_sqlite}" != /* ]]; then
        fallback_sqlite="${ROOT_DIR}/${fallback_sqlite#./}"
      fi
      echo "[backup] PostgreSQL dump alınamadı, SQLite fallback deneniyor: ${fallback_sqlite}"
      backup_sqlite_file "${fallback_sqlite}"
    else
      echo "[backup] PostgreSQL dump alınamadı ve fallback kapalı." >&2
      exit 1
    fi
  fi
else
  echo "[backup] Desteklenmeyen DATABASE_URL formatı: ${DATABASE_URL}" >&2
  exit 1
fi

if [[ -d "${MEDIA_DIR}" ]]; then
  tar -czf "${tmp_dir}/uploads.tar.gz" -C "${MEDIA_DIR}" .
else
  : > "${tmp_dir}/uploads.missing"
fi

cat > "${tmp_dir}/metadata.json" <<EOF
{
  "timestamp_utc": "${timestamp}",
  "database_format": "${db_format}",
  "database_source": "${db_source}",
  "media_dir": "${MEDIA_DIR}",
  "hostname": "$(hostname)",
  "created_by": "scripts/backup-gfs.sh"
}
EOF

archive_name="seroguld-backup-${timestamp}.tar.gz"
hourly_archive="${hourly_dir}/${archive_name}"
tar -czf "${hourly_archive}" -C "${tmp_dir}" .

if [[ "${hour_utc}" == "${BACKUP_DAILY_HOUR_UTC}" ]]; then
  cp "${hourly_archive}" "${daily_dir}/${archive_name}"
fi

if [[ "${weekday_utc}" == "${BACKUP_WEEKLY_DAY_UTC}" && "${hour_utc}" == "${BACKUP_DAILY_HOUR_UTC}" ]]; then
  cp "${hourly_archive}" "${weekly_dir}/${archive_name}"
fi

prune_stage "${hourly_dir}" "${BACKUP_KEEP_HOURLY}"
prune_stage "${daily_dir}" "${BACKUP_KEEP_DAILY}"
prune_stage "${weekly_dir}" "${BACKUP_KEEP_WEEKLY}"

echo "[backup] tamamlandı"
echo "  arşiv: ${hourly_archive}"
echo "  db: ${db_format}"
echo "  media: ${MEDIA_DIR}"
