#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FEEDBACK_BASE_URL="${SERO_DESKTOP_FEEDBACK_BASE_URL:-https://seroguld.193.234.88.63.sslip.io}"
FEEDBACK_WS_URL="${SERO_DESKTOP_FEEDBACK_WS_URL:-${FEEDBACK_BASE_URL}}"
FEEDBACK_EMAIL="${SERO_DESKTOP_FEEDBACK_EMAIL:-info@seroguld.dk}"
FEEDBACK_CHANNEL="${SERO_DESKTOP_FEEDBACK_CHANNEL:-vps-feedback-pilot}"

export VITE_API_BASE_URL="${FEEDBACK_BASE_URL}"
export VITE_WS_BASE_URL="${FEEDBACK_WS_URL}"
export VITE_FEEDBACK_EMAIL="${FEEDBACK_EMAIL}"
export VITE_FEEDBACK_CHANNEL="${FEEDBACK_CHANNEL}"

echo "[feedback-release] kanal=${FEEDBACK_CHANNEL}"
echo "[feedback-release] api=${VITE_API_BASE_URL}"
echo "[feedback-release] ws=${VITE_WS_BASE_URL}"
echo "[feedback-release] feedback_email=${VITE_FEEDBACK_EMAIL}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    ;;
  *)
    echo "[feedback-release] Not: Windows .exe/NSIS çıktısı için bu script GitHub Actions windows-latest runner üzerinde çalıştırılmalıdır." >&2
    ;;
esac

bash "${ROOT_DIR}/scripts/release-desktop.sh"
