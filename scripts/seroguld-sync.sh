#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${ROOT_DIR}/.seroguld-sync.env"

if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

SYNC_REMOTE_HOST="${SEROGULD_SYNC_REMOTE_HOST:-192.168.1.105}"
SYNC_REMOTE_USER="${SEROGULD_SYNC_REMOTE_USER:-lavescar-hp}"
SYNC_REMOTE_PORT="${SEROGULD_SYNC_REMOTE_PORT:-22}"
SYNC_REMOTE_DIR="${SEROGULD_SYNC_REMOTE_DIR:-/home/${SYNC_REMOTE_USER}/Clients/Recai_Demir/seroguld-crm}"
SYNC_BRANCH="${SEROGULD_SYNC_BRANCH:-$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD)}"
SYNC_REMOTE_URL="${SYNC_REMOTE_USER}@${SYNC_REMOTE_HOST}"
SSH_CMD=(ssh -p "${SYNC_REMOTE_PORT}" -o BatchMode=yes -o ConnectTimeout=8 -T)

if declare -p SEROGULD_SYNC_RSYNC_EXCLUDES >/dev/null 2>&1; then
  SYNC_RSYNC_EXCLUDES=("${SEROGULD_SYNC_RSYNC_EXCLUDES[@]}")
else
  SYNC_RSYNC_EXCLUDES=(
    ".venv/"
    "backend/.venv/"
    "frontend/node_modules/"
    "frontend/.vite/"
    "desktop/node_modules/"
    "desktop/dist/"
    "desktop/src-tauri/target/"
    "target/"
    "tools/rclone/rclone"
    "data/backups/"
    "data/restore-drill/"
    "data/offsite-mirror/"
    "data/logs/"
    "data/uploads/"
    "data/documents/"
    ".run/"
    "artifacts/"
  )
fi

remote_tar_flags() {
  local -a flags=(--exclude=.git)
  local pattern
  for pattern in "${SYNC_RSYNC_EXCLUDES[@]}"; do
    flags+=(--exclude="${pattern}")
  done
  printf '%s ' "${flags[@]}"
}

run_remote() {
  local cmd="$1"
  local remote_cmd="bash -lc ${cmd@Q}"
  "${SSH_CMD[@]}" "${SYNC_REMOTE_URL}" "${remote_cmd}"
}

extract_last_line() {
  local input="$1"
  printf '%s\n' "${input}" | tail -n 1 | tr -d '\r'
}

ensure_git_repo() {
  if ! git -C "${ROOT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[sync] Local repo geçersiz." >&2
    exit 1
  fi
}

ensure_remote_target() {
  run_remote "mkdir -p '${SYNC_REMOTE_DIR}'"
}

remote_repo_exists() {
  local marker
  marker="$(run_remote "[[ -d '${SYNC_REMOTE_DIR}/.git' ]] && echo present || echo missing")"
  [[ "$(extract_last_line "${marker}")" == "present" ]]
}

get_remote_branch() {
  local result
  result="$(run_remote "cd '${SYNC_REMOTE_DIR}' && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo missing")"
  extract_last_line "${result}"
}

get_remote_head() {
  local result
  result="$(run_remote "cd '${SYNC_REMOTE_DIR}' && git rev-parse HEAD 2>/dev/null || echo missing")"
  extract_last_line "${result}"
}

get_local_head() {
  git -C "${ROOT_DIR}" rev-parse HEAD
}

get_local_branch() {
  git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD
}

