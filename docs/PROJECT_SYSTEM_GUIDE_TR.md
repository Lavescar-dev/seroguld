# Sero Guld CRM — Birleşik Proje Dokümantasyonu

> **Son güncellenme:** 2026-05-18 · **Versiyon:** v0.2.0
> **Repo kökü:** `/mnt/SSD/Clients/Recai_Demir/seroguld-crm`
> **Migration head:** `0019_log_module_audit`

Bu belge Sero Guld CRM projesinin frontend, backend, Tauri masaüstü katmanı, veri modeli, entegrasyonları ve operasyon akışlarını **tek yerde** toplayan ana sistem dokümantasyonudur.

**Amaç:**
- projeyi parça parça değil bütün sistem olarak anlatmak
- frontend ve backend sorumluluklarını aynı bağlamda göstermek
- geliştirme, demo, operasyon ve teslim sürecini tek kaynaktan yürütmek
- yeni gelen bir geliştiricinin projeyi hızlıca anlayabilmesini sağlamak

> Bu belge kodun yerine geçmez. Kodun üstünde çalışır ve kodu okumayı hızlandırır.

**Eşlik eden dokümanlar:**
- `docs/HANDOVER.md` — Detaylı teknisyen devir kılavuzu (yeni teknisyen için)
- `docs/PROJECT_HEALTH_AUDIT.md` — Proje sağlık denetimi + roadmap
- `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` — Production deploy operasyonu
- `docs/DEV_RUNTIME_PROTOCOL.md` — Dev runtime ayar protokolü
- `docs/DESKTOP_SMOKE_PREREQUISITES_TR.md` — Desktop smoke önkoşullar
- `docs/GDPR_TAURI_SMOKE_TR.md` — GDPR smoke test akışı
- `docs/WORDPRESS_GDPR_BRIDGE_TR.md` — WordPress GDPR köprüsü
- `AGENTS.md` — AI/dev ajanı çalışma kuralları

---

## 1. Proje Özeti

Sero Guld CRM, **ikinci el kuyumculuk operasyonu** için geliştirilmiş çok ekranlı bir **CRM + POS + envanter + e-ticaret entegrasyon** sistemidir.

**Müşteri:** Recai Demir (Sero Guld og Sølv ApS — Valby/Danimarka, CVR 34093083).

**Sistemin ana amaçları:**
- Recai Bey'in Excel tabanlı alım, stok, eritme ve çıkış takibini dijitalleştirmek
- müşteri ve satıcı ekranlarını fiziksel olarak ayırmak (multi-monitor)
- canlı alım/satış akışlarını güvenli ve hızlı hale getirmek
- ürünleri WooCommerce sitesine bağlamak
- Uniconta muhasebe sistemine otomatik fatura aktarımı yapmak
- AI ile ürün açıklaması üretmek (Danca SEO paketi)
- anti-fraud (OPMC) sinyallerini operatöre okunabilir formda göstermek
- 5 yıllık yasal saklama (Bogføringsloven §10) için tam audit trail
- lokal masaüstü kullanımına uygun, sunucudan bağımsız çalışabilen yapı

**Sistemin kapsamadığı:**
- Bankacılık entegrasyonu (manuel banka transferi)
- E-imza (PDF imzasız üretilir; müşteri kâğıt belgeye imza atar)
- Fiziksel thermal printer queue (backend ESC/POS bytes üretir; OS print queue'ya yollamak operatörün PC'sinden)

---

## 2. Teknoloji Stack'i

### Frontend
- **Vite 6** (build + dev server)
- **React 18.3** + **TypeScript 5.7** (strict mode)
- **Tailwind CSS 3.4** (brand-* paleti)
- **React Router 6.30** (client-side routing)
- **TanStack Query 5.80** (server state)
- **@react-pdf-viewer 3.12** + `pdfjs-dist` (Tauri CSP uyumlu PDF render)
- **lucide-react** (ikonlar)
- **Vitest 4.1** (unit/component test)
- **Playwright 1.54** (E2E smoke)

### Backend
- **FastAPI** (async REST)
- **SQLAlchemy 2.0** (async ORM)
- **Pydantic v2** (schema)
- **Alembic** (migration — 19 sürüm)
- **Uvicorn** (ASGI)
- **httpx** (WC, Uniconta, OpenAI istemcileri)
- **python-jose** (JWT)
- **bcrypt / passlib** (parola hash)
- **reportlab 4.2** (PDF üretimi — lot kartı)

### Veritabanı
- **Üretim / klasik kurulum:** PostgreSQL 16
- **Lokal masaüstü / demo:** SQLite (`data/desktop.db`)
- 19 Alembic migration; `test_migration_portability.py` SQLite ↔ PG geçişi test eder.

### Masaüstü
- **Tauri 2** (Rust shell + WebView)
- **WebKitGTK 4.1** (Linux) / **WebView2** (Windows)
- `desktop/dev.js` orchestrator: backend (8100) + Vite (3300) + Hyprland/Wayland fallback (X11 + DMABUF disable) otomatik

### Diğer altyapı
- Docker Compose (secondary / web stack)
- Nginx (reverse proxy, web stack)
- **OpenAI API** (gpt-* model — `config.py:OPENAI_MODEL`)
- **WooCommerce REST API v3** (ürün yayını, sipariş çekme)
- **Uniconta Web API** (DebtorClient + DebtorInvoice)
- **OnlyOffice Document Server 8.2.2** (WOPI Excel düzenleme)
- **Collabora Online 24.04** (fallback office runtime)
- **rclone** (offsite backup mirror)
- yedekleme scriptleri (GFS rotasyonu)

---

## 3. Üst Düzey Mimari

Sistem 4 ana katmandan oluşur:

1. **Arayüz katmanı**
   - admin paneli (Tauri masaüstü pencere içinde Vite/React)
   - müşteri ekranı (ikinci monitör, token-based public route)
   - canlı POS ekranları (alış)
   - public GDPR sayfaları

2. **Uygulama / iş kuralı katmanı**
   - FastAPI router'ları (`app/api/v2_*.py` kanonik, `app/api/v1_*.py` legacy)
   - servisler (`app/services/` — 36 dosya)
   - sequence, POS, AI, Woo, Uniconta, OPMC, GDPR, rapor mantığı

3. **Veri katmanı**
   - SQLAlchemy 2.0 async modeller (`app/models/` — 26 model)
   - audit tabloları: `PosDocumentAudit`, `AfgMeltLotHistory`, `ProductHistory`
   - GDPR retention politikaları (5 yıl Bogføringsloven uyumluluk)

4. **Çalıştırma katmanı**
   - Tauri desktop runtime (kanonik)
   - Docker compose web stack (secondary)
   - backup / restore / offsite akışları
   - OnlyOffice / Collabora docker servisleri

### 3.1 ASCII diagram

```
┌──────────────────────────────────────────────────────┐
│  TAURI Desktop (Linux/Win/Mac)                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Rust shell (main.rs ~14k LOC)                   │   │
│  │   • Multi-monitor                                │   │
│  │   • File picker IPC                              │   │
│  │   • dev session JSON                             │   │
│  └────────────────────┬───────────────────────────┘   │
│                       │                                 │
│           ┌───────────┴────────────────┐                │
│           │  WebView (WebKitGTK/WebView2)│                │
│           │  React 18 SPA                │                │
│           │   • src-v2/make/ (15 modül)  │                │
│           │   • TanStack Query           │                │
│           │   • Tauri IPC                │                │
│           └───────────┬────────────────┘                │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTP + WebSocket
                        ▼
            ┌───────────────────────┐
            │  FastAPI (uvicorn)      │
            │   • app/api/v2_*         │
            │   • app/services/        │
            │   • app/models/          │
            └──────────┬────────────┘
                       │
   ┌───────────────────┼─────────────────────────┐
   ▼                   ▼                          ▼
┌─────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  DB     │  │  External         │  │  Background          │
│  SQLite │  │   • WooCommerce   │  │   • backup           │
│  PG 16  │  │   • Uniconta      │  │   • gdpr-runner      │
│         │  │   • OpenAI        │  │   • rclone offsite   │
│         │  │   • OnlyOffice    │  │                      │
│         │  │   • Collabora     │  │                      │
└─────────┘  └──────────────────┘  └──────────────────────┘
```

---

## 4. Çalıştırma Modları

