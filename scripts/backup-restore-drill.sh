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

BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-$(read_env_value BACKUP_ROOT_DIR)}"
BACKUP_RESTORE_DRILL_DIR="${BACKUP_RESTORE_DRILL_DIR:-$(read_env_value BACKUP_RESTORE_DRILL_DIR)}"
BACKUP_RESTORE_DRILL_KEEP="${BACKUP_RESTORE_DRILL_KEEP:-$(read_env_value BACKUP_RESTORE_DRILL_KEEP)}"

BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-./data/backups}"
BACKUP_RESTORE_DRILL_DIR="${BACKUP_RESTORE_DRILL_DIR:-./data/restore-drill}"
BACKUP_RESTORE_DRILL_KEEP="${BACKUP_RESTORE_DRILL_KEEP:-5}"

if [[ "${BACKUP_ROOT_DIR}" = /* ]]; then
  BACKUP_DIR="${BACKUP_ROOT_DIR}"
else
  BACKUP_DIR="${ROOT_DIR}/${BACKUP_ROOT_DIR#./}"
fi

if [[ "${BACKUP_RESTORE_DRILL_DIR}" = /* ]]; then
  RESTORE_BASE_DIR="${BACKUP_RESTORE_DRILL_DIR}"
else
  RESTORE_BASE_DIR="${ROOT_DIR}/${BACKUP_RESTORE_DRILL_DIR#./}"
fi

archive_path="${1:-}"
if [[ -z "${archive_path}" ]]; then
  latest_archive="$(ls -1t "${BACKUP_DIR}/hourly/"*.tar.gz 2>/dev/null | head -n 1 || true)"
  if [[ -z "${latest_archive}" ]]; then
    echo "[restore-drill] hourly backup bulunamadı: ${BACKUP_DIR}/hourly" >&2
    exit 1
  fi
  archive_path="${latest_archive}"
fi

if [[ ! -f "${archive_path}" ]]; then
  echo "[restore-drill] Arşiv bulunamadı: ${archive_path}" >&2
  exit 1
fi

mkdir -p "${RESTORE_BASE_DIR}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

tar -xzf "${archive_path}" -C "${tmp_dir}"

if [[ ! -f "${tmp_dir}/metadata.json" ]]; then
  echo "[restore-drill] metadata.json bulunamadı." >&2
  exit 1
fi

restore_stamp="$(date -u +%Y%m%d-%H%M%S)"
restore_dir="${RESTORE_BASE_DIR}/restore-${restore_stamp}"
mkdir -p "${restore_dir}"
cp "${tmp_dir}/metadata.json" "${restore_dir}/metadata.json"

db_status="-"
if [[ -f "${tmp_dir}/db.sqlite3" ]]; then
  cp "${tmp_dir}/db.sqlite3" "${restore_dir}/db.sqlite3"
  table_count="$(python3 - "${restore_dir}/db.sqlite3" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
try:
    cur = conn.cursor()
    cur.execute("select count(*) from sqlite_master where type='table'")
    count = int(cur.fetchone()[0])
    if count < 1:
        raise RuntimeError("SQLite restore table içermiyor")
    print(count)
finally:
    conn.close()
PY
)"
  db_status="sqlite_ok (${table_count} table)"
elif [[ -f "${tmp_dir}/db.sql" ]]; then
  cp "${tmp_dir}/db.sql" "${restore_dir}/db.sql"
  if ! rg -q "CREATE TABLE|INSERT INTO" "${restore_dir}/db.sql"; then
    echo "[restore-drill] db.sql beklenen içerikte değil." >&2
    exit 1
  fi
  db_status="postgres_sql_ok"
else
  echo "[restore-drill] Veritabanı yedeği bulunamadı (db.sqlite3/db.sql)." >&2
  exit 1
fi

media_status="-"
if [[ -f "${tmp_dir}/uploads.tar.gz" ]]; then
  mkdir -p "${restore_dir}/uploads"
  tar -xzf "${tmp_dir}/uploads.tar.gz" -C "${restore_dir}/uploads"
  media_count="$(find "${restore_dir}/uploads" -type f | wc -l | tr -d ' ')"
  media_status="uploads_ok (${media_count} file)"
elif [[ -f "${tmp_dir}/uploads.missing" ]]; then
  touch "${restore_dir}/uploads.missing"
  media_status="uploads_missing_in_backup"
else
  echo "[restore-drill] Media çıktısı bulunamadı (uploads.tar.gz/uploads.missing)." >&2
  exit 1
fi

cat > "${restore_dir}/restore-summary.txt" <<EOF
archive=${archive_path}
restore_dir=${restore_dir}
db_status=${db_status}
media_status=${media_status}
performed_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

mapfile -t drill_dirs < <(ls -1dt "${RESTORE_BASE_DIR}"/restore-* 2>/dev/null || true)
if [[ "${#drill_dirs[@]}" -gt "${BACKUP_RESTORE_DRILL_KEEP}" ]]; then
  for old_dir in "${drill_dirs[@]:${BACKUP_RESTORE_DRILL_KEEP}}"; do
    rm -rf "${old_dir}"
  done
fi

echo "[restore-drill] başarılı"
echo "  archive: ${archive_path}"
echo "  restore_dir: ${restore_dir}"
echo "  db: ${db_status}"
echo "  media: ${media_status}"