print_parity() {
  local local_branch remote_branch
  local local_head remote_head
  local merge_base

  local_branch="$(get_local_branch)"
  remote_branch="$(get_remote_branch)"
  local_head="$(get_local_head)"
  remote_head="$(get_remote_head)"

  echo "Git branch:"
  echo "  local:  ${local_branch}"
  echo "  remote: ${remote_branch}"
  echo "HEAD:"
  echo "  local:  ${local_head}"
  echo "  remote: ${remote_head}"

  if [[ "${remote_branch}" == "missing" || "${remote_head}" == "missing" ]]; then
    echo "[sync] Uzak repo hazır değil."
    return 1
  fi
  if [[ "${local_head}" == "${remote_head}" ]]; then
    echo "[sync] Eşit: local ve remote HEAD aynı."
    return 0
  fi

  if merge_base="$(git -C "${ROOT_DIR}" merge-base "${local_head}" "${remote_head}" 2>/dev/null || true)"; then
    if [[ "${merge_base}" == "${local_head}" ]]; then
      echo "[sync] Durum: remote bir adım önde."
      return 2
    fi
    if [[ "${merge_base}" == "${remote_head}" ]]; then
      echo "[sync] Durum: local bir adım önde."
      return 3
    fi
  fi

  echo "[sync] Durum: history ayrışmış (diverged)."
  return 4
}

send_workspace_without_git_to_remote() {
  local -a tar_opts=(
    tar
    -c
    -z
    -p
    -f -
    -C
    "${ROOT_DIR}"
  )
  local pattern
  for pattern in "${SYNC_RSYNC_EXCLUDES[@]}"; do
    tar_opts+=(--exclude="${pattern}")
  done
  tar_opts+=(--exclude=.git .)

  run_remote "cd '${SYNC_REMOTE_DIR}' && find . -mindepth 1 -name '.git' -prune -o -exec rm -rf {} + >/dev/null 2>&1 || true"
  "${tar_opts[@]}" | run_remote "cd '${SYNC_REMOTE_DIR}' && tar -xzf -"
}

send_git_to_remote() {
  tar -czf - -C "${ROOT_DIR}" .git | run_remote "cd '${SYNC_REMOTE_DIR}' && rm -rf .git && tar -xzf -"
}

copy_to_remote() {
  ensure_remote_target
  local branch local_head remote_head
  branch="$(get_local_branch)"
  remote_head="$(get_remote_head)"
  if [[ "${remote_head}" != "missing" ]]; then
    run_remote "git -C '${SYNC_REMOTE_DIR}' checkout '${branch}' >/dev/null 2>&1 || git -C '${SYNC_REMOTE_DIR}' checkout -B '${branch}'"
  else
    run_remote "git -C '${SYNC_REMOTE_DIR}' init >/dev/null 2>&1 || true"
    run_remote "git -C '${SYNC_REMOTE_DIR}' checkout -B '${branch}'"
  fi

  send_workspace_without_git_to_remote
  send_git_to_remote

  run_remote "git -C '${SYNC_REMOTE_DIR}' checkout '${branch}' >/dev/null 2>&1 || git -C '${SYNC_REMOTE_DIR}' checkout -b '${branch}'"
  run_remote "git -C '${SYNC_REMOTE_DIR}' config --local user.name \"${SYNC_REMOTE_USER}\" >/dev/null 2>&1 || true"
  run_remote "git -C '${SYNC_REMOTE_DIR}' config --local user.email \"${SYNC_REMOTE_USER}@$(hostname)\" >/dev/null 2>&1 || true"
  local_head="$(get_local_head)"
  echo "[sync] Yerelden uzak repoya aktarma tamamlandı. HEAD=${local_head}"
}

clean_local_workspace() {
  find "${ROOT_DIR}" -mindepth 1 -name '.git' -prune -o -exec rm -rf '{}' + >/dev/null 2>&1 || true
}

pull_workspace_from_remote() {
  local flags
  flags="$(remote_tar_flags)"
  "${SSH_CMD[@]}" "${SYNC_REMOTE_URL}" "cd '${SYNC_REMOTE_DIR}' && tar -czf - ${flags} ." | tar -xzf - -C "${ROOT_DIR}"
}

pull_git_from_remote() {
  rm -rf "${ROOT_DIR}/.git"
  "${SSH_CMD[@]}" "${SYNC_REMOTE_URL}" "cd '${SYNC_REMOTE_DIR}' && tar -czf - -C '${SYNC_REMOTE_DIR}' .git" | tar -xzf - -C "${ROOT_DIR}"
}

copy_to_local() {
  clean_local_workspace
  pull_workspace_from_remote
  pull_git_from_remote
  echo "[sync] Uzaktaki repo lokal workspace'e geri yüklendi."
}

