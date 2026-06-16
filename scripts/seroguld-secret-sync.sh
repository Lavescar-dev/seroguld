#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/.seroguld-sync.env"
RUN_DIR="${ROOT_DIR}/.run"

if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

mkdir -p "${RUN_DIR}"

SYNC_REMOTE_HOST="${SEROGULD_SYNC_REMOTE_HOST:-192.168.1.105}"
SYNC_REMOTE_USER="${SEROGULD_SYNC_REMOTE_USER:-lavescar-hp}"
SYNC_REMOTE_PORT="${SEROGULD_SYNC_REMOTE_PORT:-22}"
SYNC_REMOTE_DIR="${SEROGULD_SYNC_REMOTE_DIR:-/home/${SYNC_REMOTE_USER}/Clients/Recai_Demir/seroguld-crm}"
SYNC_REMOTE_URL="${SYNC_REMOTE_USER}@${SYNC_REMOTE_HOST}"
SYNC_REMOTE_TARGET="${SYNC_REMOTE_DIR}"
SECRET_BUNDLE_NAME="${SEROGULD_SYNC_SECRET_BUNDLE:-seroguld-secrets.tar.gz}"
SECRET_BUNDLE_PATH="/.run/seroguld-secrets/${SECRET_BUNDLE_NAME}.gpg"
SEROGULD_SYNC_SECRET_PASSPHRASE="${SEROGULD_SYNC_SECRETS_PASSPHRASE:-}"

SYNC_SECRET_FILES=()
if declare -p SEROGULD_SYNC_SECRET_FILES >/dev/null 2>&1; then
  SYNC_SECRET_FILES=("${SEROGULD_SYNC_SECRET_FILES[@]}")
else
  SYNC_SECRET_FILES=(
    ".env"
    ".env.local"
    ".env.*.local"
    "docs/*vps*"
    "docs/*secret*"
    "docs/*credential*"
    "ops/*"
  )
fi

SSH_CMD=(ssh -p "${SYNC_REMOTE_PORT}" -o BatchMode=yes -o ConnectTimeout=8 -T)

run_remote() {
  local cmd="$1"
  "${SSH_CMD[@]}" "${SYNC_REMOTE_URL}" "bash -lc ${cmd@Q}"
}

extract_last_line() {
  local value="$1"
  printf '%s\n' "${value}" | tail -n 1 | tr -d '\r'
}

ensure_tools() {
  if ! command -v gpg >/dev/null 2>&1; then
    echo "[secret-sync] gpg bulunamadı." >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "[secret-sync] tar bulunamadı." >&2
    exit 1
  fi
}

collect_secret_files() {
  local -a selected
  local pattern raw path rel
  selected=()

  shopt -s nullglob dotglob
  for pattern in "${SYNC_SECRET_FILES[@]}"; do
    for path in ${ROOT_DIR}/${pattern}; do
      if [[ -e "${path}" ]]; then
        rel="${path#${ROOT_DIR}/}"
        if ! printf '%s\0' "${selected[@]}" | grep -qz -- "${rel}"; then
          selected+=("${rel}")
        fi
      fi
    done
  done
  shopt -u nullglob dotglob

  if [[ "${#selected[@]}" -eq 0 ]]; then
    echo "[secret-sync] Aktarım için eşleşen hassas dosya bulunamadı." >&2
    exit 1
  fi

  printf '%s\n' "${selected[@]}"
}

make_bundle() {
  local work_dir
  local clear_path
  local -a files=()
  local path

  mapfile -t files < <(collect_secret_files)

  work_dir="$(mktemp -d)"
  for path in "${files[@]}"; do
    mkdir -p "${work_dir}/$(dirname "${path}")"
    cp -a "${ROOT_DIR}/${path}" "${work_dir}/${path}"
  done
  clear_path="${work_dir}/${SECRET_BUNDLE_NAME}"
  (cd "${work_dir}" && tar --warning=no-file-changed -czf "${clear_path}" .)
  echo "${clear_path}|||${work_dir}"
}

encrypt_bundle() {
  local clear_bundle="$1"
  local encrypted_bundle="${clear_bundle}.gpg"

  if [[ -n "${SEROGULD_SYNC_SECRET_PASSPHRASE}" ]]; then
    gpg --batch --yes --pinentry-mode loopback \
      --passphrase "${SEROGULD_SYNC_SECRET_PASSPHRASE}" \
      --symmetric --cipher-algo AES256 \
      --output "${encrypted_bundle}" "${clear_bundle}"
  else
    gpg --symmetric --cipher-algo AES256 --output "${encrypted_bundle}" "${clear_bundle}"
  fi
  echo "${encrypted_bundle}"
}

