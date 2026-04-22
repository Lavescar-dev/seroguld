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
BACKUP_ROOT_DIR="${BACKUP_ROOT_DIR:-./data/backups}"

if [[ "${BACKUP_ROOT_DIR}" = /* ]]; then
  BACKUP_DIR="${BACKUP_ROOT_DIR}"
else
  BACKUP_DIR="${ROOT_DIR}/${BACKUP_ROOT_DIR#./}"
fi

archive_path="${1:-}"
if [[ -z "${archive_path}" ]]; then
  latest="$(ls -1t "${BACKUP_DIR}/hourly/"*.tar.gz 2>/dev/null | head -n 1 || true)"
  if [[ -z "${latest}" ]]; then
    echo "[backup-verify] Doğrulanacak backup bulunamadı: ${BACKUP_DIR}/hourly" >&2
    exit 1
  fi
  archive_path="${latest}"
fi

if [[ ! -f "${archive_path}" ]]; then
  echo "[backup-verify] Arşiv bulunamadı: ${archive_path}" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

tar -xzf "${archive_path}" -C "${tmp_dir}"

if [[ ! -f "${tmp_dir}/metadata.json" ]]; then
  echo "[backup-verify] metadata.json eksik." >&2
  exit 1
fi

if [[ -f "${tmp_dir}/db.sqlite3" ]]; then
  python3 - "${tmp_dir}/db.sqlite3" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
try:
    cur = conn.cursor()
    cur.execute("select count(*) from sqlite_master where type='table'")
    table_count = int(cur.fetchone()[0])
    if table_count < 1:
        raise RuntimeError("SQLite backup table içermiyor")
finally:
    conn.close()
PY
  db_status="sqlite:ok"
elif [[ -f "${tmp_dir}/db.sql" ]]; then
  if ! rg -q "CREATE TABLE|INSERT INTO" "${tmp_dir}/db.sql"; then
    echo "[backup-verify] db.sql içeriği boş veya beklenen formatta değil." >&2
    exit 1
  fi
  db_status="postgres_dump:ok"
else
  echo "[backup-verify] Veritabanı yedeği bulunamadı (db.sqlite3 / db.sql)." >&2
  exit 1
fi

if [[ -f "${tmp_dir}/uploads.tar.gz" ]]; then
  upload_count="$(tar -tzf "${tmp_dir}/uploads.tar.gz" | wc -l | tr -d ' ')"
  media_status="uploads:ok (${upload_count} dosya)"
elif [[ -f "${tmp_dir}/uploads.missing" ]]; then
  media_status="uploads:yok (kaynak klasör backup anında yok)"
else
  echo "[backup-verify] Media çıktısı bulunamadı (uploads.tar.gz / uploads.missing)." >&2
  exit 1
fi

echo "[backup-verify] başarılı"
echo "  arşiv: ${archive_path}"
echo "  db: ${db_status}"
echo "  media: ${media_status}"