bootstrap_remote() {
  echo "[sync] Uzak repo bootstrap ediliyor..."
  ensure_remote_target
  if remote_repo_exists; then
    local remote_head remote_branch
    remote_head="$(get_remote_head)"
    remote_branch="$(get_remote_branch)"
    if [[ "${remote_head}" != "missing" && "${remote_branch}" != "missing" && "${remote_branch}" != "HEAD" ]]; then
      echo "[sync] Uzak repo hazır: ${remote_branch}/${remote_head}"
      return 0
    fi
    echo "[sync] Uzak repo boş/bozuk, yeniden eşitleniyor..."
    copy_to_remote
    return 0
  fi
  copy_to_remote
  run_remote "cd '${SYNC_REMOTE_DIR}' && git checkout '${SYNC_BRANCH}'"
  echo "[sync] Bootstrap tamam."
}

assert_matching_branch() {
  local local_branch remote_branch
  local_branch="$(get_local_branch)"
  remote_branch="$(get_remote_branch)"
  if [[ "${remote_branch}" == "missing" || "${remote_branch}" == "HEAD" ]]; then
    run_remote "cd '${SYNC_REMOTE_DIR}' && git checkout -B '${local_branch}'"
    remote_branch="${local_branch}"
  fi
  if [[ "${local_branch}" != "${remote_branch}" ]]; then
    echo "[sync] Branch uyumsuz: local=${local_branch}, remote=${remote_branch}" >&2
    echo "[sync] Senkron öncesi branch'leri eşitleyin (git checkout ${SYNC_BRANCH})." >&2
    exit 1
  fi
}

cmd_status() {
  ensure_git_repo
  if ! remote_repo_exists; then
    echo "[sync] Uzak repo bulunamadı: ${SYNC_REMOTE_DIR}"
    return 1
  fi
  print_parity
}

cmd_push() {
  ensure_git_repo
  if ! remote_repo_exists; then
    bootstrap_remote
    return 0
  fi
  assert_matching_branch
  copy_to_remote
}

cmd_pull() {
  ensure_git_repo
  if ! remote_repo_exists; then
    echo "[sync] Uzak repo bulunamadı, önce bootstrap çalıştırın: make sync-bootstrap" >&2
    exit 1
  fi
  assert_matching_branch
  copy_to_local
}

cmd_reconcile() {
  ensure_git_repo
  if ! remote_repo_exists; then
    bootstrap_remote
    return 0
  fi
  assert_matching_branch
  if print_parity; then
    return 0
  fi
  local parity_status=$?
  if [[ "${parity_status}" -eq 2 ]]; then
    echo "[sync] Remote önde, pull yapılıyor."
    copy_to_local
    return 0
  fi
  if [[ "${parity_status}" -eq 3 ]]; then
    echo "[sync] Local önde, push yapılıyor."
    copy_to_remote
    return 0
  fi

  echo "[sync] İki tarafta farklı ama divergence var; otomatik merge yapmıyoruz." >&2
  echo "[sync] Durum: merge-base=$(git -C "${ROOT_DIR}" merge-base "$(get_local_head)" "$(get_remote_head)")" >&2
  exit 1
}

usage() {
  cat <<EOF
Kullanım:
  bash scripts/seroguld-sync.sh [status|bootstrap|push|pull|reconcile]

Komutlar:
  status     Local/remote branch ve HEAD durumunu karşılaştır.
  bootstrap  Uzak dizine çalışır repo kopyası kur.
  push       Yereldeki HEAD'i uzakta aynen güncelle (branch eşleşmelerini korur).
  pull       Uzaktaki dosyaları lokal workspace'e çeker.
  reconcile  Duruma göre push/pull karar verir:
              - remote önde => pull
              - local önde => push
              - divergence => durur
EOF
}

COMMAND="${1:-status}"

case "${COMMAND}" in
  status)
    cmd_status
    ;;
  bootstrap)
    bootstrap_remote
    ;;
  push)
    cmd_push
    ;;
  pull)
    cmd_pull
    ;;
  reconcile)
    cmd_reconcile
    ;;
  *)
    usage
    exit 1
    ;;
esac