decrypt_bundle() {
  local encrypted_bundle="$1"
  local clear_bundle="${encrypted_bundle%.gpg}"

  if [[ -n "${SEROGULD_SYNC_SECRET_PASSPHRASE}" ]]; then
    gpg --batch --yes --pinentry-mode loopback \
      --passphrase "${SEROGULD_SYNC_SECRET_PASSPHRASE}" \
      --decrypt "${encrypted_bundle}" > "${clear_bundle}"
  else
    gpg --decrypt "${encrypted_bundle}" > "${clear_bundle}"
  fi
  echo "${clear_bundle}"
}

backup_existing_secret_files() {
  local -a files=()
  local path
  local backup_dir="${RUN_DIR}/secret-backup-$(date -u +%Y%m%d-%H%M%S)"
  mapfile -t files < <(collect_secret_files)

  for path in "${files[@]}"; do
    if [[ -e "${ROOT_DIR}/${path}" ]]; then
      mkdir -p "${backup_dir}/$(dirname "${path}")"
      cp -a "${ROOT_DIR}/${path}" "${backup_dir}/${path}"
    fi
  done
  echo "[secret-sync] Mevcut dosyalar yedeklendi: ${backup_dir}"
}

remote_bundle_exists() {
  local out
  out="$(run_remote "if [[ -f '${SYNC_REMOTE_TARGET}${SECRET_BUNDLE_PATH}' ]]; then echo '${SECRET_BUNDLE_NAME}.gpg'; fi")"
  [[ -n "$(extract_last_line "${out}")" ]]
}

push_secrets() {
  ensure_tools
  if ! remote_bundle_exists; then
    run_remote "mkdir -p '$(dirname "${SYNC_REMOTE_TARGET}${SECRET_BUNDLE_PATH}")'"
  fi

  local work
  work="$(make_bundle)"
  local clear_bundle="${work%%|||*}"
  local work_dir="${work##*|||}"
  local encrypted_bundle
  encrypted_bundle="$(encrypt_bundle "${clear_bundle}")"

  trap 'rm -rf "'"${work_dir}"'"' EXIT

  cat "${encrypted_bundle}" | "${SSH_CMD[@]}" "${SYNC_REMOTE_URL}" "cat > '${SYNC_REMOTE_TARGET}${SECRET_BUNDLE_PATH}'"
  echo "[secret-sync] push tamam: ${SECRET_BUNDLE_NAME}.gpg"
  echo "[secret-sync] Uzak hedef: ${SYNC_REMOTE_TARGET}${SECRET_BUNDLE_PATH}"
}

pull_secrets() {
  ensure_tools
  if ! remote_bundle_exists; then
    echo "[secret-sync] Uzakta şifreli bundle bulunamadı: ${SYNC_REMOTE_TARGET}${SECRET_BUNDLE_PATH}" >&2
    exit 1
  fi

  local work
  work="$(mktemp -d)"
  local encrypted_local="${work}/$(basename "${SECRET_BUNDLE_NAME}.gpg")"
  local clear_bundle

  trap 'rm -rf "'"${work}"'"' EXIT

  "${SSH_CMD[@]}" "${SYNC_REMOTE_URL}" "cat '${SYNC_REMOTE_TARGET}${SECRET_BUNDLE_PATH}'" > "${encrypted_local}"
  clear_bundle="$(decrypt_bundle "${encrypted_local}")"
  backup_existing_secret_files
  tar -xzf "${clear_bundle}" -C "${ROOT_DIR}"
  echo "[secret-sync] pull tamam: local workspace güncellendi."
}

usage() {
  cat <<EOF
Kullanım:
  bash scripts/seroguld-secret-sync.sh [push|pull]

push -> Yereldeki hassas dosyaları şifreli bundle olarak uzak makineye gönderir
pull -> Uzakta bulunan şifreli bundle'ı indirip çözüp lokal workspace'e uygular
EOF
}

ACTION="${1:-push}"
case "${ACTION}" in
  push)
    push_secrets
    ;;
  pull)
    pull_secrets
    ;;
  *)
    usage
    exit 1
    ;;
esac