### 4.1 Lokal desktop modu (KANONİK)

Tauri dev akışı tek komutla:
```bash
make desktop-dev
```

Bu komut `desktop/dev.js` üzerinden:
- backend'i `127.0.0.1:8100` üzerinde başlatır
- frontend'i `127.0.0.1:3300` üzerinde başlatır
- Tauri penceresini açıp Vite uygulamasını masaüstü pencerede render eder
- Hyprland/Wayland'de X11 fallback (`GDK_BACKEND=x11` + `WEBKIT_DISABLE_DMABUF_RENDERER=1`) otomatik enjekte edilir
- session bilgisini `.run/desktop-dev-session.json`'a yazar

Destek komutları:
- `make desktop-status` — aktif session özeti
- `make desktop-stop` — graceful shutdown (SIGTERM → 2.5s → SIGKILL)
- `make desktop-restart` — stop + start

**Bu modun avantajları:**
- yerel kullanıma çok uygun (kuyumcu shop scenario)
- shop içinde server bağımlılığını azaltır
- SQLite ile tek makinede çalışır
- multi-monitor (müşteri ekranı 2. monitör) Tauri IPC ile native destek

### 4.2 Demo modu (Tauri olmadan web)

Tauri olmadan sadece web stack:
```bash
make demo-start         # backend:8100 + frontend:3300
make demo-seed          # 20 müşteri + 20 ürün mock veri
make demo-check         # MVP smoke (login/dashboard/POS/display)
make demo-ready         # demo-start + demo-seed + demo-check
```

### 4.3 Docker / web modu (SECONDARY)

`docker-compose.yml` üzerinden:
- `postgres`
- `backend`
- `frontend`
- `nginx`
- `onlyoffice`
- `collabora`

Bu mod secondary / klasik web deployment senaryosu için uygundur. **Production hedefi desktop modudur**, web mod opsiyoneldir.

---

## 5. Kod Klasör Yapısı

```
seroguld-crm/
├── backend/                          # FastAPI Python uygulaması
│   ├── alembic/versions/             # 19 migration (0001 → 0019)
│   ├── app/
│   │   ├── api/                      # 22 router modülü
│   │   ├── services/                 # 36 service modülü
│   │   ├── models/                   # 26 SQLAlchemy modeli
│   │   ├── schemas/                  # Pydantic şemaları
│   │   ├── utils/                    # cpr, helpers, security, env_file
│   │   ├── config.py                 # Settings (pydantic-settings)
│   │   ├── database.py               # async session
│   │   └── main.py                   # FastAPI app + lifecycle
│   ├── tests/                        # 32 pytest dosyası
│   └── pyproject.toml
│
├── frontend/                         # React 18 + Vite + TS
│   ├── src-v2/                       # KANONİK aktif kod (legacy src/ ignore)
│   │   ├── app.tsx                   # Route definitions
│   │   ├── main.tsx                  # Providers + render
│   │   ├── types.ts                  # ~90 export interface/type
│   │   ├── make/                     # 15 modül (her biri page + hook)
│   │   ├── pages/                    # Page wrapper'ları
│   │   ├── components/               # Ortak komponentler
│   │   ├── lib/                      # api, auth, artifactSync, format, cpr, toast
│   │   └── __tests__/                # Vitest (3 dosya, 15 test)
│   ├── legacy-next/                  # Eski Next.js — IGNORE
│   └── vite.config.ts / vitest.config.ts / tailwind.config.js
│
├── desktop/                          # Tauri shell
│   ├── src-tauri/
│   │   ├── src/main.rs               # ~14k LOC Rust
│   │   ├── tauri.conf.json           # App config + CSP
│   │   └── Cargo.toml
│   └── dev.js                        # Otomatik orchestrator
│
├── data/                             # Runtime veri (gitignore)
│   ├── desktop.db                    # SQLite (dev)
│   ├── documents/uniconta/           # Uniconta PDF cache
│   ├── uploads/                      # ürün foto upload
│   └── backups/                      # GFS yedekleri
│
├── docs/                             # Türkçe dokümantasyon
│   ├── PROJECT_SYSTEM_GUIDE_TR.md    # ⭐ BU DOSYA (ana doc)
│   ├── HANDOVER.md                   # Devir kılavuzu
│   ├── PROJECT_HEALTH_AUDIT.md       # Sağlık denetimi
│   ├── PRODUCTION_DESKTOP_RUNBOOK_TR.md
│   ├── DEV_RUNTIME_PROTOCOL.md
│   ├── DESKTOP_SMOKE_PREREQUISITES_TR.md
│   ├── GDPR_TAURI_SMOKE_TR.md
│   ├── WORDPRESS_GDPR_BRIDGE_TR.md
│   ├── README.md                     # docs/ klasör indeksi
│   └── referans/                     # Eski referanslar (read-only)
│
├── scripts/                          # Setup/seed/demo helper'ları
├── ops/                              # Backup/cron scriptleri + WP snippet'ler
├── nginx/                            # Web stack reverse proxy
├── .github/workflows/                # CI/CD
├── .run/                             # Runtime state JSON
├── AGENTS.md                         # Dev ajan kuralları
├── Makefile                          # TÜM komutlar
├── docker-compose.yml
├── .env / .env.example
└── README.md
```

### 5.1 `backend/`

FastAPI uygulaması.

**Router katmanı (`app/api/`)** — 22 dosya:
| Dosya | Path prefix | Sorumluluk |
|---|---|---|
| `auth.py` | `/api/auth` | login/refresh/me |
| `bootstrap.py` | `/api/v2/bootstrap` | İlk açılış payload |
| `customers.py` | `/api/customers`, `/api/v2/musteriler` | CRUD + WC import |
| `customer_portal.py` | `/api/customer-portal` | Müşteri self-service |
| `pos.py` | `/api/pos` | Legacy POS + display WS |
| `products.py` | `/api/products` | Foto upload, AI describe, WC publish |
| `inventory.py` | `/api/inventory` | Legacy (v2_inventory.py yeni) |
| `afg.py` | `/afg` (internal) | AFG workspace + melt lot + route |
| `antifraud.py` | `/api/v2/opmc` | OPMC risk + manual override |
| `gdpr.py` | `/api/gdpr`, `/api/v2/gdpr`, `/api/v2/public/gdpr` | GDPR lifecycle |
| `dashboard.py` | `/api/dashboard` | Legacy (v2 içinde de var) |
| `reports.py` | `/api/reports` | Daily/weekly/monthly özet |
| `settings.py` | `/api/settings` | Genel ayarlar |
| `webhooks.py` | `/api/webhooks` | WC webhook |
| `deps.py` | — | `get_current_user`, `require_admin` |
| **`v2.py`** | `/api/v2/*` | Ana v2 (dashboard, customers, antifraud, settings, office, uniconta) |
| **`v2_alis.py`** | `/api/v2/alis/*` | Alış modülü |
| **`v2_inventory.py`** | `/api/v2/depolama/*` | Depolama modülü |
| **`v2_log.py`** | `/api/v2/log/*` | Log modülü (AFG defter) |
| **`v2_woocommerce.py`** | `/api/v2/woocommerce/*` | WC sync |
| **`v2_office_runtime.py`** | `/api/v2/office-runtime/*` | OnlyOffice WOPI |
| `v2_support.py` | — | İç artifact helper'ları |

**Service katmanı (`app/services/`)** — 36 dosya. Önemli olanlar:
- `pos_purchase_finalize.py` — Alış finalize akışı (lock + PosDocument + Uniconta sync)
- `pos_service.py` — Ana POS engine (~2200 sat)
- `pos_transaction_service.py` — Transaction + TransactionLine
- `pos_workspace_mutations.py` — Mutation delegate'leri
- `pos_workspace_state.py` — Display snapshot
- `product_service.py` — Product state machine + history
- `uniconta_service.py` — Uniconta client (retry/backoff, cache, sync orchestrator)
- `antifraud_service.py` + `antifraud_helpers.py` — OPMC risk + override
- `document_artifact_*.py` (5 dosya) — OnlyOffice WOPI sync contract
- `office_host_service.py` — WOPI host endpoint
- `woocommerce.py` + `woocommerce_import_helpers.py` — WC entegrasyon
- `gdpr_service.py` — GDPR retention + runner + 7 policy
- `realtime.py` — WebSocket hub
- `sequence_service.py` — Auto-numbering
- `thermal_label.py` + `thermal_receipt.py` — ESC/POS bytes üretimi
- `lot_card_pdf.py` — AfgMeltLot A4 PDF (reportlab)
- `ai_service.py` — OpenAI client + cost tracking
- `gold_price.py` — Canlı altın fiyatı (timeout + 20s cache)

