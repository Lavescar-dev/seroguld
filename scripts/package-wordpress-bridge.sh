#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="${ROOT_DIR}/ops/wordpress/seroguld-crm-bridge"
PLUGIN_FILE="${PLUGIN_DIR}/seroguld-crm-bridge.php"
RUN_DIR="${ROOT_DIR}/.run"
PACKAGE_ROOT="${RUN_DIR}/wordpress-bridge-package"

if [[ ! -f "${PLUGIN_FILE}" ]]; then
  echo "[wordpress-bridge-package] plugin file bulunamadı: ${PLUGIN_FILE}" >&2
  exit 1
fi

if ! command -v php >/dev/null 2>&1; then
  echo "[wordpress-bridge-package] php bulunamadı." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "[wordpress-bridge-package] zip bulunamadı." >&2
  exit 1
fi

php -l "${PLUGIN_FILE}" >/dev/null

version="$(sed -n "s/^define('SEROGULD_CRM_BRIDGE_VERSION', '\\([^']*\\)');$/\\1/p" "${PLUGIN_FILE}" | head -n 1)"
version="${version:-dev}"
zip_path="${RUN_DIR}/seroguld-crm-bridge-${version}.zip"

rm -rf "${PACKAGE_ROOT}"
mkdir -p "${PACKAGE_ROOT}"
cp -R "${PLUGIN_DIR}" "${PACKAGE_ROOT}/seroguld-crm-bridge"
find "${PACKAGE_ROOT}" -type f -name ".DS_Store" -delete

rm -f "${zip_path}"
(
  cd "${PACKAGE_ROOT}"
  zip -qr "${zip_path}" seroguld-crm-bridge
)

echo "[wordpress-bridge-package] tamamlandı"
echo "  zip: ${zip_path}"
