#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
RUN_DIR="${ROOT_DIR}/.run"
PYTHON_BIN="${BACKEND_DIR}/.venv/bin/python"
PORT=""
BASE_URL=""
TEMP_DIR=""
TEMP_ENV=""
TEMP_DB=""
LOG_PATH=""
BACKEND_PID=""

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "[gdpr-smoke] .env bulunamadı." >&2
  exit 1
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "[gdpr-smoke] backend/.venv bulunamadı. Önce 'make setup' çalıştırın." >&2
  exit 1
fi

PORT="${GDPR_SMOKE_TEMP_PORT:-$("${PYTHON_BIN}" - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)}"
BASE_URL="http://127.0.0.1:${PORT}"

mkdir -p "${RUN_DIR}"
TEMP_DIR="$(mktemp -d "${RUN_DIR}/gdpr-smoke.XXXXXX")"
TEMP_ENV="${TEMP_DIR}/gdpr-smoke.env"
TEMP_DB="${TEMP_DIR}/gdpr-smoke.db"
LOG_PATH="${TEMP_DIR}/backend.log"

cleanup() {
  local exit_code=$?
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi

  if [[ ${exit_code} -ne 0 ]]; then
    echo "[gdpr-smoke] Hata oluştu. Geçici artefact'lar korundu: ${TEMP_DIR}" >&2
    if [[ -f "${LOG_PATH}" ]]; then
      echo "[gdpr-smoke] Son backend log satırları:" >&2
      tail -n 40 "${LOG_PATH}" >&2 || true
    fi
    return
  fi

  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

run_with_env() {
  local workdir="$1"
  shift
  (
    cd "${workdir}"
    "${PYTHON_BIN}" - "${TEMP_ENV}" "$@" <<'PY'
import os
import sys

env_path = sys.argv[1]
cmd = sys.argv[2:]
env = os.environ.copy()

with open(env_path, encoding="utf-8") as handle:
    for raw in handle:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        env[key] = value

os.execvpe(cmd[0], cmd, env)
PY
  )
}

create_schema_with_env() {
  "${PYTHON_BIN}" - "${TEMP_ENV}" "${BACKEND_DIR}" <<'PY'
import asyncio
import os
import sys

env_path = sys.argv[1]
backend_dir = sys.argv[2]

for raw in open(env_path, encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    os.environ[key] = value

sys.path.insert(0, backend_dir)

from app.database import Base, engine
from app.models import *  # noqa: F401,F403


async def main() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


asyncio.run(main())
PY
}

cat "${ROOT_DIR}/.env" > "${TEMP_ENV}"
cat >> "${TEMP_ENV}" <<EOF
ENV=development
APP_URL=${BASE_URL}
DATABASE_URL=sqlite:///${TEMP_DB}
DATABASE_AUTO_CREATE=false
INITIAL_ADMIN_AUTO_SEED=false
INITIAL_ADMIN_EMAIL=gdpr-smoke-admin@local.seroguld
INITIAL_ADMIN_PASSWORD=SmokeAdmin123!
INITIAL_ADMIN_NAME=GDPR Smoke Admin
CORS_ORIGINS=http://127.0.0.1:${PORT},http://localhost:${PORT}
MEDIA_ROOT_DIR=${TEMP_DIR}/uploads
DOCUMENT_ROOT_DIR=${TEMP_DIR}/documents
BACKUP_ROOT_DIR=${TEMP_DIR}/backups
BACKUP_RESTORE_DRILL_DIR=${TEMP_DIR}/restore-drill
BACKUP_OFFSITE_STATUS_FILE=${TEMP_DIR}/backup-offsite.json
BACKUP_OFFSITE_ENABLED=false
WOOCOMMERCE_BASE_URL=
WOOCOMMERCE_CONSUMER_KEY=
WOOCOMMERCE_CONSUMER_SECRET=
WOOCOMMERCE_WEBHOOK_SECRET=
WORDPRESS_BASE_URL=
WP_APP_USERNAME=
WP_APP_PASSWORD=
OPENAI_API_KEY=
OPMC_API_KEY=
OPMC_WEBHOOK_SECRET=
UNICONTA_USERNAME=
UNICONTA_PASSWORD=
UNICONTA_COMPANY_ID=
UNICONTA_API_KEY=
EOF

mkdir -p "${TEMP_DIR}/uploads" "${TEMP_DIR}/documents" "${TEMP_DIR}/backups" "${TEMP_DIR}/restore-drill"

echo "[gdpr-smoke] Geçici backend hazırlanıyor: ${BASE_URL}"
if ! run_with_env "${BACKEND_DIR}" "${PYTHON_BIN}" -m alembic upgrade head; then
  echo "[gdpr-smoke] SQLite alembic zinciri uyumsuz; Base.metadata.create_all fallback kullanılıyor." >&2
  rm -f "${TEMP_DB}"
  create_schema_with_env
fi
run_with_env "${ROOT_DIR}" "${PYTHON_BIN}" "${ROOT_DIR}/scripts/bootstrap-admin.py" --env-file "${TEMP_ENV}"

run_with_env "${BACKEND_DIR}" "${PYTHON_BIN}" -m uvicorn app.main:app --host 127.0.0.1 --port "${PORT}" > "${LOG_PATH}" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "[gdpr-smoke] Geçici backend healthcheck başarısız: ${BASE_URL}" >&2
  exit 1
fi

export GDPR_SMOKE_SKIP_WARNING=1
export GDPR_SMOKE_BASE_URL="${BASE_URL}"
export INITIAL_ADMIN_EMAIL="gdpr-smoke-admin@local.seroguld"
export INITIAL_ADMIN_PASSWORD="SmokeAdmin123!"

bash "${ROOT_DIR}/scripts/gdpr-smoke-live.sh"

echo "[gdpr-smoke] Temp backend smoke başarılı."