**Model katmanı (`app/models/`)** — 26 model:
- POS: `pos_session`, `pos_session_line`, `pos_session_product_link`, `pos_document`, `pos_document_audit`
- Transaction: `transaction`, `transaction_line`
- Product: `product`, `product_history`, `woocommerce_log`
- AFG: `afg_melt_lot`, `afg_melt_lot_history`
- User: `user`, `customer_identity`, `customer_activity`
- GDPR: `gdpr_request`, `gdpr_request_event`, `gdpr_job`, `gdpr_processor`, `gdpr_retention_policy`
- Diğer: `document_artifact`, `reference_sequence`, `ai_usage_log`, `enums.py`

**Test (`tests/`)** — 32 pytest dosyası. Anahtarlar:
- `test_afg_roundtrip.py`, `test_log_ark1_roundtrip.py` — uçtan uca akış
- `test_pos_*.py` (8 dosya) — POS lifecycle, multi-line, draft conflict
- `test_antifraud_reasons.py`, `test_customer_risk.py` — OPMC
- `test_gdpr_*.py` (2) — GDPR runner ve service
- `test_office_host_service.py` — OnlyOffice WOPI sync
- `test_migration_portability.py` — SQLite ↔ PostgreSQL

### 5.2 `frontend/`

Vite tabanlı React 18 admin/customer/display ekranları.

**Make modülleri (`src-v2/make/`)** — 15 modül:
| Modül | Page LOC | Sorumluluk |
|---|---|---|
| **alis** | 2326 | POS purchase (alış) |
| **depolama** | 1667 | Inventory grid + 12 filtre + foto + etiket |
| **log** | 1948 | AFG defter + eritme lot lifecycle |
| **uniconta** | 1101 | ERP sync + retry + sync summary |
| **opmc** | 651 | Anti-fraud (OPMC risk) |
| **customers** | 871 | Müşteri yönetimi |
| **dashboard** | 678 | Ana ekran KPI |
| **gdpr** | 838 | GDPR cockpit |
| **office** | 1182 | OnlyOffice/Collabora launcher |
| **woocommerce** | 1424 | WC sync paneli |
| **display** | 400 | Müşteri ekranı (live/idle/preview) |
| **excel** | 200 | Excel preview |
| **settings** | 477 | Ayarlar |
| **root** | 494 | AppShell |
| **login** | 300 | Login page |

Her modül pattern:
```
make/<modul>/
  <Modul>Page.tsx           # JSX (render)
  use<Modul>MakeState.ts    # React Query + state hook
  types.ts                  # Modüle özel tipler
```

**Ortak komponentler (`src-v2/components/`)** — 6 komponent:
- `AppShell.tsx` — Sidebar + header + footer + outlet
- `PdfViewerModal.tsx` — @react-pdf-viewer wrapper
- `CustomerDisplayCanvas.tsx` — 1920×1080 müşteri ekranı (uniform scale + letterbox)
- `StatCard.tsx` — Dashboard KPI kartı
- `SectionCard.tsx` — Generic section
- `OpmcShared.tsx` — Risk level util

**Lib (`src-v2/lib/`)** — Yardımcı modüller:
- `api.ts` — HTTP client + blob helper
- `auth.ts` — Token persistence
- `artifactSync.ts` — Cross-module BroadcastChannel + `signalMatches` + `DEFAULT_CROSS_TRIGGERS`
- `format.ts` — Intl formatters (formatMoney, formatDate, formatRelativeTime, vb.)
- `cpr.ts` — Danish CPR mod-11 validation
- `toast.tsx` — Toast context + hook
- `desktop.ts` — Tauri IPC köprüsü
- `officeDock.ts` — Office document dock
- `runtimeInfo.ts` — runtime diagnostics

**Test (`__tests__/`)** — Vitest:
- `cpr.test.ts` — 5 test
- `format.test.ts` — 6 test
- `toast.test.tsx` — 2 test (RTL)
- `setup.ts` — `@testing-library/jest-dom/vitest`

### 5.3 `desktop/`

Tauri shell.

- `src-tauri/src/main.rs` — Rust shell (~14k LOC)
- `src-tauri/tauri.conf.json` — App config (CSP, bundle, window 1440x920 min 1180x760)
- `dev.js` — Otomatik backend + frontend + Tauri orchestrator (Hyprland fallback)

### 5.4 `referans/` ve `docs/referans/`

Excel referansları, uyarlama backlogları ve field mapping. Bu klasörler **read-only** — kodun "source of truth" olarak Excel orijinaline sadakat için tutulur.

---

## 6. Domain Bazlı Birleşik Sistem Haritası

Bu bölüm frontend ve backend'i domain bazında birlikte anlatır.

### 6.1 Authentication

**Frontend:**
- Login sayfası: `src-v2/pages/LoginPage.tsx` + `make/login/`
- Token yönetimi: `src-v2/lib/auth.ts`
- API wrapper: `src-v2/lib/api.ts`

**Backend:**
- `app/api/auth.py` — login, refresh, register, me
- `app/api/deps.py` — `get_current_user`, `require_admin`

**Fonksiyon:**
- access + refresh JWT (HTTPBearer)
- admin / customer rol ayrımı (`RoleEnum`)
- 401 → frontend refresh dener; fail olursa logout

### 6.2 Dashboard

**Frontend:**
- `src-v2/pages/DashboardPage.tsx` + `make/dashboard/`

