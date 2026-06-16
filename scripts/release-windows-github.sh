#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_FILE="windows-desktop-release.yml"
DEFAULT_API_BASE_URL="${SEROGULD_WINDOWS_API_BASE_URL:-http://192.168.1.105:8100}"
DEFAULT_WS_BASE_URL="${SEROGULD_WINDOWS_WS_BASE_URL:-${DEFAULT_API_BASE_URL}}"

version_from_tauri() {
  sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "${ROOT_DIR}/desktop/src-tauri/tauri.conf.json" | head -n 1
}

version="${1:-$(version_from_tauri)}"
if [[ -z "${version}" ]]; then
  version="$(date -u +%Y%m%d-%H%M)"
fi

stamp="$(date -u +%Y%m%d-%H%M)"
tag="${version}"
if [[ "${tag}" != seroguld-desktop-v* ]]; then
  tag="seroguld-desktop-v${tag}-${stamp}"
fi

cd "${ROOT_DIR}"

if ! gh auth status >/dev/null 2>&1; then
  echo "[windows-release] gh auth hazir degil. Once: gh auth login" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
head_sha="$(git rev-parse HEAD)"

echo "[windows-release] branch: ${branch}"
echo "[windows-release] HEAD: ${head_sha}"
echo "[windows-release] tag: ${tag}"
echo "[windows-release] API: ${DEFAULT_API_BASE_URL}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "[windows-release] Not: takipli ama commitlenmemis dosyalar var; tag sadece HEAD'i icerir."
fi

git push origin "${branch}"

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "[windows-release] Tag zaten lokal var: ${tag}" >&2
  exit 1
fi

git tag -a "${tag}" -m "Sero Guld CRM Windows release ${tag}"
git push origin "${tag}"

echo "[windows-release] GitHub Actions tetiklendi: ${WORKFLOW_FILE}"
echo "[windows-release] Takip:"
echo "  gh run list --workflow ${WORKFLOW_FILE} --limit 3"
echo "  gh run watch --exit-status"
