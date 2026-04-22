#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"
DATA_DIR="${ROOT_DIR}/data"

BACKEND_PORT="${DEMO_BACKEND_PORT:-8100}"
FRONTEND_PORT="${DEMO_FRONTEND_PORT:-3300}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"

DB_URL_DEFAULT="sqlite+aiosqlite:///${DATA_DIR}/desktop.db"
DATABASE_URL="${DEMO_DATABASE_URL:-${DB_URL_DEFAULT}}"

BACKEND_LOG="${RUN_DIR}/backend.log"
FRONTEND_LOG="${RUN_DIR}/frontend.log"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

mkdir -p "${RUN_DIR}" "${DATA_DIR}"

wait_for_url() {
  local url="$1"
  local label="$2"
  local timeout="${3:-60}"

  local i=0
  until curl -fsS "${url}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge "${timeout}" ]]; then
      echo "[demo] ${label} zamanında hazır olmadı: ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

ensure_setup() {
  echo "[demo] bağımlılıklar kontrol ediliyor..."
  bash "${ROOT_DIR}/scripts/setup-dev.sh" >/dev/null
}

start_backend() {
  if curl -fsS "${BACKEND_URL}/health" >/dev/null 2>&1; then
    echo "[demo] backend zaten açık: ${BACKEND_URL}"
    return 0
  fi

  echo "[demo] backend başlatılıyor (${BACKEND_URL})..."
  (
    cd "${ROOT_DIR}/backend"
    nohup env \
      PYTHONPATH="${ROOT_DIR}/backend" \
      DATABASE_URL="${DATABASE_URL}" \
      CORS_ORIGINS="http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}" \
      APP_URL="${FRONTEND_URL}" \
      "${ROOT_DIR}/backend/.venv/bin/python" -m uvicorn app.main:app \
      --host 127.0.0.1 --port "${BACKEND_PORT}" --reload \
      >"${BACKEND_LOG}" 2>&1 &
    echo $! >"${BACKEND_PID_FILE}"
  )
}

start_frontend() {
  if curl -fsS "${FRONTEND_URL}" >/dev/null 2>&1; then
    echo "[demo] frontend zaten açık: ${FRONTEND_URL}"
    return 0
  fi

  echo "[demo] frontend başlatılıyor (${FRONTEND_URL})..."
  (
    cd "${ROOT_DIR}/frontend"
    nohup env \
      VITE_API_BASE_URL="${BACKEND_URL}" \
      VITE_WS_BASE_URL="${BACKEND_URL}" \
      npm run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort \
      >"${FRONTEND_LOG}" 2>&1 &
    echo $! >"${FRONTEND_PID_FILE}"
  )
}

main() {
  ensure_setup
  start_backend
  wait_for_url "${BACKEND_URL}/health" "backend" 90
  start_frontend
  wait_for_url "${FRONTEND_URL}" "frontend" 120

  echo
  echo "[demo] hazır."
  echo "  frontend: ${FRONTEND_URL}"
  echo "  backend:  ${BACKEND_URL}"
  echo "  backend log: ${BACKEND_LOG}"
  echo "  frontend log: ${FRONTEND_LOG}"
}

main "$@"
