#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

legacy_next_refs="$(rg -n \
  'NEXT_SERVER_API_PROXY|next dev|next-env\.d\.ts|next\.config\.js' \
  "${ROOT_DIR}/scripts" \
  "${ROOT_DIR}/docker-compose.yml" \
  "${ROOT_DIR}/frontend/package.json" \
  "${ROOT_DIR}/frontend/Dockerfile" \
  "${ROOT_DIR}/frontend/index.html" \
  "${ROOT_DIR}/frontend/src-v2" \
  "${ROOT_DIR}/frontend/vite.config.ts" \
  "${ROOT_DIR}/.github/workflows" \
  --glob '!check-frontend-truth.sh' || true)"

if [[ -n "${legacy_next_refs}" ]]; then
  echo "[frontend-truth] legacy Next referansları bulundu:" >&2
  echo "${legacy_next_refs}" >&2
  exit 1
fi

echo "[frontend-truth] Vite + src-v2 truth temiz."