**Backend:**
- `app/api/v2.py` (dashboard endpoint'leri)
- `app/services/dashboard_helpers.py`

**Fonksiyon:**
- stok özeti, kar görünümleri
- operasyon kartları, AI maliyetleri
- entegrasyon sağlığı
- son müşteri/alış listeleri

### 6.3 Customer Management

**Frontend:**
- `src-v2/pages/CustomersPage.tsx` + `make/customers/`

**Backend:**
- `app/api/customers.py` + `app/api/v2.py` (musteriler endpoints)
- `app/services/customer_service.py`

**Fonksiyon:**
- müşteri listeleme + arama
- detay + alış geçmişi (`/api/v2/musteriler/{id}/history`)
- kümülatif alış raporu (`/api/v2/musteriler/{id}/alis-summary`)
- WooCommerce müşteri import
- risk sinyalleri + activity tracking

### 6.4 Product / Inventory Management (Depolama)

**Frontend:**
- `src-v2/pages/InventoryPage.tsx` + `make/depolama/`
- `InventoryDataTable.tsx` — Tek tablo abstraction (5 kategoriden tek komponente refactor)
- `InventoryFilters.tsx` — 12 filtre paneli
- `CustomerAlisSummaryStrip.tsx` — Drawer'da AFG kaynak izi

**Backend:**
- `app/api/v2_inventory.py` (depolama endpoint'leri)
- `app/api/inventory.py` (legacy)
- `app/services/product_service.py`
- `app/services/photo_service.py`
- `app/services/woocommerce_import_helpers.py`
- `app/services/thermal_label.py` — ESC/POS 62mm etiket + Code128 barcode

**Fonksiyon:**
- ürün CRUD + state machine (`_allowed_status_transition`)
- 14 gün GDPR kilidi mantığı
- foto yükleme (`/api/products/{id}/photos`)
- AI ürün açıklaması üretimi + approve
- WC publish / unpublish + live import
- ProductHistory drawer'da panel
- AFG kaynak izi (`/depolama/products/{id}/source-afg`) — `TransactionLine → Transaction → PosDocument` zinciri (yeni AFG akışı için doğru; `PosSessionProductLink` legacy fallback)
- 12 filtre: q, category, subcategory, location, needs_cleaning, gdpr_locked, date_from-to, weight_min-max, price_min-max, limit, offset
- Sıralanabilir kolonlar (lager_dato, urun, birim_gram, toplam_gram, alis_fiyati, spot_degeri, shop_fiyati, storage_location)
- Etiket / barcode print (ESC/POS, drawer + tablo satırlarından)
- Concurrent edit guard (`expected_updated_at` precondition, 409 Conflict)

### 6.5 POS (Alış)

**Frontend:**
- `src-v2/pages/PosPage.tsx` + `make/alis/`
- `AlisPage.tsx` (2326 sat) + `useAlisMakeState.ts` (~1700 sat)
- `customerEditors.tsx` — Müşteri formu + CPR input
- `marketRates.tsx` — Altın matris satırları
- `sheetEditors.tsx` — Afregningssheet editor
- `variableValues.tsx` — Numbering + variable rates

**Backend:**
- `app/api/v2_alis.py` (alış endpoint'leri)
- `app/services/pos_purchase_finalize.py` (finalize akışı)
- `app/services/pos_service.py` (ana engine ~2200 sat)
- `app/services/pos_transaction_service.py` (TransactionLine oluşturma)
- `app/services/pos_workspace_mutations.py` (mutation delegate)
- `app/services/pos_document_service.py` (belge numarası)
- `app/services/pos_receipt_renderer.py` (HTML/thermal)
- `app/services/sequence_service.py` (auto-numbering)
- `app/services/realtime.py` (display WS)

**Fonksiyon:**
- canlı alım akışı (POS purchase)
- workspace + autosave (200ms debounce + mutex)
- finalize akışı (`SELECT...FOR UPDATE` lock + atomic state transition)
- PosDocument + Transaction + TransactionLine (line.product_id=NULL ilk başta; Log route'unda atanır)
- Uniconta hybrid sync (fail-soft, audit log)
- edit_source_session_id continuation (onaylı belgeyi geri aç)
- Concurrent finalize prevention (409 Conflict)
- multi-line support
- referans / afregnings numaraları
- customer-safe display snapshot (CPR/marj/notlar müşteri ekranına gönderilmez)
- Toast feedback + Loading state + Empty state
- PDF viewer (Uniconta cache veya HTML fallback)
- "Tekrar Dene" Uniconta retry
- CPR mod-11 validation
- Negatif gram/oran guard
- Keyboard shortcut (Ctrl+S, Ctrl+N, Esc)

### 6.6 Customer Display (Müşteri Ekranı)

**Frontend:**
- `src-v2/pages/DisplayPage.tsx`, `DisplayIdlePage.tsx`, `DisplayPreviewPage.tsx`
- `src-v2/components/CustomerDisplayCanvas.tsx` (1920×1080 + uniform scale + letterbox)
- `make/display/`

**Backend:**
- `app/api/pos.py` (display endpoint'leri ve WS)
- `app/services/realtime.py` (WebSocket hub)
- `app/services/pos_display_service.py` (snapshot serializer)

**Fonksiyon:**
- ikinci monitör ekranında müşteriye satır satır bilgi gösterme
- anlık satır ekleme / güncelleme / silme (WebSocket push)
- toplam teklif ve aktif kur görüntüleme
- kiosk / full-screen akışı
- **Minimal White + Yeşil** tema (`#1F6B3F` aksent, Premium Editorial tablo + Emerald Block footer)
- token-based public route (auth gerekmez)
- Tauri'de Rust IPC ile native 2. monitör pencere yönetimi

**Asla gösterilmemesi gerekenler (display tarafı):**
- CPR
- belge numarası gibi hassas kimlik detayları
- marj / iç notlar
- storage location
- audit alanları

### 6.7 Customer Portal

**Frontend:**
- `src-v2/pages/` (customer route'ları minimal — büyük ölçüde GDPR public sayfaları)

**Backend:**
- `app/api/customer_portal.py`

**Fonksiyon:**
- müşteriye kendi özetini gösterme (customer rolündeyse)

### 6.8 Log (AFG Defter)

**Frontend:**
- `src-v2/pages/AfgPage.tsx` + `make/log/`
- `LogPage.tsx` (~1900 sat) — workspace + ReviewBar + MeltSection + MeltLotCard
- `LotHistoryDrawer`, `LotLinesDrawer`, `MeltConfirmDialog` alt komponentleri

**Backend:**
- `app/api/afg.py` (workspace + melt lot orchestration)
- `app/api/v2_log.py` (HTTP endpoint'leri)
- `app/services/lot_card_pdf.py` (reportlab A4 lot kartı PDF)

**Fonksiyon:**
- AFG belge buckets (gold / silver)
- Yıl seçici (`?year=` param)
- Belge satırlarına rota atama: envanter / kararsız / eritme
- Batch-apply atomicity (per-line savepoint, partial failure raporu)
- ReviewBar: bekleyen değişiklik sayacı + apply/discard
- Eritme havuzu istatistikleri
- AfgMeltLot CRUD + auto-attach orphan lines (yeni melted satırlar açık draft lot'a bağlanır)
- Lot finalize/reopen (status enum + lock + zorunlu payout/sale_date validation)
- Lot silme (sadece draft + 0 satır)
- AfgMeltLotHistory drawer'da audit panel
- Bağlı TransactionLine listesi drawer'da
- Lot PDF kartı (reportlab — KPI + giderler + bağlı satırlar)
- Payout variance uyarısı (%5+ fark için sarı banner)
- Search debounce (300ms)
- Polling visibility-aware (Excel view'da veya tab gizliyken durdur)
- Discard confirm + tab değişimi toast
- MeltLot concurrent edit guard (`expected_updated_at` precondition)
- Cross-module sync (alış finalize → log otomatik invalidate)

### 6.9 Uniconta (ERP entegrasyonu)

**Frontend:**
- `src-v2/pages/UnicontaPage.tsx` + `make/uniconta/`
- `UnicontaPage.tsx` (1100 sat) — BaglantiPanel + FaturaDetay + sync summary panel
- Failed sync accordion + bulk retry + invoice timeline drawer

**Backend:**
- `app/api/v2.py` (uniconta endpoint'leri)
- `app/services/uniconta_service.py` (~700 sat)

**Fonksiyon:**
- Async Uniconta Web API client (login + refresh + token cache)
- Retry / exponential backoff (3 deneme, jitter, RETRYABLE_STATUS_CODES 500/502/503/504/408/429)
- DebtorClient cache (1h TTL — finalize'da gereksiz Uniconta query azaltır)
- `generate_debtor_invoice()` → PDF binary (base64 decoded)
- `sync_pos_document_to_uniconta()` — Alış finalize'dan çağrılır (hybrid mode)
- Sync summary endpoint (24h stats by status + hata kategorileri)
- Failed/skipped syncs endpoint + UI accordion
- Bulk retry endpoint (`/uniconta/sync-retry-all`)
- Connection health endpoint (token expiry, last call ok)
- SendEmail/SendXML toggle (finalize sonrası fatura email/OIOUBL)
- Friendly Türkçe error parse (401/404/timeout/network/5xx)
- "Sync bekleyen N AFG" rozet
- Invoice timeline drawer (created/mail/eFatura)
- Cross-module sync (alış → uniconta otomatik invalidate)
- `PosDocumentAudit` ile her sync attempt log'lanır
- Multi-worker uyarısı: process-singleton cache, prod'da `--workers 1` zorunlu

### 6.10 Anti-Fraud (OPMC)

**Frontend:**
- `src-v2/pages/AntifraudPage.tsx` + `OpmcDetailPage.tsx` + `make/opmc/`
- Skor kaynağı badge (OPMC / AI / Whitelist / Blacklist / Known Customer / Manuel)
- Customer history mini panel
- Manual override butonları (Düşük/Orta/Yüksek + reason)

**Backend:**
- `app/api/antifraud.py` (v2 prefix `/api/v2/opmc/*`)
- `app/services/antifraud_service.py`
- `app/services/antifraud_helpers.py`

**Fonksiyon:**
- WC siparişlerinden risk meta'larını çekme
- **KRİTİK BUG FIX (O1-O12):** `_extract_score_from_value` regex parse bug çözüldü
  - Eski hata: AI metinden ilk sayıyı yakalıyordu (örn "%100 güvenli" → 100 risk)
  - Çözüm: sadece numeric type + `dict["score"]` keyleri kabul ediliyor
  - 0-100 range clamp eklendi
- Whitelist override (`whitelist_action` → low)
- Blacklist override (`_wc_af_blacklisted` → high)
- Known customer pre-empt (3+ başarılı + son 365gün → high→medium/low hafifletme)
- Manuel override (`_wc_af_manual_override` meta → Woo'ya yazılır + audit)
- OPMC > AI priority swap (kural-tabanlı plugin > LLM halüsinasyonu)
- OPMC orders cache (5dk TTL)
- Customer history (`AntiFraudCustomerHistoryOut`): toplam/başarılı/iptal/başarısız/eşleşme kaynağı

### 6.11 Reports

**Frontend:**
- Reports sayfası `src-v2/pages/ReportsPage.tsx` (henüz aktif olmayabilir; legacy admin reports)

**Backend:**
- `app/api/reports.py`

**Fonksiyon:**
- günlük / haftalık / aylık raporlar
- CSV / XLSX / PDF export

### 6.12 Office Runtime (OnlyOffice / Collabora)

**Frontend:**
- `src-v2/pages/OfficeDocumentPage.tsx`, `ExcelPreviewPage.tsx` + `make/office/`
- WOPI embed iframe + sync contract

**Backend:**
- `app/api/v2_office_runtime.py`
- `app/services/office_host_service.py` (WOPI host endpoint mantığı)
- `app/services/document_artifact_service.py` (CRUD + sync)
- `app/services/document_artifact_afg.py` — AFG workbook contract
- `app/services/document_artifact_inventory.py` — Depolama contract
- `app/services/document_artifact_log.py` — Log contract
- `app/services/document_artifact_preview.py` — Excel preview

**Fonksiyon:**
- AFG / Depolama / Log için canlı Excel düzenleme
- BroadcastChannel-style cell edit → backend sync
- Force save + callback (OnlyOffice → backend)
- Binary XLSX persist → DocumentArtifact
- Contract version checksum + conflict detection (`__SERO_SYNC` sheet)

### 6.13 GDPR

**Frontend:**
- `src-v2/pages/GdprPage.tsx` (admin) + 4 public route (privacy, cookies, request, request status)
- `make/gdpr/` (838 sat)

**Backend:**
- `app/api/gdpr.py`
- `app/services/gdpr_service.py`
- 5 model: `GdprRequest`, `GdprRequestEvent`, `GdprJob`, `GdprProcessor`, `GdprRetentionPolicy`

**Fonksiyon:**
- 7 retention policy (auto-seed):
  - `financial_ledger` — 5y, keep_restrict
  - **`afg_purchase_documents`** — 5y, keep_restrict (Bogføringsloven §10)
  - **`afg_melt_lots`** — 5y, keep_restrict (yeni: M4'te eklendi)
  - `customer_master` — 5y, pseudonymize
  - `gdpr_audit` — 5y, keep_restrict
  - `operational_logs` — 90d, delete
  - `local_backups`, `offsite_backups` — 35/90d
- Public form submit + status takibi
- Admin cockpit: overview, jobs, processors
- Runner (`make gdpr-runner` veya systemd timer)
- WordPress bridge config endpoint
- Müşteri pseudonymize akışı

### 6.14 Webhooks

**Backend:**
- `app/api/webhooks.py`

**Fonksiyon:**
- WooCommerce gelen webhook olayları
- Satış olunca CRM'de ürün durumunu düşürme

---

## 7. Backend API Yüzeyi

> Toplam **180+ endpoint** mevcut. Tam detay: Swagger UI `http://localhost:8100/docs`. Aşağıda ana yapı:

### 7.1 Yeni kanonik (v2) yapı
- `/api/v2/bootstrap` — İlk açılış
- `/api/v2/alis/*` — Alış modülü
- `/api/v2/depolama/*` — Depolama modülü
- `/api/v2/log/*` — Log modülü (AFG defter)
- `/api/v2/uniconta/*` — ERP entegrasyon
- `/api/v2/opmc/*` — Anti-fraud
- `/api/v2/musteriler/*` — Müşteri yönetimi
- `/api/v2/dashboard` — Ana ekran
- `/api/v2/woocommerce/*` — WC sync
- `/api/v2/gdpr/*` + `/api/v2/public/gdpr/*` — GDPR
- `/api/v2/office-runtime/*` — OnlyOffice WOPI
- `/api/v2/settings` — Ayarlar
- `/api/v2/display/*` — Display snapshot

### 7.2 Legacy (v1) — yavaş yavaş kaldırılacak
- `/api/auth/*` — login/refresh/me (hâlâ aktif)
- `/api/customers`, `/api/inventory`, `/api/pos` — legacy v1 (v2 var ama eski test'ler hâlâ kullanıyor)
- `/api/products`, `/api/reports`, `/api/settings`, `/api/webhooks` — legacy ama aktif

### 7.3 Ek endpoint'ler
- `/health` — basit OK kontrolü
- `/readyz` — readiness (DB + media + backup + restore-drill + offsite + office runtime)
- `/api/v2/runtime/readiness` — admin readiness
- `/api/v2/runtime/status` — runtime status
- `/media/*` — uploaded file servis
- `/api/wopi/*` — OnlyOffice WOPI protocol
- `/office/onlyoffice/callback/{token}` — OnlyOffice → backend
- `/office/onlyoffice/forcesave/{token}`

### 7.4 WebSocket endpoint'leri
- `WS /display/{display_token}/ws` — Müşteri ekranı realtime push
- `WS /sessions/{session_id}/ws` — Clerk önizleme

Frontend tarafında bu yapı, `src-v2/lib/api.ts` üzerinden tek wrapper ile kullanılır.

---

## 8. Frontend Route Haritası

```
ADMIN (Auth required, AppShell layout):
 /                           → PosPage (alış — kök route)
 /dashboard                  → DashboardPage
 /depolama                   → InventoryPage
 /log                        → AfgPage (Log)
 /musteriler                 → CustomersPage
 /opmc                       → AntifraudPage
 /opmc/:id                   → OpmcDetailPage
 /uniconta                   → UnicontaPage
 /woocommerce                → WooCommercePage
 /gdpr                       → GdprPage
 /settings                   → SettingsPage
 /musteri-ekran              → DisplayPreviewPage
 /office-document/:kind/:key → OfficeDocumentPage
 /excel-preview/:kind/:key   → ExcelPreviewPage

REDIRECT'LER:
 /pos       → /
 /afg       → /log
 /inventory → /depolama
 /customers → /musteriler
 /antifraud → /opmc

PUBLIC (Auth gerekmez):
 /login                          → LoginPage
 /display/idle                   → DisplayIdlePage
 /display/:token                 → DisplayPage (token-based)
 /gdpr/privacy                   → GdprPublicPrivacyPage
 /gdpr/cookies                   → GdprPublicCookiesPage
 /gdpr/request                   → GdprPublicRequestPage
 /gdpr/request/:token            → GdprPublicRequestStatusPage

DEV ONLY:
 /desktop-smoke                  → DesktopSmokePage
```

---

## 9. Çekirdek Veri Modeli

Aşağıdaki modeller projenin çekirdeğini oluşturur:

### 9.1 User (Roles: ADMIN | CUSTOMER)
- email, password_hash (bcrypt)
- role enum
- iletişim bilgileri
- Foreign keys: PosSession.customer_id (RESTRICT), Product.seller/buyer_customer_id

### 9.2 Product (state machine)
- Status: `purchased → in_inventory → for_sale → sold | melted | undecided`
- 14 gün GDPR kilidi: `gdpr_release_date`, `is_gdpr_locked`
- Soft delete: `deleted_at`, `deleted_by_user_id`
- Photos JSON array
- WooCommerce sync: `woocommerce_product_id`, `published_at`, `is_published_to_site`, `shop_*`
- AI: `ai_description`, `ai_description_approved`
- Inventory: `inventory_category` (kulce/sikke/taki/gumus/platin_pd), `inventory_subcategory`, `operation_destination`, `operation_classification`
- Audit: → ProductHistory

### 9.3 PosSession + PosSessionLine
**PosSession (DRAFT → CONFIRMED → CANCELLED):**
- customer_id (RESTRICT FK)
- clerk_user_id (operatör)
- product_type, metal_type, weight_grams (özet)
- final_offer_dkk, live_rate_dkk, rate_source (LIVE | MANUAL)
- display_token (public route için)
- session_code, status, notes (JSON yapısı)

**PosSessionLine** (workspace satırları, finalize öncesi):
- line_no, product_type, metal_type
- weight_grams, purity_*, rate_dkk, margin_percent_internal, line_offer_dkk

### 9.4 Transaction + PosDocument + TransactionLine
**Confirm sonrası:**
- POS oturumu kalıcı belgeye dönüşür: `PosDocument` (sequence_no PK, auto-increment)
- `Transaction` 1:1 PosDocument ile
- `TransactionLine[*]` — `product_id` ilk başta NULL; Log route'unda atanır
- `TransactionLine.melt_lot_id` — Lot create veya route ile bağlanır
- Uniconta sync alanları (PosDocument): `uniconta_sync_status`, `uniconta_invoice_number`, `uniconta_pdf_path`, `uniconta_synced_at`, `uniconta_sync_error`

### 9.5 AfgMeltLot + AfgMeltLotHistory (yeni — M4)
**AfgMeltLot:**
- `metal_bucket` (gold | silver)
- `status` (draft | finalized) — finalize → immutable
- `before_*` (lot create snapshot): weight, amount_dkk, pure_gold_grams
- `after_pure_gold_grams` (operatör girişi)
- `insurance_dkk`, `shipping_dkk`, `refining_dkk` (giderler)
- `sale_date`, `quote_eur`, `exchange_rate_dkk`, `payout_total_dkk`
- `finalized_at`, `finalized_by_user_id`
- Auto-attach: yeni `TransactionLine.melt_lot_id`'ler create veya route'la bağlanır

**AfgMeltLotHistory:** action (created | updated | finalized | reopened | deleted), payload_json, performed_by, performed_by_email

### 9.6 Audit tabloları
- **PosDocumentAudit** (yeni — 0018): finalize | edit | delete | cancel | uniconta_retry | uniconta_auto_sync | uniconta_auto_failed | uniconta_auto_skipped | uniconta_bulk_retry
- **AfgMeltLotHistory** (yeni — 0019): lot lifecycle audit
- **ProductHistory**: status_change, field_update, melt, sale, wc_sync, foto_uploaded

### 9.7 GDPR modelleri (5 tablo, migration 0014-0015)
- GdprRequest, GdprRequestEvent, GdprJob, GdprProcessor, GdprRetentionPolicy

### 9.8 Diğer
- `ReferenceSequence` — auto-numbering (POS_REFERENCE_START=9600 + scan_window=5000)
- `AIUsageLog` — OpenAI token + cost tracking
- `WooCommerceSyncLog` — WC publish audit
- `DocumentArtifact` — XLSX/PDF cache + version
- `PosSessionProductLink` — LEGACY sale akışı için (AFG'de boş kalır)

### 9.9 Alembic migration tarihçesi (19 sürüm)
| Rev | Açıklama |
|---|---|
| 0001 | User, Product, Customer, Role enum'ları |
| 0002 | PosSession, CustomerIdentity |
| 0003 | AI usage log |
| 0004 | PosDocument + numbering |
| 0005 | ReferenceSequence |
| 0006 | Transaction, TransactionLine |
| 0007 | PosSessionLine |
| 0008 | Customer postal_code |
| 0009 | Product metadata JSONB |
| 0010 | AfgMeltLot ilk hali |
| 0011 | PosSession.customer_id nullable |
| 0012 | Product soft delete |
| 0013 | DocumentArtifact |
| 0014 | GDPR modülü |
| 0015 | GDPR runner + WC customer map |
| 0016 | PosDocument.uniconta_* sync alanları |
| 0017 | PosSession.customer_id ondelete=RESTRICT |
| 0018 | PosDocumentAudit (alış lifecycle audit) |
| **0019** | **AfgMeltLot.status + AfgMeltLotHistory + TransactionLine.melt_lot_id** (HEAD) |

---

## 10. Excel Referans Uyumu

Bu proje sadece modern bir UI değildir; mevcut Excel yapısının iş kuralı uyarlamasıdır.

Referans kaynaklar:
- `referans/`
- `docs/referans/`
- `docs/referans/REFERENCE_DATA_DICTIONARY_TR.md`
- `docs/referans/EXCEL_TO_CRM_FIELD_MAP.csv`

Uyum sağlanan ana alanlar:
- Afregningsbilag müşteri alanları
- kalem tablosu (gold rows / silver rows)
- variable værdier numaralandırma mantığı
- Lager / depolama kolon mantığı
- log sistemi blok mantığı (S/H/D route kodları)

OnlyOffice WOPI ile aynı Excel'i hem CRM içinde hem dışında düzenleme mümkün — bu Excel referansının canlı uzantısıdır.

---

## 11. Canlı POS ve Müşteri Ekranı Akışı

### 11.1 Satıcı ekranı (operatör)

Akış özeti:
1. müşteri seçilir veya yeni form
2. POS workspace açılır (DRAFT)
3. altın matris satırları doldurulur (gram + saflık)
4. canlı rate (live_rate_dkk) ve marj otomatik hesaplanır
5. teklif tutarı totaller
6. müşteri kabul ederse "Kaydet (Ctrl+S)" — Finalize
7. PosDocument oluşur, Uniconta'ya senkronize edilir, PDF cache'lenir
8. Log modülüne geçilir — satır rota ataması yapılır

### 11.2 Müşteri ekranı (ikinci monitör)

Akış:
- `/display/idle` — bekleme durumu (büyük saat + marka logosu)
- `/display/{token}` — aktif müşteri oturumu

Veri akışı:
1. backend snapshot döndürür (`PosSessionDisplayOut`)
2. frontend WebSocket'e bağlanır (`/display/{token}/ws`)
3. satır ekleme / güncelleme / silme olayları anlık görünür
4. müşteri **sadece customer-safe veriyi** görür

**Tema:** Minimal White + Yeşil (`#1F6B3F` aksent) — Detailed Form sidebar + Premium Editorial T5 tablo + Emerald F7 footer.

**Customer-safe filtre (asla gösterilmez):**
- CPR
- belge numarası
- marj / iç notlar
- storage location
- audit alanları

---

## 12. AI ve WooCommerce Entegrasyonu

### 12.1 AI
Config:
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_SECONDS`

Rolü:
- ürün foto + metadata okuyup Danca SEO paketi (title, short description, long HTML, meta description, slug) üretmek
- AI Usage Log tablosu ile token cost tracking

### 12.2 WooCommerce
Config:
- `WOOCOMMERCE_BASE_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`, `WOOCOMMERCE_WEBHOOK_SECRET`

WordPress media bağlantısı:
- `WORDPRESS_BASE_URL`, `WP_APP_USERNAME`, `WP_APP_PASSWORD`

Desteklenen akışlar:
- son canlı ürünleri import etme
- müşterileri import etme
- CRM ürününü siteye publish etme (POST `/products` veya PUT `/products/{wc_id}`)
- Woo raw data inceleme
- satış senkron kontrolü
- webhook ile sold durumuna çekme
- `update_order_meta` — manuel override write (yeni — O9'la birlikte)

---

## 13. Anti-Fraud (OPMC) Modülü

### 13.1 Hedef
- WC siparişlerinden OPMC + AI risk meta'larını çekme
- teknik olmayan insan diline çevirme
- false positive'leri operatör tarafından düzeltilebilir kılma

### 13.2 Risk skoru hesabı
1. **Score sources** (priority):
   - OPMC (`wc_af_score`) — priority 100 (kural-tabanlı, en güvenilir)
   - AI (`_ai_risk_score`) — priority 90 (yorumlama açık olduğundan ikinci)
2. **Score range:** 0-100 clamp; dışı reddedilir
3. **Score level:** ≥70 high, ≥35 medium, <35 low; None → unknown

### 13.3 Override zinciri (yeni — O5/O6/O7/O9)
Effective level seçimi şu sırayla:
1. **Manuel override** (operatör flag'lemiş) → kesin sonuç
2. **Blacklist** (`_wc_af_blacklisted` meta) → high
3. **Whitelist** (`whitelist_action` set) → low
4. **Known customer** (3+ başarılı sipariş + son 365gün) → high→medium, medium→low
5. Varsayılan score-based level

### 13.4 Kritik bug fix (2026-05) — `_extract_score_from_value`
**Sorun:** Eski regex `r"(-?\d+(?:[.,]\d+)?)"` AI metnindeki ilk sayıyı yakalıyordu — `"%100 güvenli kullanıcı"` → 100 risk.

**Çözüm:** Sadece numeric type + explicit dict key + JSON-encoded number. Regex tamamen kaldırıldı.

**Doğrulama:** `backend/tests/test_antifraud_reasons.py` + manuel 12-case test smoke.

---

## 14. Medya ve Foto Akışı

- backend `/media` altında static servis
- dosyalar `data/uploads/` altında
- yükleme sonrası AVIF/JPEG/PNG otomatik kontrol
- max boyut `PHOTO_MAX_SIZE_MB=15`
- primary image mantığı
- AI ve Woo publish süreci aynı foto havuzunu kullanır
- Depolama drawer'da foto upload UI (`onUploadPhotos` mutation)

---

## 15. Güvenlik Katmanı

### 15.1 Authentication
- access + refresh JWT
- frontend 401 → refresh; fail olursa logout
- HTTPBearer dependency

### 15.2 Hassas veri (field encryption)
- `FIELD_ENCRYPTION_KEY` (32 byte base64)
- AES-GCM
- CPR, adres, hassas müşteri alanları için

### 15.3 CORS
- `CORS_ORIGINS` `.env`'den csv
- production'da tight liste

### 15.4 Customer-safe veri ayrımı
- Display tarafına dogrudan admin modeli basmak yerine ozet / snapshot modeli kullanılır
- `_to_display_out()` sadece güvenli alanları döndürür

### 15.5 Concurrent edit guard
- POS finalize: `SELECT...FOR UPDATE` row lock
- Product edit: `expected_updated_at` precondition (409 Conflict)
- MeltLot edit: aynı precondition

### 15.6 Audit trail
- 3 audit tablosu: `PosDocumentAudit`, `AfgMeltLotHistory`, `ProductHistory`
- Manuel override + retry attempts loglanır
- Bogføringsloven §10 ve GDPR keep_restrict ile 5 yıl korunur

### 15.7 Bilinen güvenlik açıkları (üretim öncesi kapatılmalı)
> Detaylı liste: `docs/PROJECT_HEALTH_AUDIT.md` §2.1.A

- ⚠️ `.env` credential'ları repo'da committed (rotation gerek)
- ⚠️ JWT/encryption default secret'ları prod'da değişmiş olmalı
- ⚠️ Nginx HTTPS yok (TLS terminator + HSTS gerek)
- ⚠️ CSRF middleware yok
- ⚠️ Rate limit yok
- ⚠️ Backup encryption yok

---

## 16. Konfigürasyon ve Ortam Değişkenleri

Ana ayar dosyaları:
- `.env` — local credential'lar (repo'da committed — UYARI: rotasyon gerek)
- `.env.example` — şablon

Config sınıfı: `backend/app/config.py` (pydantic-settings).

**Önemli kategoriler:**
- Database: `DATABASE_URL`, `DATABASE_AUTO_CREATE`
- JWT: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRE_MINUTES`, `JWT_REFRESH_EXPIRE_DAYS`
- Encryption: `FIELD_ENCRYPTION_KEY`, `ONLYOFFICE_JWT_SECRET`
- CORS: `CORS_ORIGINS`
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_SECONDS`
- WooCommerce: `WOOCOMMERCE_BASE_URL`, `WOOCOMMERCE_CONSUMER_KEY/SECRET/WEBHOOK_SECRET`
- WordPress: `WORDPRESS_BASE_URL`, `WP_APP_USERNAME`, `WP_APP_PASSWORD`
- Uniconta: `UNICONTA_API_URL/USERNAME/PASSWORD/API_KEY/COMPANY_ID`
- Uniconta toggle (yeni): `UNICONTA_SEND_EMAIL_ON_FINALIZE`, `UNICONTA_SEND_XML_ON_FINALIZE`
- Invoice: `INVOICE_NUMBER_PREFIX`, `INVOICE_SELLER_*`
- Inventory market prices: `INVENTORY_MARKET_GOLD_DKK`, `_SILVER_DKK`, `_PLATINUM_DKK`, `_PALLADIUM_DKK`
- Media: `MEDIA_ROOT_DIR`, `DOCUMENT_ROOT_DIR`, `PHOTO_MAX_SIZE_MB`
- Office: `ONLYOFFICE_IMAGE`, `OFFICE_PROVIDER_*`, `OFFICE_RUNTIME_URL`, `ONLYOFFICE_CALLBACK_BASE_URL`
- Backup: `BACKUP_ROOT_DIR`, `BACKUP_KEEP_HOURLY/DAILY/WEEKLY`, `BACKUP_OFFSITE_*`, `BACKUP_CRON_*`
- Admin seed: `INITIAL_ADMIN_EMAIL/PASSWORD/NAME`, `INITIAL_ADMIN_AUTO_SEED`
- Desktop frontend: `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`

> Tam liste için bkz. `docs/HANDOVER.md` §13.

---

## 17. Geliştirme Komutları

Ana komutlar `Makefile` üzerinden erişilebilir (40+ target).

### 17.1 Geliştirme
- `make setup` — Lokal dev ortamı kurulumu
- `make desktop-dev` — Tauri masaüstü başlat (KANONİK)
- `make desktop-status` / `make desktop-stop` / `make desktop-restart`
- `make desktop-smoke` / `make desktop-smoke-doctor`
- `make demo-start` / `make demo-stop` / `make demo-seed` / `make demo-check` / `make demo-ready`
- `make seed-mock` — API'ye 20 müşteri + 20 ürün

### 17.2 Test
- `make backend-test` — pytest (32 dosya)
- `make frontend-typecheck` — `tsc --noEmit`
- `cd frontend && npm test` — Vitest (15 test)
- `cd frontend && npm run smoke` — Playwright E2E (1 test)
- `make integration-smoke` — AI + WC publish E2E
- `make test` / `make check`

### 17.3 Backup ve GDPR
- `make backup` / `make backup-verify` / `make backup-offsite` / `make backup-restore-drill`
- `make backup-cron-install` / `make backup-cron-uninstall`
- `make backup-rclone-setup`
- `make gdpr-scan` / `make gdpr-runner` / `make gdpr-smoke` / `make gdpr-smoke-live`
- `make gdpr-systemd-install` / `make gdpr-systemd-status` / `make gdpr-systemd-uninstall`

### 17.4 Production
- `make prod-bootstrap` — Üretim .env güvenli default
- `make bootstrap-admin` — İlk admin oluştur/güncelle
- `make readiness-smoke` — `/readyz` canlı kontrol
- `make release-desktop` — Frontend build + Tauri --release
- `make restore-from-backup` — Backup arşivi kontrollü extract

### 17.5 Script seviyesi
- `scripts/setup-dev.sh`
- `scripts/desktop-dev.sh`
- `scripts/demo-start.sh`, `demo-seed.sh`, `demo-stop.sh`
- `scripts/integration-smoke.sh`
- `scripts/bootstrap-admin.py`, `seed_mock_data.py`, `gdpr-runner.py`

---

## 18. Test ve Doğrulama

### 18.1 Backend (pytest)
- 32 test dosyası, ~150 test case
- Kritik: `test_afg_roundtrip.py`, `test_log_ark1_roundtrip.py`, `test_pos_*.py` (8), `test_gdpr_*.py` (2), `test_migration_portability.py`, `test_antifraud_reasons.py`, `test_security.py`

### 18.2 Frontend (Vitest + Playwright)
- `__tests__/cpr.test.ts` — 5 test (CPR mod-11 validation)
- `__tests__/format.test.ts` — 6 test (formatRelativeTime + Intl)
- `__tests__/toast.test.tsx` — 2 test (RTL provider)
- `smoke.spec.ts` — Playwright 1 test (auth + dashboard)
- **Toplam:** 15 Vitest + 1 Playwright (E2E coverage düşük; bkz. PROJECT_HEALTH_AUDIT §2.1.B)

### 18.3 Desktop smoke
- `make desktop-smoke` — Tauri webdriver
- `make desktop-smoke-doctor` — webkit2gtk-driver + tauri-driver kontrolü
- Detay: `docs/DESKTOP_SMOKE_PREREQUISITES_TR.md`

### 18.4 Test stratejisi
3 seviyeli:
1. unit / helper testi (`cpr`, `format`, `toast`, `antifraud_helpers`)
2. API davranış testi (pytest)
3. demo / smoke test (`make demo-check`, `make desktop-smoke`, `make integration-smoke`)

---

## 19. Backup ve Veri Güvenliği

Veri dizinleri:
- `data/backups/` — GFS rotasyonlu (hourly 48 / daily 30 / weekly 12)
- `data/offsite-mirror/` — rclone mirror hedef
- `data/restore-drill/` — restore tatbikatı geçici alan
- `data/uploads/` — ürün foto
- `data/documents/uniconta/` — Uniconta PDF cache
- `data/desktop.db` — SQLite (dev)

Desteklenen operasyonlar:
- GFS backup (`make backup`)
- Backup verify (`make backup-verify`)
- Restore drill (`make backup-restore-drill`)
- Offsite sync (`make backup-offsite` — rclone)
- Cron kurulumu (`make backup-cron-install`)
- Restore (`make restore-from-backup`)

**Lokal desktop kurulumunda kritik öneme sahiptir** — verinin tek makinede olması durumunda backup yoksa sistem güvenli değildir. Üretim için backup encryption (gpg/age) eklenmelidir.

---

## 20. Modüller Arası Sync (Cross-module BroadcastChannel)

`src-v2/lib/artifactSync.ts` — `BroadcastChannel` + `localStorage` event + `CustomEvent` kombinasyonu.

**Trigger matrisi (`DEFAULT_CROSS_TRIGGERS`):**
- `alis` → `['log', 'depolama']`
- `log` → `['depolama', 'alis']`
- `depolama` → `['log']`
- `uniconta` → `['alis']`

Her modülün listener'ı `signalMatches(signal, kind)` ile hem direkt sinyali hem cross-module trigger'ı yakalar. Office runtime (OnlyOffice) cell edit'leri de bu kanaldan iletilir.

**Örnek senaryo:** Alış finalize → `kind='alis'` emit → DEFAULT_CROSS_TRIGGERS ile `triggers=['log','depolama']` enjekte edilir → Log + Depolama sayfaları otomatik invalidate eder.

---

## 21. Üretim ve Operasyon Açısından Gerçek Durum

Şu an sistem hibrit bir yapıdadır:
- teknik olarak web stack olarak çalışabilir
- pratikte lokal Tauri masaüstü kullanımı **birincil hedeftir**

Bu iyi bir karardır çünkü:
- kuyumcunun operasyonu tek lokasyonda
- iki ekranlı kullanım senaryosu var (operatör + müşteri)
- shop içinde server karmaşıklığı ilk fazda gereksiz

Ama şunlar unutulmamalıdır:
- backup zorunludur (cron veya systemd timer)
- config / secret yönetimi düzeltilmelidir (`.env` rotation)
- ileride çoklu cihaz gereksinimi çıkarsa merkezi deployment düşünülmelidir
- Uniconta singleton cache multi-worker safe değil — `--workers 1` zorunlu

---

## 22. Şu Anki Güçlü Taraflar

- frontend ve backend net ayrılmış
- Tauri ile lokal kullanım destekleniyor (Hyprland/X11 fallback otomatik)
- AI + Woo + display + anti-fraud + Uniconta + GDPR aynı çatı altında
- POS ve envanter aynı veri modeli üzerinde birleşiyor
- Referans Excel yapısına sadık kalma niyeti mevcut (OnlyOffice WOPI ile)
- 5 modülde son ay'da yapılan refactor (51 madde otonom): Alış (P5-P16), Depolama (D1-D15), Log (L1-L18), Uniconta (U1-U16), OPMC (O1-O12), Modüller arası (M1-M5)
- Tam audit trail (3 tablo + 10+ event türü)
- 19 Alembic migration + 32 pytest dosya
- GFS backup + rclone offsite + restore drill
- Cross-module sync (BroadcastChannel + DEFAULT_CROSS_TRIGGERS)
- TypeScript strict + Pydantic v2 typed kombinasyonu

---

## 23. Şu Anki Teknik Borç / İyileştirme Alanları

> Detay: `docs/PROJECT_HEALTH_AUDIT.md`

- ⚠️ Frontend test coverage düşük (3 dosya, 15 test) → ≥15 dosya hedef
- ⚠️ E2E Playwright 1 smoke → ≥15 scenario
- ⚠️ `.env` credential'ları repo'da açık (KRİTİK)
- ⚠️ JWT/encryption default secret'lar prod'da değişmiş olmalı
- ⚠️ Nginx HTTPS yok (web stack için)
- ⚠️ Backup encryption yok
- ⚠️ Multi-worker safety: token cache + DebtorClient cache process-singleton
- ⚠️ Tauri Windows/Mac test edilmedi, code signing yok
- ⚠️ Password reset akışı yok
- ⚠️ Admin user CRUD UI yok
- ⚠️ Sentry/error tracking yok
- ⚠️ `pos_service.py` çok büyük (~2200 sat) → refactor adayı
- ⚠️ `useAlisMakeState.ts` çok büyük (~1700 sat) → alt-hook'lara böl

---

## 24. Öncelikli Sonraki Adımlar

> Detay: `docs/PROJECT_HEALTH_AUDIT.md` §8.3

### Sprint 1 (1-2 hafta)
1. `.env` credential rotation + secrets manager
2. Nginx HTTPS/HSTS (web stack için)
3. Frontend E2E coverage: 1 → 5 scenario
4. Backup encryption (gpg)

### Sprint 2 (3-4 hafta)
5. Sentry entegrasyonu + structured logging
6. Password reset akışı
7. Admin user CRUD UI
8. Tauri Windows test + code signing

### Sprint 3 (5-6 hafta)
9. Multi-worker safety (Redis cache)
10. Performance audit + N+1 query fix
11. WCAG 2.1 AA audit
12. Audit log UI

---

## 25. Takım İçin Kullanım Notu

Bu projede çalışırken en sağlıklı zihinsel model şu olmalıdır:
- bu bir web sitesi değil
- bu bir kuyumcu operasyon sistemi
- her ekran ya satıcı hızını artırmalı ya da müşteriye güven vermelidir

Dolayısıyla her yeni geliştirme şu üç soruya cevap vermelidir:
1. Bu değişiklik Recai Bey'in işini daha hızlı hale getiriyor mu?
2. Bu değişiklik müşteri ekranında daha güven veren bir deneyim sağlıyor mu?
3. Bu değişiklik mevcut Excel operasyon mantığını kaybetmeden sistemi daha iyi hale getiriyor mu?

---

## 26. Bu Belgenin Kapsamı ve Bağlı Belgeler

Bu belge **ana merkez dokümandır**.

Destekleyici belgeler:
- `docs/HANDOVER.md` — Detaylı teknisyen devir kılavuzu
- `docs/PROJECT_HEALTH_AUDIT.md` — Sağlık denetimi + roadmap
- `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` — Production deploy
- `docs/DEV_RUNTIME_PROTOCOL.md` — Dev runtime ayar protokolü
- `docs/DESKTOP_SMOKE_PREREQUISITES_TR.md` — Desktop smoke önkoşullar
- `docs/GDPR_TAURI_SMOKE_TR.md` — GDPR smoke test
- `docs/WORDPRESS_GDPR_BRIDGE_TR.md` — WP GDPR bridge
- `docs/referans/README.md` — Excel referans dokümanı
- `AGENTS.md` — Dev ajan kuralları
- `Makefile` — Tüm operasyon komutları

---

## 27. Sonuç

Sero Guld CRM artık sadece "frontend" ve "backend" diye ayrı düşünülmemelidir.

Bu proje:
- admin operasyon paneli
- müşteri görünüm paneli
- lokal masaüstü uygulaması (Tauri)
- WooCommerce entegrasyon katı
- Uniconta muhasebe entegrasyonu
- AI içerik motoru
- anti-fraud (OPMC) izleme paneli
- GDPR cockpit + retention runner
- belge / rapor / backup altyapısı
- OnlyOffice canlı Excel düzenleme

olarak **birlikte ele alınmalıdır**.

Bu dökümanın amacı da tam olarak budur: sistemi tek bir ürün olarak anlatmak.

---

> **Sürüm notları (2026-05-18):**
> - 5 modülde 51 maddelik otonom refactor tamamlandı (Alış, Depolama, Log, Uniconta, OPMC).
> - OPMC kritik parse bug çözüldü (yıllarca güvenli müşteriye 100 risk atayan).
> - Cross-module BroadcastChannel sync zinciri eklendi.
> - 3 yeni audit tablosu (PosDocumentAudit, AfgMeltLotHistory) + 0019 migration.
> - GDPR retention `afg_melt_lots` policy eklendi.
> - HANDOVER.md + PROJECT_HEALTH_AUDIT.md doğrultusunda bu doc kapsamlı revize edildi.
