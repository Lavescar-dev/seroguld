#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec env \
  DESKTOP_BACKEND_PORT="${DESKTOP_BACKEND_PORT:-38120}" \
  DESKTOP_FRONTEND_PORT="${DESKTOP_FRONTEND_PORT:-3300}" \
  DESKTOP_DATABASE_URL="${DESKTOP_DATABASE_URL:-sqlite+aiosqlite:///${ROOT_DIR}/.run/desktop-smoke-default.db}" \
  DESKTOP_SESSION_FILE="${DESKTOP_SESSION_FILE:-${ROOT_DIR}/.run/desktop-smoke-session.json}" \
  node "${ROOT_DIR}/desktop/scripts/dev.js"
