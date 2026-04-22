#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/desktop"
RUN_ROOT="${ROOT_DIR}/.run"
DOC_PATH="${ROOT_DIR}/docs/DESKTOP_SMOKE_PREREQUISITES_TR.md"
mkdir -p "${RUN_ROOT}"
SMOKE_DIR="$(mktemp -d "${RUN_ROOT}/desktop-smoke-XXXXXX")"

BACKEND_PORT="${DESKTOP_SMOKE_BACKEND_PORT:-38120}"
FRONTEND_PORT="${DESKTOP_SMOKE_FRONTEND_PORT:-3300}"
DATABASE_PATH="${SMOKE_DIR}/desktop-smoke.db"
DATABASE_URL="sqlite+aiosqlite:///${DATABASE_PATH}"
SESSION_FILE="${SMOKE_DIR}/desktop-session.json"
TAURI_DRIVER_PORT="${DESKTOP_SMOKE_DRIVER_PORT:-4444}"
TAURI_NATIVE_PORT="${DESKTOP_SMOKE_NATIVE_PORT:-4445}"
TAURI_DRIVER_LOG="${SMOKE_DIR}/tauri-driver.log"
APPLICATION="${ROOT_DIR}/scripts/desktop-smoke-launch.sh"

TAURI_DRIVER_PID=""
WEBKIT_WEBDRIVER_BIN="${WEBKIT_WEBDRIVER_BIN:-}"

cleanup() {
  if [[ -n "${TAURI_DRIVER_PID}" ]] && kill -0 "${TAURI_DRIVER_PID}" >/dev/null 2>&1; then
    kill "${TAURI_DRIVER_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -f "${SESSION_FILE}" ]]; then
    mapfile -t tracked_pids < <(
      python3 - "${SESSION_FILE}" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
for key in ("backend_pid", "frontend_pid", "tauri_pid"):
    pid = payload.get(key)
    if pid:
        print(pid)
PY
    )
    for pid in "${tracked_pids[@]:-}"; do
      kill "${pid}" >/dev/null 2>&1 || true
    done
  fi

  rm -rf "${SMOKE_DIR}"
}

trap cleanup EXIT

bash "${ROOT_DIR}/scripts/setup-dev.sh"

if ! command -v cargo >/dev/null 2>&1; then
  echo "[desktop-smoke] cargo bulunamadı." >&2
  exit 1
fi

if ! command -v tauri-driver >/dev/null 2>&1; then
  echo "[desktop-smoke] tauri-driver kuruluyor..."
  cargo install tauri-driver --locked
fi

if [[ -z "${WEBKIT_WEBDRIVER_BIN}" ]]; then
  if command -v WebKitWebDriver >/dev/null 2>&1; then
    WEBKIT_WEBDRIVER_BIN="$(command -v WebKitWebDriver)"
  else
    for candidate in \
      "/usr/bin/WebKitWebDriver" \
      "/usr/libexec/webkit2gtk-4.1/WebKitWebDriver" \
      "/usr/libexec/webkit2gtk-4.0/WebKitWebDriver" \
      "/app/bin/WebKitWebDriver" \
      "/usr/lib64/webkit2gtk-4.1/WebKitWebDriver"
    do
      if [[ -x "${candidate}" ]]; then
        WEBKIT_WEBDRIVER_BIN="${candidate}"
        break
      fi
    done
  fi
fi

if [[ -z "${WEBKIT_WEBDRIVER_BIN}" ]]; then
  echo "[desktop-smoke] WebKitWebDriver bulunamadı." >&2
  echo "[desktop-smoke] Önce: make desktop-smoke-doctor" >&2
  echo "[desktop-smoke] İpucu: WEBKIT_WEBDRIVER_BIN=/abs/path/WebKitWebDriver make desktop-smoke" >&2
  echo "[desktop-smoke] Doküman: ${DOC_PATH}" >&2
  exit 1
fi

export WEBKIT_WEBDRIVER_BIN

(
  cd "${DESKTOP_DIR}"
  npm ci
)

nohup tauri-driver --port "${TAURI_DRIVER_PORT}" --native-port "${TAURI_NATIVE_PORT}" >"${TAURI_DRIVER_LOG}" 2>&1 &
TAURI_DRIVER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${TAURI_DRIVER_PORT}/status" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${TAURI_DRIVER_PORT}/status" >/dev/null 2>&1; then
  echo "[desktop-smoke] tauri-driver hazır olmadı." >&2
  exit 1
fi

(
  cd "${DESKTOP_DIR}"
  env \
    TAURI_DRIVER_URL="http://127.0.0.1:${TAURI_DRIVER_PORT}" \
    DESKTOP_SMOKE_APPLICATION="${APPLICATION}" \
    DESKTOP_SMOKE_BASE_URL="http://127.0.0.1:${FRONTEND_PORT}/#/desktop-smoke" \
    DESKTOP_SESSION_FILE="${SESSION_FILE}" \
    DESKTOP_BACKEND_PORT="${BACKEND_PORT}" \
    DESKTOP_FRONTEND_PORT="${FRONTEND_PORT}" \
    DESKTOP_DATABASE_URL="${DATABASE_URL}" \
    npm run desktop-smoke
)

echo "[desktop-smoke] smoke başarılı."
