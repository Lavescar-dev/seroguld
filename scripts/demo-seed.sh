#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${DEMO_BACKEND_PORT:-8100}"
BASE_URL="${DEMO_BASE_URL:-http://127.0.0.1:${BACKEND_PORT}}"
CUSTOMERS="${DEMO_CUSTOMERS:-20}"
PRODUCTS="${DEMO_PRODUCTS:-20}"

python3 "${ROOT_DIR}/scripts/seed_mock_data.py" \
  --base-url "${BASE_URL}" \
  --customers "${CUSTOMERS}" \
  --products "${PRODUCTS}" \
  "$@"
