#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_DIR="${BACKEND_DIR}/.venv"
REQ_HASH_FILE="${VENV_DIR}/.requirements_hash"
NPM_HASH_FILE="${FRONTEND_DIR}/node_modules/.package_lock_hash"

if [[ -z "${PYTHON_BIN:-}" ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="python3.12"
  else
    PYTHON_BIN="python3"
  fi
fi

RUN_BACKEND=1
RUN_FRONTEND=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-only)
      RUN_FRONTEND=0
      shift
      ;;
    --frontend-only)
      RUN_BACKEND=0
      shift
      ;;
    *)
      echo "Bilinmeyen parametre: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${RUN_BACKEND}" -eq 1 ]]; then
  target_py_version="$("${PYTHON_BIN}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

  if [[ -d "${VENV_DIR}" ]]; then
    current_py_version="$("${VENV_DIR}/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "")"
    if [[ "${current_py_version}" != "${target_py_version}" ]]; then
      echo "[test] .venv Python sürümü (${current_py_version}) hedefle uyuşmuyor (${target_py_version}), yeniden oluşturuluyor..."
      rm -rf "${VENV_DIR}"
    fi
  fi

  if [[ ! -d "${VENV_DIR}" ]]; then
    echo "[test] backend .venv bulunamadı, oluşturuluyor (${PYTHON_BIN})..."
    "${PYTHON_BIN}" -m venv "${VENV_DIR}"
  fi

  current_req_hash="$(sha256sum "${BACKEND_DIR}/requirements.txt" | awk '{print $1}')"
  installed_req_hash=""
  if [[ -f "${REQ_HASH_FILE}" ]]; then
    installed_req_hash="$(cat "${REQ_HASH_FILE}")"
  fi

  if [[ "${current_req_hash}" != "${installed_req_hash}" ]]; then
    echo "[test] backend bağımlılıkları kuruluyor..."
    "${VENV_DIR}/bin/python" -m pip install --upgrade pip
    "${VENV_DIR}/bin/python" -m pip install -r "${BACKEND_DIR}/requirements.txt"
    echo "${current_req_hash}" > "${REQ_HASH_FILE}"
  fi

  echo "[test] backend pytest çalışıyor..."
  cd "${BACKEND_DIR}"
  "${VENV_DIR}/bin/python" -m pytest -q
fi

if [[ "${RUN_FRONTEND}" -eq 1 ]]; then
  current_npm_hash="$(sha256sum "${FRONTEND_DIR}/package-lock.json" | awk '{print $1}')"
  installed_npm_hash=""
  if [[ -f "${NPM_HASH_FILE}" ]]; then
    installed_npm_hash="$(cat "${NPM_HASH_FILE}")"
  fi

  if [[ ! -d "${FRONTEND_DIR}/node_modules" || "${current_npm_hash}" != "${installed_npm_hash}" ]]; then
    echo "[test] frontend bağımlılıkları güncel değil, npm ci çalıştırılıyor..."
    cd "${FRONTEND_DIR}"
    npm ci
    echo "${current_npm_hash}" > "${NPM_HASH_FILE}"
  fi

  echo "[test] frontend typecheck çalışıyor..."
  cd "${FRONTEND_DIR}"
  npm run typecheck

  echo "[test] frontend vitest çalışıyor..."
  npm test
fi

echo "[test] tüm kontroller başarılı."
