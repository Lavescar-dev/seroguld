#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${ROOT_DIR}/tools/rclone"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

RCLONE_VERSION="${RCLONE_VERSION:-v1.69.3}"

arch="$(uname -m)"
case "${arch}" in
  x86_64|amd64)
    rclone_arch="amd64"
    ;;
  aarch64|arm64)
    rclone_arch="arm64"
    ;;
  *)
    echo "[setup-rclone] Desteklenmeyen mimari: ${arch}" >&2
    exit 1
    ;;
esac

zip_name="rclone-${RCLONE_VERSION}-linux-${rclone_arch}.zip"
download_url="https://downloads.rclone.org/${RCLONE_VERSION}/${zip_name}"

mkdir -p "${TOOLS_DIR}"

echo "[setup-rclone] indiriliyor: ${download_url}"
curl -fsSL "${download_url}" -o "${TMP_DIR}/rclone.zip"

if command -v unzip >/dev/null 2>&1; then
  unzip -q "${TMP_DIR}/rclone.zip" -d "${TMP_DIR}"
else
  python3 - "${TMP_DIR}/rclone.zip" "${TMP_DIR}" <<'PY'
import sys
import zipfile
from pathlib import Path

zip_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
with zipfile.ZipFile(zip_path) as zf:
    zf.extractall(out_dir)
PY
fi

extracted_dir="$(find "${TMP_DIR}" -maxdepth 1 -type d -name "rclone-*-linux-${rclone_arch}" | head -n 1)"
if [[ -z "${extracted_dir}" ]]; then
  echo "[setup-rclone] Çıkarılan klasör bulunamadı." >&2
  exit 1
fi

cp "${extracted_dir}/rclone" "${TOOLS_DIR}/rclone"
chmod +x "${TOOLS_DIR}/rclone"

echo "[setup-rclone] tamamlandı"
"${TOOLS_DIR}/rclone" version | head -n 2
