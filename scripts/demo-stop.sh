#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/.run"

BACKEND_PORT="${DEMO_BACKEND_PORT:-8100}"
FRONTEND_PORT="${DEMO_FRONTEND_PORT:-3300}"

BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

stop_pid_file() {
  local pid_file="$1"
  local label="$2"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      echo "[demo] ${label} kapatıldı (pid=${pid})"
    fi
    rm -f "${pid_file}"
  fi
}

stop_pid_file "${BACKEND_PID_FILE}" "backend"
stop_pid_file "${FRONTEND_PID_FILE}" "frontend"

# PID dosyası yoksa da temizlik yap.
pkill -f "uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT}" >/dev/null 2>&1 || true
pkill -f "vite --host 127.0.0.1 --port ${FRONTEND_PORT}" >/dev/null 2>&1 || true

echo "[demo] servisler durduruldu."
