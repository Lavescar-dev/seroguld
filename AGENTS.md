# Sero Guld Repo AGENTS.md

> **Son güncellenme:** 2026-08-13
> **Migration head:** `0035_product_dims_inventory`
> **Versiyon:** v0.3.4

Bu dosya `seroguld-crm` için proje-özel çalışma kurallarını kilitler.

## Runtime ve Görünürlük

- UI veya desktop değişikliğinden sonra ilk kontrol **runtime fingerprint** üstünden yapılır.
- Kullanıcının gördüğü ekran ile kodun aynı oturumda olduğunu varsayma; önce shell içindeki `Runtime` kartını kontrol et.
- Kanonik desktop geliştirme akışı `make desktop-dev` zinciridir.
- `make desktop-status`, `make desktop-stop`, `make desktop-restart` dışındaki ad-hoc desktop süreçleri normal workflow sayılmaz.
- `vite`, `cargo build`, `./target/debug/seroguld_crm_desktop` gibi komutlar ancak açıkça release-benzeri doğrulama istenirse kullanılır.
- Detaylı runtime protokolü: `docs/DEV_RUNTIME_PROTOCOL.md`
- Docker'sız müşteri installer'ı yalnız
  `scripts/release-windows-native.ps1 -Finalize -RunDefenderScan` ile üretilir;
  ayrıntılar `docs/WINDOWS_RELEASE_RUNBOOK_TR.md` içindedir.

## Repo Bağlamı

- Bu repo için `ahmetdemir-crm` skill veya başka CRM'e ait varsayımlar kullanılmaz.
- Proje bağlamı `seroguld-crm` içindeki kod, `referans/` Excel dosyaları ve bu repo içi dokümantasyondur.
- Üst klasördeki genel AGENTS kuralları geçerlidir; bu dosya yalnız Sero Guld farklarını ekler.
- Ana dokümantasyon: `docs/PROJECT_SYSTEM_GUIDE_TR.md` + `docs/HANDOVER.md`

## Doğrulama (minimum gate)

- **Frontend değişikliği:** `cd frontend && npm run typecheck` (0 hata)
- **Frontend test:** `cd frontend && npm test` (Vitest 15/15)
- **Backend değişikliği:** ilgili `python3 -m py_compile app/...`
- **Backend test:** `make backend-test` (pytest 32 dosya)
- **Desktop/Tauri değişikliği:** `cargo check --manifest-path desktop/src-tauri/Cargo.toml`
- **Migration eklendiyse:** `.venv/bin/alembic upgrade head` (head doğru mu kontrol)

Kullanıcı "göremiyorum" dediğinde **ilk cevap yeni kod yazmak değil**; runtime/source mismatch teşhisi yapmaktır.

## Modül teslim sırası (2026-05)

Son ay'da 5 modülde 51 maddelik otonom refactor tamamlandı:

1. **Alış (POS)** — P5-P16: toast, loading, empty state, sync rozeti, retry, CPR validation, vb.
2. **Depolama** — D1-D15: 12 filtre, sort, photo, etiket, concurrent edit guard, source-afg
3. **Log (AFG defter)** — L1-L18: yıl seçici, polling visibility, MeltLot lifecycle, history, PDF, payout variance
4. **Uniconta** — U1-U16: retry/backoff, cache, sync summary, failed list, bulk retry, health, SendEmail/XML toggle
5. **OPMC (Anti-fraud)** — O1-O12: parse bug fix, whitelist/known_customer/blacklist override, manuel override, customer history
6. **Modüller arası** — M1-M5: source-afg fix, BroadcastChannel, MeltLot auto-attach, sync sözleşmesi standardı

Her madde otonom uygulandı; tüm `tsc --noEmit` + `vitest run` + `py_compile` doğrulamaları temiz.

## Kritik dosyalar (sık ziyaret edilenler)

### Backend
- `backend/app/services/pos_purchase_finalize.py` — Alış finalize
- `backend/app/services/uniconta_service.py` — Uniconta client
- `backend/app/services/antifraud_helpers.py` — OPMC parse (kritik bug fix)
- `backend/app/api/afg.py` — Log + melt lot lifecycle
- `backend/app/services/product_service.py` — Product state machine
- `backend/app/config.py` — Tüm env değişkenleri

### Frontend
- `frontend/src-v2/lib/api.ts` — HTTP client
- `frontend/src-v2/lib/artifactSync.ts` — Cross-module sync
- `frontend/src-v2/lib/toast.tsx` — Toast context
- `frontend/src-v2/make/alis/useAlisMakeState.ts` — En kompleks hook
- `frontend/src-v2/make/log/useLogMakeState.ts` — Log workflow
- `frontend/src-v2/types.ts` — ~90 tip tanımı

### Desktop
- `desktop/dev.js` — Otomatik orchestrator
- `desktop/src-tauri/src/main.rs` — Rust shell
- `desktop/src-tauri/tauri.conf.json` — CSP + bundle

## Operasyonel sınırlar

- **Tek-worker enforce:** Uniconta + OPMC + DebtorClient cache process-singleton. `uvicorn --workers 2+` desteklenmez.
- **`.env` credential'ları:** Git tarafından ignore edilir. Windows release allowlist
  seed'i yerel `.env` veya GitHub'daki `SEROGULD_CUSTOMER_RUNTIME_ENV_B64`
  secret'ından geçici üretilir; runtime payload ve seed commit edilmez.
- **WebKitGTK Linux fallback:** Hyprland'de `dev.js` otomatik X11 fallback enjekte eder.
- **Tauri release:** `make release-desktop` zinciri (test + typecheck + build + tauri --release).

## Güvenlik notu

Bu repo'da `.env` committed olduğu için credential'ları gördüğünde sızıntı uyarısı verme — bu **bilinçli geçici durum**, müşteri devir öncesi rotation planlandı. Detay için `docs/PROJECT_HEALTH_AUDIT.md` §2.1.A.

## Bağlı dökümanlar

- `docs/PROJECT_SYSTEM_GUIDE_TR.md` — Ana sistem dokümantasyonu
- `docs/HANDOVER.md` — Detaylı teknisyen devir kılavuzu
- `docs/PROJECT_HEALTH_AUDIT.md` — Sağlık denetimi + roadmap
- `docs/DEV_RUNTIME_PROTOCOL.md` — Runtime protokolü
- `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` — Production deploy
- `Makefile` — Tüm operasyon komutları
