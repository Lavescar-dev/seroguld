#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_FILE="${DESKTOP_SESSION_FILE:-${ROOT_DIR}/.run/desktop-dev-session.json}"

if [[ ! -f "${SESSION_FILE}" ]]; then
  echo "[desktop] durdurulacak aktif desktop-dev session bulunamadı."
  exit 0
fi

python3 - <<'PY' "${SESSION_FILE}"
import json
import os
import signal
import sys
import time
from pathlib import Path

session_path = Path(sys.argv[1])
payload = json.loads(session_path.read_text(encoding="utf-8"))
pids = [payload.get("tauri_pid"), payload.get("frontend_pid"), payload.get("backend_pid")]

def alive(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False

for pid in pids:
    if alive(pid):
        os.kill(int(pid), signal.SIGTERM)

deadline = time.time() + 3
while time.time() < deadline:
    if not any(alive(pid) for pid in pids):
        break
    time.sleep(0.1)

for pid in pids:
    if alive(pid):
        os.kill(int(pid), signal.SIGKILL)

try:
    session_path.unlink()
except FileNotFoundError:
    pass
PY

echo "[desktop] desktop-dev session durduruldu."
