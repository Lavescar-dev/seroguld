#!/usr/bin/env bash
# report-archive-rotate.sh — Sero Guld CRM 00-LATEST / 99-ARCHIVE güvenli rotasyonu
# Repo-local yardımcı; uygulama runtime'ına BAĞLI DEĞİLDİR.
# Kullanım:
#   scripts/report-archive-rotate.sh --report-dir <çalışma raporu dizini> --task-slug <slug> [--dry-run] [--verify]
# Politika: docs/REPORT_ARCHIVE_POLICY.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_ROOT_DEFAULT="$REPO_ROOT/../reports/SeroGuldCRM"
REPORT_ROOT="${REPORT_ROOT:-$REPORT_ROOT_DEFAULT}"
REPORT_DIR=""
TASK_SLUG=""
DRY_RUN=0
VERIFY_ONLY=0

log() { printf '[rotate] %s\n' "$*"; }
die() { printf '[rotate] HATA: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --report-dir) REPORT_DIR="$2"; shift 2;;
    --task-slug)  TASK_SLUG="$2"; shift 2;;
    --report-root) REPORT_ROOT="$2"; shift 2;;
    --dry-run)    DRY_RUN=1; shift;;
    --verify)     VERIFY_ONLY=1; shift;;
    *) die "bilinmeyen argüman: $1";;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || die "$1 bulunamadı"; }
need 7z; need sha256sum

