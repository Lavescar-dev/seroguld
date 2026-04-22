#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_FILE="${DESKTOP_SESSION_FILE:-${ROOT_DIR}/.run/desktop-dev-session.json}"

if [[ ! -f "${SESSION_FILE}" ]]; then
  echo "[desktop] aktif desktop-dev session bulunamadı."
  exit 0
fi

python3 - <<'PY' "${SESSION_FILE}"
import json
import os
import signal
import sys
from pathlib import Path

session_path = Path(sys.argv[1])
payload = json.loads(session_path.read_text(encoding="utf-8"))

def alive(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False

print("[desktop] kanonik session dosyası bulundu:")
print(f"  mode         : {payload.get('mode', 'desktop-dev')}")
print(f"  started_at   : {payload.get('started_at', '—')}")
print(f"  backend_url  : {payload.get('backend_url', '—')}")
print(f"  frontend_url : {payload.get('frontend_url', '—')}")
print(f"  frontend_mode: {payload.get('frontend_mode', '—')}")
print(f"  tauri_mode   : {payload.get('tauri_mode', '—')}")
for key in ("backend_pid", "frontend_pid", "tauri_pid"):
    pid = payload.get(key)
    print(f"  {key:<12}: {pid or '—'} ({'alive' if alive(pid) else 'dead'})")

tracked = [payload.get("backend_pid"), payload.get("frontend_pid"), payload.get("tauri_pid")]
tracked = [pid for pid in tracked if pid]
if tracked and not any(alive(pid) for pid in tracked):
    print("[desktop] uyarı: session dosyası stale, süreçlerin tamamı düşmüş.")
PY
