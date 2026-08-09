# DEVELOPMENT AND OPERATIONS — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** VERIFIED

## 1. Kurulum

```bash
scripts/setup-dev.sh        # ortam kurulumu (venv, node deps)
# veya manuel:
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd frontend && npm ci
cd desktop && npm ci
```

Gereksinimler: Python 3, Node 20+, cargo (+ MSVC build tools Windows'ta), WebKitGTK dev paketleri (Linux Tauri), WebView2 (Windows).

## 2. Komutlar

| Komut | Amaç |
|---|---|
| `make desktop-dev` | **Kanonik dev zinciri** — backend health probe → alembic upgrade → uvicorn :8100 → vite :3300 → tauri dev; session `.run/desktop-dev-session.json` |
| `make desktop-status` / `desktop-stop` / `desktop-restart` | Runtime fingerprint / süreç yönetimi |
| `make backend-test` | pytest (31 dosya) |
| `cd frontend && npm run typecheck` | tsc 0 hata gate'i |
| `cd frontend && npm test` | vitest (18 test) |
| `make release-desktop` | test + typecheck + build + tauri --release |
| `scripts/release-windows-github.sh` | tag push → GitHub Actions Windows NSIS release |
| `cargo check --manifest-path desktop/src-tauri/Cargo.toml` | Rust gate |
| `.venv/bin/alembic upgrade head` | migration (backend/ altında) |

**Kural:** `vite`, `cargo build`, doğrudan binary çalıştırma ad-hoc sayılır; kanonik akış `make desktop-dev` (AGENTS.md + DEV_RUNTIME_PROTOCOL.md).

## 3. Ortam değişkenleri (isim + amaç; değerler ASLA dokümante edilmez)

Tam liste `backend/app/config.py:30-131` ve `.env.example`:

- **Genel:** `ENV`, `APP_NAME`, `APP_URL`, `CORS_ORIGINS`
- **DB:** `DATABASE_URL`, `DATABASE_AUTO_CREATE`, `POSTGRES_DB/USER/PASSWORD`
- **Auth:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRE_MINUTES`, `JWT_REFRESH_EXPIRE_DAYS`, `FIELD_ENCRYPTION_KEY`, `INITIAL_ADMIN_EMAIL/PASSWORD/NAME`, `INITIAL_ADMIN_AUTO_SEED`
- **AI:** `OPENAI_API_KEY/BASE_URL/MODEL/MAX_TOKENS/TIMEOUT_SECONDS`
- **OPMC:** `OPMC_API_URL/API_KEY/WEBHOOK_SECRET`
- **Woo/WP:** `WOOCOMMERCE_BASE_URL/CONSUMER_KEY/CONSUMER_SECRET/WEBHOOK_SECRET/TIMEOUT_SECONDS`, `WORDPRESS_BASE_URL`, `WP_APP_USERNAME/PASSWORD`
- **Uniconta:** `UNICONTA_API_URL/USERNAME/PASSWORD/COMPANY_ID/API_KEY`, `UNICONTA_SEND_EMAIL_ON_FINALIZE`, `UNICONTA_SEND_XML_ON_FINALIZE`
- **Fatura:** `INVOICE_NUMBER_PREFIX`, `INVOICE_DEFAULT_CURRENCY`, `INVOICE_SALE_VAT_RATE_PERCENT`, `INVOICE_SELLER_*`
- **POS:** `POS_REFERENCE_START`, `POS_REFERENCE_SCAN_WINDOW`
- **Dosya/Office:** `MEDIA_ROOT_DIR`, `DOCUMENT_ROOT_DIR`, `OFFICE_PROVIDER_*`, `OFFICE_RUNTIME_URL`, `OFFICE_WOPI_BASE_URL`, `ONLYOFFICE_RUNTIME_URL/CALLBACK_BASE_URL/JWT_SECRET`, `OFFICE_SESSION_TTL_SECONDS`, `PHOTO_MAX_SIZE_MB`
- **Yedek/log:** `BACKUP_ROOT_DIR`, `BACKUP_RESTORE_DRILL_DIR`, `LOG_DIR/MAX_BYTES/BACKUP_COUNT`, `BACKUP_OFFSITE_ENABLED/STATUS_FILE`, `BACKUP_*_MAX_AGE_*`, `BACKUP_KEEP_HOURLY/KEEP_WEEKLY/WEEKLY_DAY_UTC/CRON_*`
- **Kur:** `GOLD_PRICE_LIVE_ENABLED/TIMEOUT_SECONDS/CACHE_SECONDS`, `INVENTORY_MARKET_GOLD/SILVER/PLATINUM/PALLADIUM_DKK`
- **Frontend:** `VITE_API_BASE_URL` (`auto` | URL), `VITE_WS_BASE_URL`

**Not:** `.env` bu kopyada git'e commit edilmemiş (VERIFIED — `.gitignore:4`, `git log --all -- .env` boş). AGENTS.md'deki "committed" ifadesi bayat.

## 4. Yerel veri

- SQLite: `data/desktop.db` (aktif). `data/seroguld_crm.db` 0 bayt artık.
- Loglar: `data/logs/app.log` (RotatingFileHandler 10MB×5); dev ayrıca `.run/backend.log`, `.run/desktop-dev.log`.
- Demo/seed: `scripts/seed_mock_data.py`, `demo-seed.sh`, `reset-customer-demo-data.py|.sql` (mock seed kasıtlı; prod verisiyle karıştırma).

## 5. Güvenli test

- Backend testleri SQLite ile offline çalışır (canlı servis gerektirenler hariç).
- Canlı smoke script'leri (`live-smoke-seroguld.py`, `live-final-check-seroguld.py`, `gdpr-smoke-live.sh`) **canlı sisteme dokunur** — yalnızca bilinçli operasyon penceresinde.
- Woo/Uniconta credential'ları olmadan ilgili akışlar `skipped` davranır (finalize'ı bloklamaz).

## 6. Packaging / deployment

- **Windows NSIS:** `windows-desktop-release.yml` (tag `seroguld-desktop-v*`) → artifact `SERO_GULD_CRM_windows` + GitHub Release. Feedback pilotu: `desktop-feedback-windows.yml` (VPS hedef + smoke).
- **Web:** docker-compose (postgres, backend, frontend, collabora, onlyoffice, nginx) — "secondary" mod.
- **Windows handoff:** `seroguld-windows-handoff-20260617-2a12df1/` — install/start/smoke ps1 zinciri; rollback otomatik `seroguld-crm.backup.<tarih>` klasörü.
- **Rollback:** git tag + GitHub Release eski installer; DB için `scripts/restore-from-backup.sh`.

## 7. CI workflow'ları

| Workflow | Tetik | İçerik |
|---|---|---|
| `ci.yml` | push/PR | backend pytest, frontend typecheck/test/build, Playwright, desktop shell smoke (ubuntu+xvfb) |
| `windows-desktop-release.yml` | tag/manuel | Windows NSIS build + Release — **smoke YOK** |
| `desktop-feedback-windows.yml` | manuel | feedback NSIS + **Windows display smoke** (tauri-driver+msedgedriver) |

## 8. Operasyon

- **Tek worker:** `uvicorn --workers 1` zorunlu.
- **Backup:** `scripts/backup-gfs.sh` GFS + cron installer; offsite rclone; restore drill. **Şifreleme yok (P1).**
- **GDPR runner:** `ops/systemd/gdpr-runner.timer` (hourly) + `scripts/gdpr-runner.py`.
- **Secret senkron:** `scripts/seroguld-secret-sync.sh` (.env GitHub'a gitmez), `seroguld-sync.sh` (105 laptop rsync).
- **Log konumları:** `data/logs/app.log`, `.run/*.log`, CI artifact'ları.
