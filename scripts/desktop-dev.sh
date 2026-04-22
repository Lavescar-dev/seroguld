#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/desktop"
DESKTOP_HASH_FILE="${DESKTOP_DIR}/node_modules/.package_lock_hash"

if [[ ! -d "${DESKTOP_DIR}" ]]; then
  echo "[desktop] desktop klasoru bulunamadi: ${DESKTOP_DIR}" >&2
  exit 1
fi

echo "[desktop] backend + frontend bagimliliklari hazirlaniyor..."
bash "${ROOT_DIR}/scripts/setup-dev.sh"

current_npm_hash="$(sha256sum "${DESKTOP_DIR}/package-lock.json" | awk '{print $1}')"
installed_npm_hash=""
if [[ -f "${DESKTOP_HASH_FILE}" ]]; then
  installed_npm_hash="$(cat "${DESKTOP_HASH_FILE}")"
fi

if [[ ! -d "${DESKTOP_DIR}/node_modules" || "${current_npm_hash}" != "${installed_npm_hash}" ]]; then
  echo "[desktop] electron bagimliliklari kuruluyor..."
  cd "${DESKTOP_DIR}"
  npm ci
  echo "${current_npm_hash}" > "${DESKTOP_HASH_FILE}"
else
  echo "[desktop] tauri bagimliliklari guncel."
fi

cd "${DESKTOP_DIR}"
npm run dev
