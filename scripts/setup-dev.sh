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
FORCE_INSTALL=0

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
    --force-install)
      FORCE_INSTALL=1
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
      echo "[setup] .venv Python sürümü (${current_py_version}) hedefle uyuşmuyor (${target_py_version}), yeniden oluşturuluyor..."
      rm -rf "${VENV_DIR}"
    fi
  fi

  if [[ ! -d "${VENV_DIR}" ]]; then
    echo "[setup] backend .venv oluşturuluyor (${PYTHON_BIN})..."
    "${PYTHON_BIN}" -m venv "${VENV_DIR}"
  fi

  echo "[setup] backend pip güncelleniyor..."
  "${VENV_DIR}/bin/python" -m pip install --upgrade pip

  current_req_hash="$(sha256sum "${BACKEND_DIR}/requirements.txt" | awk '{print $1}')"
  installed_req_hash=""
  if [[ -f "${REQ_HASH_FILE}" ]]; then
    installed_req_hash="$(cat "${REQ_HASH_FILE}")"
  fi

  if [[ "${FORCE_INSTALL}" -eq 1 || "${current_req_hash}" != "${installed_req_hash}" ]]; then
    echo "[setup] backend bağımlılıkları kuruluyor..."
    "${VENV_DIR}/bin/python" -m pip install -r "${BACKEND_DIR}/requirements.txt"
    echo "${current_req_hash}" > "${REQ_HASH_FILE}"
  else
    echo "[setup] backend bağımlılıkları güncel (zorlamak için --force-install)."
  fi
fi

if [[ "${RUN_FRONTEND}" -eq 1 ]]; then
  current_npm_hash="$(sha256sum "${FRONTEND_DIR}/package-lock.json" | awk '{print $1}')"
  installed_npm_hash=""
  if [[ -f "${NPM_HASH_FILE}" ]]; then
    installed_npm_hash="$(cat "${NPM_HASH_FILE}")"
  fi

  if [[ ! -d "${FRONTEND_DIR}/node_modules" || "${FORCE_INSTALL}" -eq 1 || "${current_npm_hash}" != "${installed_npm_hash}" ]]; then
    echo "[setup] frontend bağımlılıkları kuruluyor..."
    cd "${FRONTEND_DIR}"
    npm ci
    echo "${current_npm_hash}" > "${NPM_HASH_FILE}"
  else
    echo "[setup] frontend bağımlılıkları güncel."
  fi
fi

echo "[setup] tamamlandı."
