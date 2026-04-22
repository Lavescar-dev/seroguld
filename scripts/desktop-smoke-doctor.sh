#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOC_PATH="${ROOT_DIR}/docs/DESKTOP_SMOKE_PREREQUISITES_TR.md"

failures=0

check_binary() {
  local label="$1"
  local binary="$2"
  if command -v "${binary}" >/dev/null 2>&1; then
    printf '[desktop-smoke-doctor] OK    %s -> %s\n' "${label}" "$(command -v "${binary}")"
  else
    printf '[desktop-smoke-doctor] MISS  %s (%s)\n' "${label}" "${binary}" >&2
    failures=$((failures + 1))
  fi
}

detect_distro_hint() {
  local distro_id=""
  local like_id=""
  if [[ -f /etc/os-release ]]; then
    distro_id="$(awk -F= '$1=="ID" {gsub(/"/, "", $2); print $2}' /etc/os-release)"
    like_id="$(awk -F= '$1=="ID_LIKE" {gsub(/"/, "", $2); print $2}' /etc/os-release)"
  fi

  case "${distro_id} ${like_id}" in
    *ubuntu*|*debian*)
      echo "sudo apt-get install -y webkit2gtk-driver"
      ;;
    *fedora*|*rhel*)
      echo "sudo dnf install -y webkit2gtk4.1-devel"
      ;;
    *arch*)
      echo "sudo pacman -S webkit2gtk"
      ;;
    *)
      echo "WEBKIT_WEBDRIVER_BIN=/abs/path/WebKitWebDriver make desktop-smoke"
      ;;
  esac
}

resolve_webkit_driver() {
  if [[ -n "${WEBKIT_WEBDRIVER_BIN:-}" ]]; then
    if [[ -x "${WEBKIT_WEBDRIVER_BIN}" ]]; then
      echo "${WEBKIT_WEBDRIVER_BIN}"
      return 0
    fi
    printf '[desktop-smoke-doctor] MISS  WEBKIT_WEBDRIVER_BIN set but not executable -> %s\n' "${WEBKIT_WEBDRIVER_BIN}" >&2
  fi

  if command -v WebKitWebDriver >/dev/null 2>&1; then
    command -v WebKitWebDriver
    return 0
  fi

  local candidate
  for candidate in \
    "/usr/bin/WebKitWebDriver" \
    "/usr/libexec/webkit2gtk-4.1/WebKitWebDriver" \
    "/usr/libexec/webkit2gtk-4.0/WebKitWebDriver" \
    "/usr/lib64/webkit2gtk-4.1/WebKitWebDriver" \
    "/app/bin/WebKitWebDriver"
  do
    if [[ -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done

  return 1
}

echo "[desktop-smoke-doctor] Desktop smoke prerequisites kontrol ediliyor..."
check_binary "python3" "python3"
check_binary "node" "node"
check_binary "npm" "npm"
check_binary "cargo" "cargo"

if command -v tauri-driver >/dev/null 2>&1; then
  printf '[desktop-smoke-doctor] OK    tauri-driver -> %s\n' "$(command -v tauri-driver)"
else
  printf '[desktop-smoke-doctor] MISS  tauri-driver (cargo install tauri-driver --locked)\n' >&2
  failures=$((failures + 1))
fi

if webkit_driver="$(resolve_webkit_driver)"; then
  printf '[desktop-smoke-doctor] OK    WebKitWebDriver -> %s\n' "${webkit_driver}"
else
  printf '[desktop-smoke-doctor] MISS  WebKitWebDriver\n' >&2
  printf '[desktop-smoke-doctor] HINT  %s\n' "$(detect_distro_hint)" >&2
  printf '[desktop-smoke-doctor] DOC   %s\n' "${DOC_PATH}" >&2
  failures=$((failures + 1))
fi

if [[ ${failures} -gt 0 ]]; then
  printf '[desktop-smoke-doctor] FAIL  %s prerequisite eksik.\n' "${failures}" >&2
  exit 1
fi

echo "[desktop-smoke-doctor] Hazır. make desktop-smoke çalıştırabilirsiniz."
