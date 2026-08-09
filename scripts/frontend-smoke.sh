#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
RUN_ROOT="${ROOT_DIR}/.run"
mkdir -p "${RUN_ROOT}"
SMOKE_DIR="$(mktemp -d "${RUN_ROOT}/frontend-smoke-XXXXXX")"

BACKEND_PORT="${FRONTEND_SMOKE_BACKEND_PORT:-38100}"
FRONTEND_PORT="${FRONTEND_SMOKE_FRONTEND_PORT:-3311}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
DATABASE_PATH="${SMOKE_DIR}/smoke.db"
DATABASE_URL="sqlite+aiosqlite:///${DATABASE_PATH}"
BACKEND_LOG="${SMOKE_DIR}/backend.log"
FRONTEND_LOG="${SMOKE_DIR}/frontend.log"
SMOKE_ADMIN_EMAIL="${FRONTEND_SMOKE_ADMIN_EMAIL:-info@seroguld.dk}"
SMOKE_ADMIN_PASSWORD="${FRONTEND_SMOKE_ADMIN_PASSWORD:-Admin123!}"

BACKEND_PID=""
FRONTEND_PID=""

wait_for_url() {
  local url="$1"
  local label="$2"
  local timeout="${3:-90}"
  local i=0

  until curl -fsS "${url}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "${i}" -ge "${timeout}" ]]; then
      echo "[frontend-smoke] ${label} hazır olmadı: ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

cleanup() {
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${SMOKE_DIR}"
}

trap cleanup EXIT

bash "${ROOT_DIR}/scripts/setup-dev.sh"

(
  cd "${BACKEND_DIR}"
  env DATABASE_URL="${DATABASE_URL}" .venv/bin/python -m alembic upgrade head
)

env \
  DATABASE_URL="${DATABASE_URL}" \
  INITIAL_ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL}" \
  INITIAL_ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD}" \
  "${BACKEND_DIR}/.venv/bin/python" "${ROOT_DIR}/scripts/bootstrap-admin.py"

pushd "${BACKEND_DIR}" >/dev/null
nohup env \
  PYTHONPATH="${BACKEND_DIR}" \
  DATABASE_URL="${DATABASE_URL}" \
  CORS_ORIGINS="${FRONTEND_URL}" \
  APP_URL="${FRONTEND_URL}" \
  OPENAI_API_KEY="" \
  WOOCOMMERCE_BASE_URL="" \
  WORDPRESS_BASE_URL="" \
  .venv/bin/python -m uvicorn app.main:app \
  --host 127.0.0.1 --port "${BACKEND_PORT}" \
  >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!
echo "${BACKEND_PID}" >"${SMOKE_DIR}/backend.pid"
popd >/dev/null

wait_for_url "${BACKEND_URL}/health" "backend" 120

pushd "${FRONTEND_DIR}" >/dev/null
nohup env \
  VITE_API_BASE_URL="${BACKEND_URL}" \
  VITE_WS_BASE_URL="${BACKEND_URL}" \
  npm run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort \
  >"${FRONTEND_LOG}" 2>&1 &
FRONTEND_PID=$!
echo "${FRONTEND_PID}" >"${SMOKE_DIR}/frontend.pid"
popd >/dev/null

wait_for_url "${FRONTEND_URL}" "frontend" 120

pushd "${FRONTEND_DIR}" >/dev/null
PLAYWRIGHT_BASE_URL="${FRONTEND_URL}" npx playwright test --config=playwright.config.ts
popd >/dev/null

echo "[frontend-smoke] smoke başarılı."
