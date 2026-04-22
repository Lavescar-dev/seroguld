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
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        print(value)
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
  archive_path="$(ls -1t "${BACKUP_DIR}/hourly/"*.tar.gz 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "${archive_path}" || ! -f "${archive_path}" ]]; then
  echo "[restore] backup arşivi bulunamadı." >&2
  exit 1
fi

default_target="${ROOT_DIR}/data/manual-restore/restore-$(date -u +%Y%m%d-%H%M%S)"
target_dir="${2:-${default_target}}"

if [[ -e "${target_dir}" && -n "$(ls -A "${target_dir}" 2>/dev/null || true)" ]]; then
  echo "[restore] hedef dizin boş değil: ${target_dir}" >&2
  exit 1
fi

mkdir -p "${target_dir}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

tar -xzf "${archive_path}" -C "${tmp_dir}"

if [[ ! -f "${tmp_dir}/metadata.json" ]]; then
  echo "[restore] metadata.json bulunamadı." >&2
  exit 1
fi

cp "${tmp_dir}/metadata.json" "${target_dir}/metadata.json"

db_status="-"
if [[ -f "${tmp_dir}/db.sqlite3" ]]; then
  cp "${tmp_dir}/db.sqlite3" "${target_dir}/db.sqlite3"
  db_status="sqlite_ready"
elif [[ -f "${tmp_dir}/db.sql" ]]; then
  cp "${tmp_dir}/db.sql" "${target_dir}/db.sql"
  if ! rg -q "CREATE TABLE|INSERT INTO" "${target_dir}/db.sql"; then
    echo "[restore] db.sql beklenen içerikte değil." >&2
    exit 1
  fi
  db_status="postgres_sql_ready"
else
  echo "[restore] veritabanı içeriği bulunamadı." >&2
  exit 1
fi

media_status="-"
if [[ -f "${tmp_dir}/uploads.tar.gz" ]]; then
  mkdir -p "${target_dir}/uploads"
  tar -xzf "${tmp_dir}/uploads.tar.gz" -C "${target_dir}/uploads"
  media_status="uploads_ready"
elif [[ -f "${tmp_dir}/uploads.missing" ]]; then
  touch "${target_dir}/uploads.missing"
  media_status="uploads_missing_in_backup"
else
  echo "[restore] media çıktısı bulunamadı." >&2
  exit 1
fi

cat > "${target_dir}/restore-summary.txt" <<EOF
archive=${archive_path}
target_dir=${target_dir}
db_status=${db_status}
media_status=${media_status}
restored_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "[restore] başarılı"
echo "  archive: ${archive_path}"
echo "  target_dir: ${target_dir}"
echo "  db: ${db_status}"
echo "  media: ${media_status}"
