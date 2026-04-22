#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "${ROOT_DIR}/scripts/desktop-stop.sh" || true
exec bash "${ROOT_DIR}/scripts/desktop-dev.sh"