if [ "$VERIFY_ONLY" = 1 ]; then
  log "VERIFY modu: $REPORT_ROOT"
  ls -la "$REPORT_ROOT"
  for f in "$REPORT_ROOT"/*.7z; do
    [ -e "$f" ] || continue
    7z t "$f" >/dev/null && log "7z t PASS: $(basename "$f")" || die "7z t FAIL: $f"
  done
  for f in "$REPORT_ROOT"/*.sha256; do
    [ -e "$f" ] || continue
    (cd "$REPORT_ROOT" && sha256sum -c "$(basename "$f")") || die "sha256 FAIL: $f"
  done
  log "VERIFY tamam."
  exit 0
fi

[ -n "$REPORT_DIR" ] || die "--report-dir gerekli"
[ -n "$TASK_SLUG" ] || die "--task-slug gerekli"
[ -d "$REPORT_DIR" ] || die "rapor dizini yok: $REPORT_DIR"
mkdir -p "$REPORT_ROOT"

TODAY="$(date +%Y%m%d)"
STAMP="$(date +%Y%m%d-%H%M%S)"
LATEST_NAME="00-LATEST-seroguld-crm-${TASK_SLUG}.7z"
ARCHIVE_NAME="99-ARCHIVE-seroguld-crm-reports-through-${TODAY}.7z"

log "REPORT_ROOT=$REPORT_ROOT"
log "Mevcut içerik:"
ls -la "$REPORT_ROOT" || true

# Başka projelerin paketlerine dokunma: yalnız seroguld-crm desenleri işlenir.
shopt -s nullglob
OLD_LATEST=( "$REPORT_ROOT"/00-LATEST-seroguld-crm-*.7z )
OLD_ARCHIVE=( "$REPORT_ROOT"/99-ARCHIVE-seroguld-crm-reports-through-*.7z )

# Eski paket doğrulamaları
for f in "${OLD_LATEST[@]}" "${OLD_ARCHIVE[@]}"; do
  7z t "$f" >/dev/null || die "eski paket bozuk: $f"
  log "eski paket OK: $(basename "$f")"
done

# Disk alanı: rapor dizini + eski paketler toplamının 3 katı boş alan olsun
NEED_KB=$(( $(du -sk "$REPORT_DIR" | cut -f1) * 3 + 1024 ))
AVAIL_KB=$(df -k "$REPORT_ROOT" | awk 'NR==2{print $4}')
[ "$AVAIL_KB" -gt "$NEED_KB" ] || die "yetersiz disk: gerekli ~${NEED_KB}K, mevcut ${AVAIL_KB}K"

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/sg-rotate.XXXXXX")"
log "staging: $STAGING"

if [ "$DRY_RUN" = 1 ]; then
  log "DRY-RUN: ${#OLD_LATEST[@]} eski 00 paketi arşivlenecek, yeni paketler:"
  log "  $LATEST_NAME"
  log "  $ARCHIVE_NAME"
  rm -rf "$STAGING"
  exit 0
fi

# --- 99-ARCHIVE staging ---
WORK="$STAGING/archive"
mkdir -p "$WORK/runs"
PREV_COUNT=0
MANIFEST_ENTRIES="[]"

if [ "${#OLD_ARCHIVE[@]}" -gt 0 ]; then
  # En güncel eski 99'u aç (birden fazlaysa en yeni mtime)
  LATEST_OLD_ARCHIVE="$(ls -t "${OLD_ARCHIVE[@]}" | head -1)"
  log "eski 99 açılıyor: $(basename "$LATEST_OLD_ARCHIVE")"
  7z x -y -o"$WORK" "$LATEST_OLD_ARCHIVE" >/dev/null
  [ -f "$WORK/archive-manifest.json" ] && MANIFEST_ENTRIES="$(cat "$WORK/archive-manifest.json")"
fi

for f in "${OLD_LATEST[@]}"; do
  SUM="$(sha256sum "$f" | awk '{print $1}')"
  RUN_DIR="$WORK/runs/${STAMP}-$(basename "$f" .7z)"
  mkdir -p "$RUN_DIR"
  cp -p "$f" "$RUN_DIR/"
  [ -f "$f.sha256" ] && cp -p "$f.sha256" "$RUN_DIR/" || true
  PREV_COUNT=$((PREV_COUNT+1))
  log "arşive eklendi: $(basename "$f") ($SUM)"
done

python3 - "$WORK" "$STAMP" "$PREV_COUNT" "${OLD_LATEST[@]+"${OLD_LATEST[@]}"}" <<'PYEOF'
import json, sys, os, hashlib, datetime
work, stamp = sys.argv[1], sys.argv[2]
old_latest = [p for p in (sys.argv[4] if len(sys.argv) > 4 else "").split(" ") if p]
mf_path = os.path.join(work, "archive-manifest.json")
manifest = {"project_name": "Sero Guld CRM", "project_slug": "seroguld-crm",
            "archive_checksum_scope": "external-sidecar", "archive_sha256": None,
            "updated": stamp, "runs": []}
if os.path.exists(mf_path):
    try:
        manifest = json.load(open(mf_path))
    except Exception:
        pass
manifest["updated"] = stamp
existing = {r.get("sha256") for r in manifest.get("runs", [])}
for f in old_latest:
    if not f: continue
    h = hashlib.sha256(open(f, "rb").read()).hexdigest()
    if h in existing:
        continue
    manifest.setdefault("runs", []).append({
        "file": os.path.basename(f),
        "sha256": h,
        "archived_at": stamp,
        "source_path": os.path.abspath(f),
    })
json.dump(manifest, open(mf_path, "w"), indent=2, ensure_ascii=False)
idx = open(os.path.join(work, "INDEX.md"), "w")
idx.write("# Sero Guld CRM — 99-ARCHIVE İndeksi\n\n")
idx.write(f"Güncelleme: {stamp}\n\n")
idx.write(f"Toplam arşivlenmiş çalıştırma paketi: {len(manifest.get('runs', []))}\n\n")
for r in manifest.get("runs", []):
    name = r.get("file") or os.path.basename(r.get("source_path", "")) or r.get("run_id", "legacy-run")
    checksum = r.get("sha256")
    if not checksum:
        payloads = r.get("payload_files", [])
        package = next((p for p in payloads if str(p.get("path", "")).endswith(".7z")), None)
        checksum = package.get("sha256") if package else "unknown"
    archived_at = r.get("archived_at") or r.get("acquired_at") or "unknown"
    idx.write(f"- `{name}` — sha256 `{checksum[:16]}…` — arşivlenme {archived_at}\n")
if not manifest.get("runs"):
    idx.write("\n_Bu arşivde henüz önceki çalıştırma paketi yok._\n")
idx.close()
PYEOF

# --- Yeni 99 (geçici adla) ---
NEW99="$STAGING/$ARCHIVE_NAME"
( cd "$WORK" && 7z a -t7z "$NEW99" . >/dev/null )
7z t "$NEW99" >/dev/null || die "yeni 99 doğrulama hatası"
( cd "$STAGING" && sha256sum "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256" )
( cd "$STAGING" && sha256sum -c "$ARCHIVE_NAME.sha256" >/dev/null ) || die "yeni 99 sha256 hatası"
log "yeni 99 hazır ve doğrulandı: $ARCHIVE_NAME"

# --- Yeni 00 (geçici adla) ---
NEW00="$STAGING/$LATEST_NAME"
( cd "$REPORT_DIR" && 7z a -t7z "$NEW00" . >/dev/null )
7z t "$NEW00" >/dev/null || die "yeni 00 doğrulama hatası"
( cd "$STAGING" && sha256sum "$LATEST_NAME" > "$LATEST_NAME.sha256" )
( cd "$STAGING" && sha256sum -c "$LATEST_NAME.sha256" >/dev/null ) || die "yeni 00 sha256 hatası"
log "yeni 00 hazır ve doğrulandı: $LATEST_NAME"

# --- Atomik yerleştirme ---
mv -f "$NEW00" "$REPORT_ROOT/$LATEST_NAME"
mv -f "$STAGING/$LATEST_NAME.sha256" "$REPORT_ROOT/$LATEST_NAME.sha256"
mv -f "$NEW99" "$REPORT_ROOT/$ARCHIVE_NAME"
mv -f "$STAGING/$ARCHIVE_NAME.sha256" "$REPORT_ROOT/$ARCHIVE_NAME.sha256"

# Eski top-level paketleri ancak şimdi kaldır
for f in "${OLD_LATEST[@]}"; do
  [ "$(basename "$f")" = "$LATEST_NAME" ] && continue
  rm -f "$f" "$f.sha256"
done
for f in "${OLD_ARCHIVE[@]}"; do
  [ "$(basename "$f")" = "$ARCHIVE_NAME" ] && continue
  rm -f "$f" "$f.sha256"
done

rm -rf "$STAGING"

# --- Final doğrulama ---
( cd "$REPORT_ROOT" && sha256sum -c "$LATEST_NAME.sha256" >/dev/null && sha256sum -c "$ARCHIVE_NAME.sha256" >/dev/null ) \
  || die "final sha256 doğrulaması başarısız"
7z t "$REPORT_ROOT/$LATEST_NAME" >/dev/null && 7z t "$REPORT_ROOT/$ARCHIVE_NAME" >/dev/null \
  || die "final 7z doğrulaması başarısız"

log "TAMAM: $REPORT_ROOT"
ls -la "$REPORT_ROOT"
