#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${ROOT_DIR}/desktop"
NPM_HASH_FILE="${DESKTOP_DIR}/node_modules/.package_lock_hash"

current_npm_hash="$(sha256sum "${DESKTOP_DIR}/package-lock.json" | awk '{print $1}')"
installed_npm_hash=""
if [[ -f "${NPM_HASH_FILE}" ]]; then
  installed_npm_hash="$(cat "${NPM_HASH_FILE}")"
fi

if [[ ! -d "${DESKTOP_DIR}/node_modules" || "${current_npm_hash}" != "${installed_npm_hash}" ]]; then
  echo "[release] desktop bağımlılıkları kuruluyor..."
  cd "${DESKTOP_DIR}"
  npm ci
  echo "${current_npm_hash}" > "${NPM_HASH_FILE}"
else
  echo "[release] desktop bağımlılıkları güncel."
fi

echo "[release] backend testleri çalışıyor..."
bash "${ROOT_DIR}/scripts/test.sh" --backend-only

echo "[release] frontend typecheck çalışıyor..."
bash "${ROOT_DIR}/scripts/test.sh" --frontend-only

echo "[release] frontend build alınıyor..."
bash "${ROOT_DIR}/scripts/frontend-build.sh"

echo "[release] tauri production build alınıyor..."
cd "${DESKTOP_DIR}"
CI=1 npm run tauri build

echo "[release] desktop build başarılı."
