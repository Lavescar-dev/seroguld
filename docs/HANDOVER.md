# Sero Guld CRM — Teknisyen Devir (Handover) Dokümantasyonu

> **Amaç:** Sıfır bilgiyle gelen yeni bir geliştiricinin/teknisyenin projeyi *kendi başına* devralabilmesi için tasarlanmış kapsamlı kaynak. Mevcut `docs/PROJECT_SYSTEM_GUIDE_TR.md` "ne yaptığını" anlatır; bu dosya **"nasıl çalıştığını, nereye bakılacağını, neyin eksik olduğunu"** anlatır.
>
> **Son güncelleme:** 2026-05-18 · **Versiyon:** v1.0 (kapsamlı revizyon)
> **Repo kökü:** `/mnt/SSD/Clients/Recai_Demir/seroguld-crm`

---

## İçindekiler

1. [TL;DR — 3 dakikada proje](#1-tldr--3-dakikada-proje)
2. [İş bağlamı ve hedefler](#2-iş-bağlamı-ve-hedefler)
3. [Teknoloji yığını](#3-teknoloji-yığını)
4. [Dizin yapısı (referans haritası)](#4-dizin-yapısı-referans-haritası)
5. [Sistem mimarisi](#5-sistem-mimarisi)
6. [Geliştirme ortamı kurulumu](#6-geliştirme-ortamı-kurulumu)
7. [Çalışma rutinleri (günlük komutlar)](#7-çalışma-rutinleri-günlük-komutlar)
8. [Backend modülleri (her birinin detayı)](#8-backend-modülleri)
9. [Frontend modülleri (her birinin detayı)](#9-frontend-modülleri)
10. [Veri modeli + iş akışları](#10-veri-modeli--iş-akışları)
11. [API endpoint kataloğu](#11-api-endpoint-kataloğu)
12. [Tauri desktop runtime](#12-tauri-desktop-runtime)
13. [Konfigürasyon (.env) referansı](#13-konfigürasyon-env-referansı)
14. [Test, build, deploy](#14-test-build-deploy)
15. [Sorun giderme (FAQ)](#15-sorun-giderme-faq)
16. [Mimari kararlar ve gerekçeleri](#16-mimari-kararlar-ve-gerekçeleri)
17. [Proje sağlık değerlendirmesi (analiz)](#17-proje-sağlık-değerlendirmesi-analiz)
18. [Bilinen eksikler ve önerilen roadmap](#18-bilinen-eksikler-ve-önerilen-roadmap)
19. [Operasyonel runbook (ops cheatsheet)](#19-operasyonel-runbook)
20. [Glossary (Danca/Türkçe/İngilizce terimler)](#20-glossary)

---

## 1. TL;DR — 3 dakikada proje

**Sero Guld CRM**, Danimarkada Valby'de bulunan **Sero Guld og Sølv ApS** (CVR 34093083) firması için geliştirilen **kuyumcu CRM + POS + envanter + e-ticaret entegrasyon** sistemidir. İkinci el altın/gümüş alım-satımı yapan firma için Excel tabanlı operasyonu dijitalleştirir.

**Temel iş akışı (mental model):**
```
[Müşteri kapıdan girer]
        ↓
[Alış modülü] → Müşteri seçimi → Altın/gümüş satırları → Oran + Avance hesabı → Finalize
        ↓                                                                        ↓
        ├── AFG belgesi (Afregningsbilag) PDF                          [Uniconta] DebtorInvoice
        ↓                                                                        ↓
[Log modülü] → AFG satırlarına rota ata: Envanter / Eritme / Kararsız
        ↓
[Depolama] (envanter) ←─── Eritme havuzu ──→ [Log: Eritme Lotu] → Payout/Avance
        ↓
[WooCommerce] yayına gönder → [OPMC] anti-fraud risk skoru
        ↓
[Satış] → SOLD state → 5 yıl GDPR retention (Bogføringsloven §10)
```

**Ana uygulama yüzeyi:** Linux Hyprland/X11 üzerinde **Tauri 2 desktop**. Backend: **FastAPI** Python 3.12. Frontend: **React 18 + Vite + TypeScript**. Veritabanı: dev'de **SQLite**, prod'da **PostgreSQL 16**.

**Çalıştırma:** `make desktop-dev` (her şey otomatik). Tek komutla backend (8100), frontend Vite (3300), Tauri pencere başlar.

---

## 2. İş bağlamı ve hedefler

**Müşteri:** Recai Demir (Sero Guld og Sølv ApS sahibi).

**Çözülen problemler:**
- Excel tabanlı, manuel hata payı yüksek alım-satım defter tutma.
- AFG belgeleri (Afregningsbilag = Danimarka'da müşteriden satın alma faturası) elle yazılıyordu, kayıp/hatalı.
- Eritme lot'ları (külçeye dönüştürme operasyonu) hesaplama Excel'de, payout/avance/kur hesabı manuel.
- WooCommerce vitrini ile envanter senkronizasyonu yoktu (operatör hem WC admin'inde hem Excel'de aynı veriyi giriyordu).
- Uniconta muhasebe sistemine fatura aktarımı PDF + manuel kopyalamayla yapılıyordu.
- OPMC anti-fraud (WC eklentisi) sinyalleri WooCommerce admin'inde çok dağınık, hata yorumlamak zor.
- 5 yıllık yasal saklama (Danimarka Bogføringsloven §10) ihtiyacını karşılayan tek bir audit trail yoktu.

**Çözmeyen / dışında kalan:**
- Bankacılık entegrasyonu yok (manuel banka transferi).
- E-imza yok (alış belgesi imzasız PDF; müşteri kâğıda imza atıyor).
- ESC/POS thermal printer bağlantısı: backend bytes üretir, fiziksel kuyruğa atma operatörün PC sistem yazıcı kuyruğundan.

---

## 3. Teknoloji yığını

| Katman | Teknoloji | Sürüm | Notlar |
|---|---|---|---|
| **Frontend** | Vite | 6.3 | Build + dev server |
| | React | 18.3 | UI |
| | TypeScript | 5.7 | Strict mode |
| | Tailwind CSS | 3.4 | brand-* paletli, monoStyle/sansStyle helper'lar |
| | React Router | 6.30 | client-side routing |
| | TanStack Query | 5.80 | server state |
| | @react-pdf-viewer | 3.12 | PDF rendering (Tauri CSP-safe) |
| | reportlab | 4.2 (backend) | PDF üretimi |
| | lucide-react | 0.511 | İkonlar |
| **Backend** | FastAPI | latest | async REST |
| | SQLAlchemy | 2.0 (async) | ORM |
| | Alembic | latest | migration (19 sürüm) |
| | Pydantic | v2 | schema |
| | Uvicorn | latest | ASGI |
| | httpx | latest | WC, Uniconta, OpenAI istemcileri |
| | python-jose | latest | JWT |
| | bcrypt / passlib | latest | parola hash |
| **Veritabanı** | SQLite | 3.40+ | dev/desktop (`data/desktop.db`) |
| | PostgreSQL | 16 | prod (docker-compose) |
| **Desktop** | Tauri | 2.x | Rust shell + WebView |
| | webkit2gtk-4.1 | Linux WebView | X11 fallback (dev.js otomatik) |
| | WebView2 | Windows WebView | henüz test edilmedi |
| **Test** | pytest | latest | backend (32 dosya, 31 testler) |
| | Vitest | 4.1 | frontend (3 dosya, 15 test) |
| | Playwright | 1.54 | E2E smoke (1 test) |
| | @testing-library/react | 16.3 | RTL |
| **External** | WooCommerce REST API | v3 | sero guld site |
| | Uniconta Web API | latest | DebtorInvoice + DebtorClient |
| | OpenAI API | latest | AI ürün açıklaması |
| | OnlyOffice Document Server | 8.2.2 | WOPI Excel editing |
| | Collabora Online | 24.04 | fallback office runtime |
| **DevOps** | Docker Compose | v2 | postgres + onlyoffice + nginx |
| | rclone | latest | offsite backup mirror |
| | Makefile | GNU make | tüm dev/build/ops komutları |

---

## 4. Dizin yapısı (referans haritası)

```
seroguld-crm/                         # Repo kökü
├── AGENTS.md                         # AI ajan rehberi (21 sat)
├── Makefile                          # 40+ target — TÜM komutlar burada
├── docker-compose.yml                # Servisler: postgres, backend, frontend, onlyoffice, collabora, nginx
├── .env                              # ÜRETIM credential'ları (git'te DEĞIL — local only)
├── .env.example                      # şablon, tüm değişken referansı
│
├── backend/                          # FastAPI Python uygulaması
│   ├── alembic/versions/             # 19 migration dosyası (0001 → 0019)
│   ├── app/
│   │   ├── api/                      # 22 router modülü (HTTP endpoint katmanı)
│   │   ├── services/                 # 36 service modülü (iş mantığı)
│   │   ├── models/                   # 26 SQLAlchemy modeli
│   │   ├── schemas/                  # Pydantic şemaları
│   │   ├── utils/                    # cpr.py, helpers.py, security.py, env_file.py
│   │   ├── config.py                 # Settings (pydantic-settings)
│   │   ├── database.py               # async session
│   │   └── main.py                   # FastAPI app + lifecycle
│   ├── tests/                        # 32 pytest dosyası
│   └── pyproject.toml / requirements.txt
│
├── frontend/                         # React 18 + Vite + TypeScript
│   ├── src-v2/                       # KANONİK aktif kod (legacy src/ ihmal)
│   │   ├── app.tsx                   # Route definitions
│   │   ├── main.tsx                  # ReactDOM render + Providers
│   │   ├── types.ts                  # ~90 export type/interface
│   │   ├── make/                     # 15 modül (her biri kendi page + hook)
│   │   │   ├── alis/                 # POS purchase (2326 LOC)
│   │   │   ├── depolama/             # inventory (1667 LOC)
│   │   │   ├── log/                  # AFG melt log (1948 LOC)
│   │   │   ├── uniconta/             # ERP sync (1101 LOC)
│   │   │   ├── opmc/                 # anti-fraud (651 LOC)
│   │   │   ├── customers/            # müşteri yönetimi (871 LOC)
│   │   │   ├── dashboard/            # ana ekran (678 LOC)
│   │   │   ├── display/              # müşteri ekranı (400 LOC)
│   │   │   ├── gdpr/                 # GDPR (838 LOC)
│   │   │   ├── office/               # OnlyOffice (1182 LOC)
│   │   │   ├── woocommerce/          # WC sync (1424 LOC)
│   │   │   ├── settings/             # ayarlar (477 LOC)
│   │   │   ├── root/                 # AppShell (494 LOC)
│   │   │   ├── login/                # login page (300+ LOC)
│   │   │   └── excel/                # Excel preview (200 LOC)
│   │   ├── pages/                    # Page wrapper'ları (make/ → ana page binding)
│   │   ├── components/               # Ortak komponentler (AppShell, PdfViewerModal, vb.)
│   │   ├── lib/                      # api.ts, auth.ts, artifactSync.ts, toast.tsx, cpr.ts, format.ts
│   │   └── __tests__/                # Vitest (setup.ts, cpr.test.ts, format.test.ts, toast.test.tsx)
│   ├── legacy-next/                  # Next.js'in eski izi — IGNORE
│   ├── package.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── tsconfig.app.json
│   └── tailwind.config.js
│
├── desktop/                          # Tauri shell
│   ├── src-tauri/
│   │   ├── src/main.rs               # ~14k LOC Rust (multi-monitor, file picker, dev session)
│   │   ├── tauri.conf.json           # App config (CSP, bundle, window size)
│   │   └── Cargo.toml
│   └── dev.js                        # Otomatik backend + frontend + Tauri başlatıcı (Hyprland fallback)
│
├── data/                             # Runtime veri (gitignore)
│   ├── desktop.db                    # SQLite (dev/desktop)
│   ├── documents/                    # PDF, XLSX artifact cache
│   │   └── uniconta/                 # Uniconta DebtorInvoice PDF cache
│   ├── uploads/                      # photo upload
│   └── backups/                      # GFS yedekleri
│
├── docs/                             # Türkçe Markdown dokümanlar
│   ├── PROJECT_SYSTEM_GUIDE_TR.md    # 922 sat — eski genel doc
│   ├── HANDOVER.md                   # ⭐ BU DOSYA — devir kılavuzu
│   ├── PRODUCTION_DESKTOP_RUNBOOK_TR.md
│   ├── DESKTOP_SMOKE_PREREQUISITES_TR.md
│   ├── DEV_RUNTIME_PROTOCOL.md
│   ├── GDPR_TAURI_SMOKE_TR.md
│   ├── WORDPRESS_GDPR_BRIDGE_TR.md
│   └── referans/                     # Eski Next.js referansları
│
├── scripts/                          # Yardımcı komutlar
├── ops/                              # Backup/cron scriptleri
├── nginx/                            # Reverse proxy config (web stack)
├── .github/workflows/                # CI/CD pipeline
├── .run/                             # Runtime state (desktop-dev session JSON, vb.)
└── referans/                         # Ham referanslar (Excel örnek dosyaları vb.)
```

**Kuyumculuk için önemli not:** Repo'da Türkçe + Danimarkaca + İngilizce kelimeler karışık. `Afregningsbilag` = Türkçe karşılığı yok, doğrudan Danca terim. `AFG` = Afregningsbilag kısaltması. Hep aynı şeyi ifade eder.

---

## 5. Sistem mimarisi

### 5.1 Üst düzey diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TAURI Desktop (Linux/Win/Mac)                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  Rust shell (desktop/src-tauri/src/main.rs)                          │   │
│  │   • Multi-monitor window management                                  │   │
│  │   • File picker IPC bridge                                           │   │
│  │   • dev session JSON persistence                                     │   │
│  └──────────────────────────────────────┬───────────────────────────────┘   │
│                                         │                                   │
│                          ┌──────────────┴───────────────────┐               │
│                          │  WebView (WebKitGTK / WebView2)   │               │
│                          │  ──────────────────────────────   │               │
│                          │  React 18 SPA                     │               │
│                          │   • src-v2/make/{15 modül}        │               │
│                          │   • TanStack Query                │               │
│                          │   • react-router-dom              │               │
│                          │   • Tauri @tauri-apps/api         │               │
│                          └──────────────────┬────────────────┘               │
└─────────────────────────────────────────────┼───────────────────────────────┘
                                              │ HTTP + WebSocket
                                              ▼
                              ┌───────────────────────────────┐
                              │  FastAPI (uvicorn :8100)        │
                              │  ┌─────────────────────────────┐  │
                              │  │  app/api/ (22 router)          │  │
                              │  │   • v2_*.py modüler endpointler│  │
                              │  │   • require_admin gate         │  │
                              │  └────────────┬────────────────┘  │
                              │  ┌────────────┴────────────────┐  │
                              │  │  app/services/ (36 service)    │  │
                              │  │   • iş mantığı                 │  │
                              │  │   • integration adapter'ler    │  │
                              │  └────────────┬────────────────┘  │
                              │  ┌────────────┴────────────────┐  │
                              │  │  app/models/ (26 model)       │  │
                              │  │   • SQLAlchemy 2.0 async      │  │
                              │  └────────────┬────────────────┘  │
                              └───────────────┼──────────────────┘
                                              │
                          ┌───────────────────┼──────────────────────┐
                          ▼                   ▼                      ▼
                  ┌──────────────┐  ┌───────────────────┐  ┌──────────────────┐
                  │  SQLite      │  │  External Servis  │  │  Background      │
                  │  (dev)       │  │   • WooCommerce   │  │  Jobs (Makefile) │
                  │              │  │   • Uniconta API  │  │   • backup       │
                  │  PostgreSQL  │  │   • OpenAI        │  │   • gdpr-runner  │
                  │  (prod)      │  │   • OnlyOffice    │  │   • rclone sync  │
                  └──────────────┘  │   • Collabora     │  └──────────────────┘
                                    └───────────────────┘
```

### 5.2 İletişim kanalları

| Kanal | Yön | Kullanım |
|---|---|---|
| HTTP REST | Frontend → Backend | Ana API trafiği (`/api/v2/*`) |
| WebSocket | Backend → Frontend (push) | POS display realtime, clerk önizleme |
| BroadcastChannel | Frontend ↔ Frontend (multi-tab) | `artifactSync` cross-module invalidate |
| Tauri IPC | WebView ↔ Rust shell | Pencere yönetimi, file picker, dev session |
| WC REST | Backend → WooCommerce | Ürün yayını, sipariş çekme |
| Uniconta REST | Backend → Uniconta | DebtorInvoice, DebtorClient, fatura PDF |
| OnlyOffice WOPI | Frontend ↔ OnlyOffice ↔ Backend | Excel canlı düzenleme |
| OpenAI REST | Backend → OpenAI | Ürün açıklaması üretimi |

### 5.3 Auth modeli

- Tek role-tabanlı: `RoleEnum.ADMIN` (operatör) ve `RoleEnum.CUSTOMER` (GDPR public formları için).
- JWT access token: HTTPBearer, payload `sub=user_id` + `role`.
- Endpoints `Depends(get_current_user)` veya `Depends(require_admin)` ile korunur.
- Refresh token: 14 gün, ayrı endpoint.
- Public route'lar: `/auth/login`, `/api/v2/public/gdpr/*`, `/display/*` (token-based public).

---

## 6. Geliştirme ortamı kurulumu

### 6.1 Sistem önkoşulları

**Linux (test edilmiş — Hyprland/CachyOS):**
- Python 3.12+
- Node.js 20+ + npm
- Rust toolchain (Tauri için): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- webkit2gtk-4.1 + dev headers
- gtk3, openssl-dev, librsvg
- Wayland varsa: X11 fallback otomatik (`dev.js` GDK_BACKEND=x11 setler)

**Windows:**
- Python 3.12, Node 20, Rust, Visual Studio Build Tools, WebView2 runtime.
- Henüz test edilmedi. Tauri docs uyumluluk listesini takip et.

### 6.2 İlk kurulum (one-shot)

```bash
cd /mnt/SSD/Clients/Recai_Demir/seroguld-crm
make setup
```

Bu komut:
1. `backend/.venv` oluşturur, `pip install -e backend` çalıştırır.
2. `frontend/` içinde `npm install` çalıştırır.
3. Desktop `cargo` cache'ini hazırlar (`desktop/src-tauri/target/`).

### 6.3 .env hazırlama

```bash
cp .env.example .env
# .env'i editle: WC, Uniconta, OpenAI credential'ları
# (Üretim repo'sunda .env hâlâ committed olduğundan dikkat — H17.1 bkz.)
```

Minimum çalıştırma için zorunlu değerler:
- `DATABASE_URL` (SQLite default OK)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (en az 32 byte)
- `FIELD_ENCRYPTION_KEY` (base64, 32 byte)

### 6.4 İlk admin oluşturma

`.env`'deki `INITIAL_ADMIN_*` değerleri ile:
```bash
make bootstrap-admin
```

Veya `INITIAL_ADMIN_AUTO_SEED=true` ise app start sırasında otomatik.

---

## 7. Çalışma rutinleri (günlük komutlar)

### 7.1 Geliştirme

```bash
make desktop-dev        # Tauri masaüstü (ana mod) — 8100 + 3300 + Tauri pencere
make desktop-stop       # Graceful shutdown
make desktop-restart    # Stop + start (mevcut config korunur)
make desktop-status     # Aktif session bilgisi (.run/desktop-dev-session.json)

make demo-start         # Tauri olmadan sadece web (backend:8100 + frontend:3300)
make demo-seed          # 20 müşteri + 20 ürün test data
make demo-check         # MVP smoke (login/dashboard/POS/display)
make demo-ready         # demo-start + demo-seed + demo-check zinciri
```

### 7.2 Test

```bash
make backend-test                 # pytest (32 dosya)
cd frontend && npm run typecheck  # tsc --noEmit (TypeScript)
cd frontend && npm test           # Vitest 15 test
cd frontend && npm run smoke      # Playwright E2E (1 test)
make integration-smoke            # AI + WC publish E2E
make check                        # tüm test+typecheck+lint zinciri
```

### 7.3 Migration

```bash
cd backend
.venv/bin/alembic upgrade head                # Forward
.venv/bin/alembic downgrade -1                # Rollback
.venv/bin/alembic revision --autogenerate -m "yeni alan"   # Yeni migration
.venv/bin/alembic current                     # Mevcut head
.venv/bin/alembic history | head -30          # Tarihçe
.venv/bin/alembic stamp 0019_log_module_audit # Manuel stamp (SQLite create_all sonrası)
```

### 7.4 Backup ve GDPR (operasyonel)

```bash
make backup                  # GFS rotasyonlu (hourly+daily+weekly)
make backup-verify           # son backup integrity check
make backup-offsite          # rclone mirror'a sync
make backup-restore-drill    # restore tatbikatı
make backup-cron-install     # crontab kur (otomatik backup)

make gdpr-scan               # retention scan
make gdpr-runner             # GDPR job queue process
make gdpr-systemd-install    # user systemd timer + service
```

### 7.5 Production

```bash
make prod-bootstrap          # üretim .env güvenli default'larla doldurur
make release-desktop         # frontend build + Tauri --release
make readiness-smoke         # /readyz canlı kontrol
```

---

## 8. Backend modülleri

### 8.1 `app/api/` — Router katmanı (22 dosya)

| Dosya | Path prefix | Sorumluluk |
|---|---|---|
| `bootstrap.py` | `/api/bootstrap` | İlk uygulama açılışı; current user, dashboard counts |
| `auth.py` | `/api/auth` | Login, refresh, me |
| `customers.py` | `/api/customers`, `/api/musteriler` | Customer CRUD, search |
| `customer_portal.py` | `/api/customer-portal` | Müşteri self-service (CUSTOMER role) |
| `pos.py` | `/api/pos` | POS session/transaction (legacy + display WS) |
| `products.py` | `/api/products` | Photo upload, AI describe, WC publish |
| `inventory.py` | `/api/inventory` | Legacy depolama (yeni: `v2_inventory.py`) |
| `afg.py` | `/afg` (internal) | AFG workspace + melt lot + route batch-apply |
| `antifraud.py` | `/api/v2/opmc` | OPMC risk skoru + manual override |
| `gdpr.py` | `/api/gdpr`, `/api/v2/gdpr`, `/api/v2/public/gdpr` | GDPR request/job/retention |
| `dashboard.py` | `/api/dashboard` | Eski analytics (yeni: `v2.py` içinde) |
| `reports.py` | `/api/reports` | Daily/weekly/monthly özet |
| `settings.py` | `/api/settings` | Genel ayarlar |
| `webhooks.py` | `/api/webhooks` | WooCommerce gelen webhook'lar |
| `deps.py` | — | FastAPI Depends helper'lar (`get_current_user`, `require_admin`) |
| **`v2.py`** | `/api/v2/*` | **Ana v2 router** — dashboard, customers, antifraud, settings, office runtime, uniconta. ~1700 sat. |
| **`v2_alis.py`** | `/api/v2/alis/*` | Alış modülü (purchase workspace, finalize, list, document detail, recipt) |
| **`v2_inventory.py`** | `/api/v2/depolama/*` | Depolama modülü (workspace, products CRUD, status, photo, label, history, source-afg) |
| **`v2_log.py`** | `/api/v2/log/*` | Log modülü (AFG defter workspace, melt lots, lines, history, PDF, finalize, retry) |
| **`v2_woocommerce.py`** | `/api/v2/woocommerce/*` | WC sync (publish, logs, customers import) |
| **`v2_office_runtime.py`** | `/api/v2/office-runtime/*` | OnlyOffice/Collabora WOPI bridge |
| `v2_support.py` | — | İçeride paylaşılan artifact helper'ları |

### 8.2 `app/services/` — İş mantığı (36 dosya)

#### Pos / Alış servisleri
- `pos_service.py` — Ana POS engine (workspace build, customer select, session lifecycle, line management). Bu dosya **çok büyük (~2200 sat)**, refactor için aday.
- `pos_workspace_state.py` — Display snapshot inşa (live view).
- `pos_workspace_mutations.py` — Mutasyon delegate'leri (replace_sections, finalize).
- `pos_workspace_exports.py` — Excel/CSV/HTML export.
- `pos_purchase_finalize.py` — Finalize akışı (lock + PosDocument oluşturma + Uniconta sync).
- `pos_purchase_documents.py` — Belge yenileme + edit_source mantığı.
- `pos_transaction_service.py` — Transaction + TransactionLine oluşturma.
- `pos_document_service.py` — `format_document_number()` vb. PosDocument helper'lar.
- `pos_receipt_renderer.py` — HTML/thermal receipt render.
- `pos_value_helpers.py` — Display label'leri (product_type, metal_type).
- `pos_display_service.py` — Müşteri ekranı snapshot serializer.

#### Inventory / Depolama
- `product_service.py` — Product CRUD, status state machine, history log, soft delete, GDPR lock auto-update.
- `photo_service.py` — Ürün fotoğrafı upload + thumbnail.

#### AFG / Log
- (afg.py içinde service-level fonksiyonlar inline: `build_log_workspace`, `apply_afg_route_requests_safe`, `create_afg_melt_lot`, `update_afg_melt_lot`, `finalize_afg_melt_lot`, `delete_afg_melt_lot`, `list_afg_melt_lot_history`, `list_afg_melt_lot_lines`)
- `lot_card_pdf.py` — AfgMeltLot PDF kartı (reportlab).

#### Document Artifact (OnlyOffice WOPI)
- `document_artifact_service.py` — Ana artifact CRUD + sync orchestration.
- `document_artifact_afg.py` — AFG workbook contract (cell→workspace mapping).
- `document_artifact_inventory.py` — Depolama workbook contract.
- `document_artifact_log.py` — Log workbook contract.
- `document_artifact_preview.py` — Excel preview render.
- `office_host_service.py` — WOPI host endpoint mantığı (file lock, checkout, save).

#### Integration
- `woocommerce.py` — WC REST client (fetch_recent_orders, fetch_order, update_order_meta, publish_product vb.).
- `woocommerce_import_helpers.py` — WC product import inference (kategori, ağırlık, SEO).
- `uniconta_service.py` — Uniconta async client (login/refresh, token cache, retry+backoff, DebtorClient cache, generate_debtor_invoice, sync_pos_document_to_uniconta, friendly_uniconta_error).
- `antifraud_service.py` — OPMC orders fetch + customer history pre-empt + manual override.
- `antifraud_helpers.py` — Risk score parse (O1 bug fix), whitelist/blacklist override, _resolve_effective_risk.
- `ai_service.py` — OpenAI Chat completion + cost tracking.
- `gold_price.py` — Canlı altın fiyatı (timeout + 20s cache).

#### GDPR
- `gdpr_service.py` — Retention policy seed, request lifecycle, runner.

#### Yardımcı
- `realtime.py` — WebSocket hub (display + clerk).
- `sequence_service.py` — Reference number üretimi (POS_REFERENCE_START + scan window).
- `dashboard_helpers.py` — Analytics aggregate'leri.
- `runtime_readiness.py` — `/readyz` endpoint logic.
- `thermal_label.py` — ESC/POS 62mm ürün etiketi.
- `thermal_receipt.py` — ESC/POS 80mm makbuz.
- `customer_service.py` — Customer CRUD service layer + activity tracking.

### 8.3 `app/models/` — SQLAlchemy modelleri (26 dosya)

```
user.py                            → User (auth + customer rolünde)
customer_identity.py               → CustomerIdentityDocument (kimlik tarama)
customer_activity.py               → CustomerActivityEvent (sipariş aktivitesi)

product.py                         → Product (envanter ana tablo)
product_history.py                 → ProductHistory (audit)
woocommerce_log.py                 → WooCommerceSyncLog

pos_session.py                     → PosSession (alış oturumu, customer_id FK ondelete=RESTRICT)
pos_session_line.py                → PosSessionLine (alış satırı, finalize öncesi)
pos_session_product_link.py        → PosSessionProductLink (legacy sale akışı için)
pos_document.py                    → PosDocument (AFG belgesi, finalize sonrası, uniconta_* alanları)
pos_document_audit.py              → PosDocumentAudit (finalize/edit/delete/uniconta_retry log)

transaction.py                     → Transaction (PosDocument'le 1:1)
transaction_line.py                → TransactionLine (product_id, melt_lot_id FK)

afg_melt_lot.py                    → AfgMeltLot (gold|silver bucket + status draft|finalized)
afg_melt_lot_history.py            → AfgMeltLotHistory (lot mutations audit)

document_artifact.py               → DocumentArtifact (XLSX, PDF cache)
reference_sequence.py              → ReferenceSequence (auto-numbering state)
ai_usage_log.py                    → AIUsageLog (OpenAI token cost tracking)

gdpr_request.py                    → GdprRequest (public form submissions)
gdpr_request_event.py              → GdprRequestEvent (lifecycle event log)
gdpr_job.py                        → GdprJob (async runner queue)
gdpr_processor.py                  → GdprProcessor (3rd party data processors)
gdpr_retention_policy.py           → GdprRetentionPolicy (5y financial, customer_master, afg_*)

enums.py                           → ProductStatusEnum, PosSessionStatusEnum, MetalTypeEnum, vb.
__init__.py                        → Tüm modellerin re-export'u
```

### 8.4 `app/schemas/` — Pydantic şemaları

`product.py`, `pos.py`, `customer.py`, `afg.py`, `gdpr.py`, `desktop_views.py`, `bootstrap.py`, `antifraud.py`, `inventory.py`, `document_artifact.py`, `base.py` (AppBaseModel + PaginatedResponse).

### 8.5 Alembic migration tarihçesi (19 sürüm)

| Rev | Açıklama |
|---|---|
| 0001 | User, Product, Customer, Role enum'ları |
| 0002 | PosSession, CustomerIdentity |
| 0003 | AI usage log |
| 0004 | PosDocument + numbering |
| 0005 | ReferenceSequence (auto-numbering) |
| 0006 | Transaction, TransactionLine |
| 0007 | PosSessionLine |
| 0008 | Customer postal_code |
| 0009 | Product metadata JSONB |
| 0010 | AfgMeltLot + history |
| 0011 | PosSession.customer_id nullable |
| 0012 | Product soft delete |
| 0013 | DocumentArtifact |
| 0014 | GDPR modülü (request/job/event/retention) |
| 0015 | GDPR runner + WC customer map |
| 0016 | PosDocument.uniconta_* sync alanları |
| 0017 | PosSession.customer_id ondelete=RESTRICT |
| 0018 | PosDocumentAudit |
| 0019 | AfgMeltLot.status + AfgMeltLotHistory + TransactionLine.melt_lot_id |

### 8.6 Test dosyaları (32 dosya, ~150+ test case)

Bkz. `backend/tests/`. Anahtar dosyalar:
- `test_afg_roundtrip.py` — AFG belgesi finalize + Uniconta sync e2e.
- `test_pos_*.py` — POS session lifecycle, multi-line, draft conflict, trade math.
- `test_antifraud_reasons.py` — OPMC reason builder.
- `test_customer_risk.py` — Müşteri risk metrikleri.
- `test_gdpr_*.py` — GDPR runner ve service.
- `test_office_host_service.py` — OnlyOffice WOPI sync.
- `test_migration_portability.py` — SQLite ↔ PostgreSQL migration.
- `test_security.py` — JWT + encryption helpers.

---

## 9. Frontend modülleri

### 9.1 Route haritası (`src-v2/app.tsx`)

| Path | Page komponenti | Auth |
|---|---|---|
| `/` | `PosPage` (alış) | Auth |
| `/dashboard` | `DashboardPage` | Auth |
| `/depolama` | `InventoryPage` | Auth |
| `/log` | `AfgPage` (AFG defter) | Auth |
| `/musteriler` | `CustomersPage` | Auth |
| `/opmc` | `AntifraudPage` | Auth |
| `/opmc/:id` | `OpmcDetailPage` | Auth |
| `/uniconta` | `UnicontaPage` | Auth |
| `/woocommerce` | `WooCommercePage` | Auth |
| `/gdpr` | `GdprPage` | Auth (admin) |
| `/settings` | `SettingsPage` | Auth |
| `/musteri-ekran` | `DisplayPreviewPage` | Auth |
| `/office-document/:kind/:key` | `OfficeDocumentPage` | Auth |
| `/excel-preview/:kind/:key` | `ExcelPreviewPage` | Auth |
| `/display/idle` | `DisplayIdlePage` | Public |
| `/display/:token` | `DisplayPage` | Public (token) |
| `/gdpr/privacy` | `GdprPublicPrivacyPage` | Public |
| `/gdpr/cookies` | `GdprPublicCookiesPage` | Public |
| `/gdpr/request` | `GdprPublicRequestPage` | Public |
| `/gdpr/request/:token` | `GdprPublicRequestStatusPage` | Public |
| `/login` | `LoginPage` | Public |
| `/desktop-smoke` | `DesktopSmokePage` | Dev-only |

Redirect'ler: `/pos→/`, `/afg→/log`, `/inventory→/depolama`, `/antifraud→/opmc`.

### 9.2 Modül pattern (her `make/<modul>/` için ortak yapı)

```
make/<modul>/
  <Modul>Page.tsx          # JSX render
  use<Modul>MakeState.ts   # React Query + useState hook'u (state + mutations)
  types.ts                 # Modüle özel tipler
  (varsa) <Modul>Sub.tsx   # Alt komponentler (örn. customerEditors, sheetEditors)
```

Page komponenti `pages/<Modul>Page.tsx`'den çağrılır:
```tsx
export function PosPage() {
  const state = useAlisMakeState();
  return <AlisPage {...state} />;
}
```

### 9.3 Modül detayı tablo

| Modül | LOC (page + hook) | Ana queryKey'leri | Çağırdığı endpoint'ler |
|---|---|---|---|
| **alis** | 2326 | `pos,alis,list`, `pos,alis,workspace`, `pos,workspace,open-draft` | `/api/v2/alis/*`, `/api/v2/uniconta/invoice/from-pos/{seq}` |
| **depolama** | 1667 | `depolama,workspace`, `depolama,product,*`, `depolama,product,*,history`, `depolama,product,*,source-afg` | `/api/v2/depolama/*` |
| **log** | 1948 | `log,workspace`, `log,melt-lot,*` | `/api/v2/log/*` |
| **uniconta** | 1101 | `uniconta-config-v2`, `uniconta-invoices-v2`, `uniconta,sync-summary`, `uniconta,failed-syncs`, `uniconta,health` | `/api/v2/uniconta/*` |
| **opmc** | 651 | `opmc,recent`, `opmc,detail-page,*` | `/api/v2/opmc/*` |
| **woocommerce** | 1424 | `woocommerce,summary`, `woocommerce,logs` | `/api/v2/woocommerce/*` |
| **customers** | 871 | `customers,list-v2` | `/api/v2/musteriler/*` |
| **dashboard** | 678 | `dashboard-v2` | `/api/v2/dashboard` |
| **gdpr** | 838 | `gdpr,overview`, `gdpr,jobs`, `gdpr,retention-policies` | `/api/v2/gdpr/*` |
| **office** | 1182 | `office,document,status`, `office,runtime,status` | `/api/v2/office-runtime/*` |
| **display** | 400+ | `display,live`, `display,preview` | `/api/v2/display/*`, WS `/display/{token}/ws` |
| **excel** | 200+ | `excel,preview` | `/api/v2/office-runtime/*` |
| **settings** | 477 | `settings` | `/api/v2/settings` |
| **root** | 494 | `bootstrap`, `runtime-status` | `/api/v2/bootstrap`, `/api/v2/runtime/status` |
| **login** | 300+ | — | `/api/auth/login` |

Toplam frontend make/ LOC: ~26.000.

### 9.4 `src-v2/lib/` — Ortak yardımcılar

| Dosya | Export | Amaç |
|---|---|---|
| `api.ts` | `apiRequest`, `buildApiUrl`, `buildWsUrl`, `downloadAuthedDocument`, `fetchAuthedPdfBlob`, `openAuthedDocument`, `resolveApiBaseUrl`, `resolveWsBaseUrl`, `ApiError`, `TransportError` | HTTP client + blob helper'ları |
| `auth.ts` | `getAccessToken`, `setAuth`, `clearAuth`, `getCurrentUser` | Token + user persistence (localStorage) |
| `artifactSync.ts` | `emitArtifactSync`, `listenArtifactSync`, `signalMatches`, `ArtifactSyncSignal`, `ArtifactSyncKind`, `DEFAULT_CROSS_TRIGGERS` | Cross-tab + cross-module event |
| `format.ts` | `formatMoney`, `formatNumber`, `formatDate`, `formatRelativeTime`, `formatDuration`, `formatPercentage`, label'lar | Intl formatter'lar |
| `cpr.ts` | `normalizeCpr`, `validateCpr` | Danish CPR mod-11 |
| `toast.tsx` | `ToastProvider`, `useToast` | Toast context + hook |
| `desktop.ts` | `isTauriRuntime`, `ensureCustomerDisplayWindow`, `setCustomerDisplayIdle`, `getDesktopMonitorSetup`, `isDesktopDisplayRouteMatch`, `pickDocumentFile` vb. | Tauri IPC köprüsü |
| `officeDock.ts` | `openOfficeDock` | Office document dock |
| `runtimeInfo.ts` | Tauri runtime diagnostics | dev/prod ayrımı |

### 9.5 `src-v2/components/` — Ortak komponentler

| Dosya | Sorumluluk |
|---|---|
| `AppShell.tsx` | Ana layout (sidebar + header + footer + outlet) |
| `PdfViewerModal.tsx` | @react-pdf-viewer/core wrapper, full-screen modal |
| `CustomerDisplayCanvas.tsx` | 1920×1080 müşteri ekranı canvas (uniform scale + letterbox) |
| `StatCard.tsx` | Dashboard KPI kartı |
| `SectionCard.tsx` | Generic bölüm konteyneri |
| `OpmcShared.tsx` | Risk level normalization util'ları |

### 9.6 Tasarım sistemi

**Brand paleti** (`tailwind.config.js`):
- `brand-50` (en açık krem) → `brand-950` (en koyu kahverengi).
- Aksent: emerald (success), rose (error), amber (warning), sky (info), violet (kararsız), indigo (override).

**Style helper'ları:**
- `monoStyle = { fontFamily: "'IBM Plex Mono', monospace" }`
- `sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif' }`
- Tablo `th` / `td` için `TH`/`TD`/`TF` const'ları çoğu modülde kullanılıyor.

**Tipografi:**
- Üst başlıklar `text-xs font-black uppercase tracking-wider`.
- Sayısal değerler her zaman `style={monoStyle}` + `tabular-nums`.

---

## 10. Veri modeli + iş akışları

### 10.1 ERD (text)

```
User (auth + customer rolünde)
 ├─ pos_sessions_as_customer (PosSession.customer_id, ondelete=RESTRICT)
 ├─ purchased_products (Product.seller_customer_id)
 └─ bought_products (Product.buyer_customer_id)

PosSession (DRAFT/CONFIRMED/CANCELLED)
 ├─ customer_id → User (RESTRICT)
 ├─ clerk_user_id → User (operatör)
 ├─ → PosSessionLine[*]
 ├─ → PosDocument (1:1, unique FK)
 ├─ → Transaction (1:1)
 └─ → PosSessionProductLink (LEGACY sale akışı için; AFG'de boş)

PosDocument (sequence_no PK, auto-increment)
 ├─ pos_session_id (unique)
 ├─ document_type (AFREGNINGSBILAG | SALE_INVOICE)
 ├─ uniconta_sync_status (synced | failed | skipped | null)
 ├─ uniconta_invoice_number, uniconta_pdf_path, uniconta_synced_at
 └─ → PosDocumentAudit[*]

Transaction (1:1 PosDocument)
 └─ → TransactionLine[*]
     ├─ product_id → Product (Log route ile NULL→ID atanır)
     ├─ melt_lot_id → AfgMeltLot (lot create veya route ile)
     └─ ham veriler: weight_grams, purity_*, line_total_dkk

Product (status state machine)
 ├─ seller_customer_id → User (alış müşterisi)
 ├─ buyer_customer_id → User (satış müşterisi)
 ├─ deleted_at, deleted_by_user_id (soft delete)
 ├─ uniconta_* alanları (henüz Product seviyesinde yok)
 ├─ shop_*, woocommerce_product_id, is_published_to_site
 ├─ ai_description, ai_description_approved
 └─ → ProductHistory[*]

AfgMeltLot (gold | silver bucket, draft | finalized status)
 ├─ before_* (snapshot at create)
 ├─ after_pure_gold_grams (operatör girişi)
 ├─ payout_total_dkk, quote_eur, exchange_rate_dkk
 ├─ finalized_at, finalized_by_user_id
 └─ → AfgMeltLotHistory[*]
```

### 10.2 Status state machine'leri

**`PosSession.status`** (PosSessionStatusEnum):
```
DRAFT ──finalize──▶ CONFIRMED
DRAFT ──cancel────▶ CANCELLED
```

**`Product.status`** (ProductStatusEnum, backend `_allowed_status_transition`):
```
PURCHASED ─▶ IN_INVENTORY | UNDECIDED | MELTED
IN_INVENTORY ─▶ FOR_SALE | UNDECIDED | MELTED
FOR_SALE ─▶ SOLD | IN_INVENTORY | MELTED
UNDECIDED ─▶ IN_INVENTORY | FOR_SALE | MELTED
SOLD ─▶ (terminal)
MELTED ─▶ (terminal)
```
14 günlük GDPR kilidi süresince `FOR_SALE` / `MELTED` / `SOLD`'a geçişe izin verilmez.

**`AfgMeltLot.status`**:
```
draft ──finalize──▶ finalized
finalized ──reopen──▶ draft
```
Finalize için `payout_total_dkk` + `sale_date` zorunlu.

### 10.3 Uçtan uca iş akışı (örnek)

**Senaryo:** Müşteri 50g 22K altın bilezik getiriyor.

1. **Alış başlat** (`/`): `PosSession` DRAFT, müşteri seç (mevcut) veya yeni müşteri formu.
2. **Satır ekle:** `PosSessionLine` (weight_grams=50, purity_karat=22K, purity_percentage=91.66, rate_dkk=535, avance_percent=-2, line_offer_dkk=hesaplanan).
3. **Kaydet (Finalize):** `POST /api/v2/alis/workspace/{id}/finalize`
   - `PosSession.status = CONFIRMED`, `confirmed_at = now`.
   - `PosDocument` oluşur (sequence_no=1234).
   - `Transaction` + `TransactionLine[1]` (product_id=NULL).
   - `_sync_uniconta()` → Uniconta DebtorClient upsert + DebtorInvoice + PDF cache.
   - `PosDocumentAudit(action="finalize")`.
   - `PosDocumentAudit(action="uniconta_auto_sync", payload={ok:true, invoice_number:"..."})`.
4. **Log modülü** (`/log`): AFG-1234 belge satırı görünür, durum "awaiting_decision".
5. **Rota ata:** Operatör satıra `destination=melt` + `classification=standard` set eder.
6. **Batch Apply** (`POST /api/v2/log/routes/batch-apply`):
   - `apply_afg_route_requests_safe()` → `create_product_service()` → yeni Product (status=MELTED).
   - `TransactionLine.product_id = product.id`.
   - Eğer açık bir draft melt lot var ise: `TransactionLine.melt_lot_id = draft_lot.id`.
   - `ProductHistory(action="created")`.
7. **Eritme Lot Oluştur** (`POST /api/v2/log/melt-lots`):
   - `AfgMeltLot` (metal_bucket=gold, before_pure_gold_grams=45.83g, before_amount_dkk=...).
   - `_audit("created")`, eritme havuzundaki orphan satırlar auto-attach edilir.
8. **Lot detayını gir:** Operatör `after_pure_gold_grams`, `insurance_dkk`, `quote_eur`, `payout_total_dkk` girer → `PUT /api/v2/log/melt-lots/{id}`.
9. **Lot Finalize:** `POST /api/v2/log/melt-lots/{id}/finalize` → `status=finalized`, immutable.
10. **PDF Kart İndir:** `GET /api/v2/log/melt-lots/{id}/pdf` (reportlab A4).
11. **Vergi muhasebesi:** Bogføringsloven §10 — 5 yıl saklama; GDPR retention policy `afg_melt_lots` koruma altında.

### 10.4 Cross-module sync zinciri (frontend)

`lib/artifactSync.ts` `DEFAULT_CROSS_TRIGGERS`:
```
alis      → triggers: ['log', 'depolama']
log       → triggers: ['depolama', 'alis']
depolama  → triggers: ['log']
uniconta  → triggers: ['alis']
```

Her modülün listener'ı `signalMatches(signal, 'kind')` ile hem direkt sinyali hem cross-module trigger'ı yakalar. Office runtime (OnlyOffice) cell edit'lerini sync etmek için aynı kanal kullanılır.

---

## 11. API endpoint kataloğu

> Toplam **180+ endpoint** mevcut. Aşağıda modüle göre özet kategori; tam detay için Swagger UI: `http://localhost:8100/docs`.

### 11.1 Bootstrap + Auth
| Method | Path | Yetki | Sorumluluk |
|---|---|---|---|
| GET | `/api/v2/bootstrap` | Auth | İlk açılış: user, dashboard counts, runtime status |
| POST | `/api/auth/login` | Public | Email+password → access+refresh token |
| POST | `/api/auth/refresh` | Refresh | Access token yenile |
| GET | `/api/auth/me` | Auth | Mevcut user |

### 11.2 Alış (POS Purchase)
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/alis/list` | AFG kayıtları listele |
| GET | `/api/v2/alis/workspace/open-draft` | Açık draft session |
| POST | `/api/v2/alis/workspace` | Yeni workspace başlat |
| GET | `/api/v2/alis/workspace/{id}` | Workspace state |
| PUT | `/api/v2/alis/workspace/{id}/sections` | Satır/customer/bank update |
| POST | `/api/v2/alis/workspace/{id}/customer/select` | Mevcut müşteri seç |
| POST | `/api/v2/alis/workspace/{id}/finalize` | Belgeyi kaydet (audit) |
| POST | `/api/v2/alis/workspace/{id}/cancel` | Draft iptal (audit) |
| POST | `/api/v2/alis/documents/{seq}/edit` | Onaylı belgeye geri dön (audit) |
| DELETE | `/api/v2/alis/documents/{seq}` | Belgeyi iptal et (audit) |
| GET | `/api/v2/alis/documents/{seq}` | Belge detayı |
| GET | `/api/v2/alis/documents/{seq}/export` | XLSX export |
| GET | `/api/v2/alis/documents/{seq}/print` | HTML print view |
| GET | `/api/v2/alis/documents/{seq}/receipt-thermal` | ESC/POS 80mm bytes |

### 11.3 Depolama (Inventory)
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/depolama/workspace` | Filtre + sort destekli liste (q/category/subcategory/location/needs_cleaning/gdpr_locked/date_from-to/weight/price/limit/offset) |
| GET | `/api/v2/depolama/products/{id}` | Ürün detayı |
| POST | `/api/v2/depolama/products` | Yeni ürün |
| PATCH | `/api/v2/depolama/products/{id}` | Update (expected_updated_at precondition) |
| DELETE | `/api/v2/depolama/products/{id}` | Soft delete |
| PATCH | `/api/v2/depolama/products/{id}/status` | Status transition (melt_reason zorunlu) |
| GET | `/api/v2/depolama/products/{id}/history` | ProductHistory |
| GET | `/api/v2/depolama/products/{id}/source-afg` | Hangi AFG'den geldi (TransactionLine → PosDocument zinciri) |
| GET | `/api/v2/depolama/products/{id}/label` | ESC/POS etiket bytes |
| GET | `/api/v2/depolama/market-prices` | Piyasa fiyatları |
| PUT | `/api/v2/depolama/market-prices` | Piyasa fiyatları kaydet |
| GET | `/api/v2/depolama/workbook` | OnlyOffice XLSX indir |
| POST | `/api/v2/depolama/workbook/import` | XLSX import |

### 11.4 Log (AFG Defter)
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/log/workspace` | AFG belge buckets (gold/silver) + melt lots + year filter |
| POST | `/api/v2/log/routes/batch-apply` | Toplu rota ata (atomicity: per-line savepoint) |
| POST | `/api/v2/log/melt-lots` | Yeni eritme lotu (auto-attach orphan lines) |
| PUT | `/api/v2/log/melt-lots/{id}` | Lot detay update (precondition + audit) |
| POST | `/api/v2/log/melt-lots/{id}/finalize` | Lot kilitle (immutable) |
| POST | `/api/v2/log/melt-lots/{id}/reopen` | Lot tekrar düzenlenebilir yap |
| DELETE | `/api/v2/log/melt-lots/{id}` | Lot sil (draft + 0 line) |
| GET | `/api/v2/log/melt-lots/{id}/history` | Lot audit trail |
| GET | `/api/v2/log/melt-lots/{id}/lines` | Lot'a bağlı TransactionLine'lar |
| GET | `/api/v2/log/melt-lots/{id}/pdf` | A4 lot kartı PDF (reportlab) |

### 11.5 Uniconta
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/uniconta/config` | Konfigürasyon + connection status |
| POST | `/api/v2/uniconta/connect` | Test bağlantı + .env yaz |
| GET | `/api/v2/uniconta/invoices?source=local\|remote&limit=N` | Faturalar |
| GET | `/api/v2/uniconta/invoice-pdf?invoiceNumber=&account=&date=` | PDF binary |
| GET | `/api/v2/uniconta/invoice-pdf/from-pos/{seq}` | Cache'li PDF |
| POST | `/api/v2/uniconta/invoice/from-pos/{seq}` | Manuel retry |
| GET | `/api/v2/uniconta/sync-summary?hours=N` | 24h sync stats |
| GET | `/api/v2/uniconta/failed-syncs?status_filter=failed\|skipped\|all` | Bekleyen sync'ler |
| POST | `/api/v2/uniconta/sync-retry-all?limit=N` | Toplu retry |
| GET | `/api/v2/uniconta/health` | Token + son çağrı sağlığı |

### 11.6 OPMC (Anti-fraud)
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/opmc/recent-orders?days=N&per_page=M` | WC siparişleri + risk skoru |
| GET | `/api/v2/opmc/orders/{id}` | Tek sipariş detayı + history + override |
| POST | `/api/v2/opmc/orders/{id}/override` | Manuel risk level (low/medium/high) |

### 11.7 Müşteriler
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/musteriler` | Liste (q + pagination) |
| GET | `/api/v2/musteriler/{id}` | Detay |
| POST | `/api/v2/musteriler` | Yeni |
| PUT | `/api/v2/musteriler/{id}` | Update |
| DELETE | `/api/v2/musteriler/{id}` | Soft delete |
| GET | `/api/v2/musteriler/{id}/history` | Sipariş geçmişi |
| GET | `/api/v2/musteriler/{id}/alis-summary` | Toplam alış raporu (P10) |

### 11.8 WooCommerce
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/woocommerce/summary` | Sync özet |
| POST | `/api/v2/woocommerce/sync` | Tetiklenmiş sync |
| GET | `/api/v2/woocommerce/logs` | Sync log entries |
| POST | `/api/products/{id}/publish` | Tek ürün yayına gönder |

### 11.9 GDPR
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/gdpr/overview` | KPI özeti |
| GET | `/api/v2/gdpr/jobs` | Job kuyruğu |
| GET | `/api/v2/gdpr/retention-policies` | Politikalar |
| POST | `/api/v2/public/gdpr/request` | Public form submit |
| GET | `/api/v2/public/gdpr/status/{token}` | Public status |

### 11.10 Display (Müşteri Ekranı)
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/display/preview` | Idle snapshot |
| GET | `/api/v2/display/{token}/snapshot` | Token-based public snapshot |
| WS | `/display/{token}/ws` | Realtime push |

### 11.11 Office Runtime (OnlyOffice WOPI)
| Method | Path | Sorumluluk |
|---|---|---|
| GET | `/api/v2/office-runtime/status?kind=` | Runtime sağlık |
| POST | `/api/v2/office-runtime/launch/{kind}/{key}` | OnlyOffice session başlat |
| GET | `/api/wopi/files/{file_id}` | WOPI file info |
| GET | `/api/wopi/files/{file_id}/contents` | WOPI dosya içeriği |
| POST | `/api/wopi/files/{file_id}/contents` | WOPI dosya yazma |
| POST | `/office/onlyoffice/callback/{token}` | OnlyOffice → backend callback |
| POST | `/office/onlyoffice/forcesave/{token}` | Force save |

---

## 12. Tauri desktop runtime

### 12.1 Mimari

`desktop/src-tauri/src/main.rs` (~14k satır Rust). Ana yapılar:
- `MonitorInfo` — multi-monitor desteği
- `DisplayWindowState` — müşteri ekranı pencere durumu
- `PickedDocumentFile` — file picker IPC
- `DesktopRuntimeInfo` — runtime diagnostics
- `DesktopDevSessionState` — `.run/desktop-dev-session.json` persistence

### 12.2 `dev.js` (otomatik orchestrator)

`desktop/dev.js` çalıştığında:
1. Backend venv check (`backend/.venv` mevcut mu).
2. Mevcut backend health (`http://127.0.0.1:8100/health`).
3. Yoksa backend start: `alembic upgrade head` (SQLite legacy stamp dahil) + uvicorn --reload + port 8100.
4. Mevcut frontend (`http://127.0.0.1:3300`).
5. Yoksa frontend start: `npm run dev --port 3300`.
6. Hyprland/Wayland fallback: `GDK_BACKEND=x11` + `WINIT_UNIX_BACKEND=x11` + `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
7. Tauri dev: `npm run tauri dev`.
8. Session JSON: `.run/desktop-dev-session.json` (PID'ler, port'lar, başlangıç timestamp'i).

### 12.3 Tauri config (`tauri.conf.json`)

- App boyutu: 1440x920 (min 1180x760)
- Bundle: NSIS installer (Windows için)
- CSP: `script-src 'self' 'unsafe-eval' http://127.0.0.1:* http://localhost:*` (OnlyOffice ve dev için gevşek)
- Window title: "SERO GULD CRM"

### 12.4 Frontend ↔ Tauri köprüsü (`lib/desktop.ts`)

`isTauriRuntime()` true ise Rust IPC kullanılır:
- `ensureCustomerDisplayWindow(url)` — müşteri ekranı pencere
- `setCustomerDisplayIdle()` — idle moda dön
- `getDesktopMonitorSetup()` — ekran listesi
- `pickDocumentFile()` — native file picker

---

## 13. Konfigürasyon (.env) referansı

### 13.1 Tam alan listesi

**Genel:**
- `ENV=development|production`
- `APP_NAME`, `APP_URL`

**Veritabanı:**
- `DATABASE_URL` (örn. `sqlite:///./data/desktop.db` veya `postgresql+asyncpg://...`)
- `DATABASE_AUTO_CREATE` (dev'de true, prod'da **false**)
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (docker compose için)

**JWT & Encryption:**
- `JWT_ACCESS_SECRET` (≥32 byte)
- `JWT_REFRESH_SECRET` (≥32 byte)
- `JWT_ACCESS_EXPIRE_MINUTES=30`
- `JWT_REFRESH_EXPIRE_DAYS=14`
- `FIELD_ENCRYPTION_KEY` (base64, AES-GCM)
- `ONLYOFFICE_JWT_SECRET`

**CORS:**
- `CORS_ORIGINS` (csv)

**Altın fiyatı:**
- `GOLD_PRICE_LIVE_ENABLED=true`
- `GOLD_PRICE_TIMEOUT_SECONDS=6`
- `GOLD_PRICE_CACHE_SECONDS=20`

**OpenAI:**
- `OPENAI_API_KEY` (sk-proj-...)
- `OPENAI_BASE_URL=https://api.openai.com/v1`
- `OPENAI_MODEL=gpt-5.4` (dikkat: gpt-5 henüz piyasada olmayabilir; gpt-4o öneril)
- `OPENAI_TIMEOUT_SECONDS=20`

**WooCommerce:**
- `WOOCOMMERCE_BASE_URL=https://seroguld.dk/wp-json/wc/v3`
- `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`
- `WOOCOMMERCE_WEBHOOK_SECRET`
- `WOOCOMMERCE_TIMEOUT_SECONDS=20`

**WordPress (media):**
- `WORDPRESS_BASE_URL`
- `WP_APP_USERNAME`, `WP_APP_PASSWORD`

**Uniconta:**
- `UNICONTA_API_URL=https://www.uniconta.com/api`
- `UNICONTA_USERNAME`, `UNICONTA_PASSWORD`
- `UNICONTA_API_KEY`, `UNICONTA_COMPANY_ID`
- `UNICONTA_SEND_EMAIL_ON_FINALIZE=false` (UI'dan toggle)
- `UNICONTA_SEND_XML_ON_FINALIZE=false`

**Invoice:**
- `INVOICE_NUMBER_PREFIX=SG`
- `INVOICE_DEFAULT_CURRENCY=DKK`
- `INVOICE_SALE_VAT_RATE_PERCENT=0`
- `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS_LINE1`, `INVOICE_SELLER_POSTAL_CODE`, `INVOICE_SELLER_CITY`, `INVOICE_SELLER_COUNTRY`, `INVOICE_SELLER_CVR`, `INVOICE_SELLER_EMAIL`, `INVOICE_SELLER_PHONE`
- `POS_REFERENCE_START=9600`, `POS_REFERENCE_SCAN_WINDOW=5000`

**Inventory market prices** (default):
- `INVENTORY_MARKET_GOLD_DKK`
- `INVENTORY_MARKET_SILVER_DKK`
- `INVENTORY_MARKET_PLATINUM_DKK`
- `INVENTORY_MARKET_PALLADIUM_DKK`

**Media:**
- `MEDIA_ROOT_DIR=./data/uploads`
- `DOCUMENT_ROOT_DIR=./data/documents`
- `PHOTO_MAX_SIZE_MB=15`

**Office Runtime:**
- `ONLYOFFICE_IMAGE=onlyoffice/documentserver:8.2.2`
- `OFFICE_PROVIDER_DEFAULT=collabora`
- `OFFICE_PROVIDER_AFG=onlyoffice`, `OFFICE_PROVIDER_DEPOLAMA=onlyoffice`, `OFFICE_PROVIDER_LOG=onlyoffice`
- `OFFICE_RUNTIME_URL=http://127.0.0.1:9980` (Collabora)
- `ONLYOFFICE_RUNTIME_URL=http://127.0.0.1` (WOPI)
- `ONLYOFFICE_CALLBACK_BASE_URL=http://127.0.0.1:8100`
- `OFFICE_SESSION_TTL_SECONDS=3600`

**Backup:**
- `BACKUP_ROOT_DIR=./data/backups`
- `BACKUP_KEEP_HOURLY=48`, `BACKUP_KEEP_DAILY=30`, `BACKUP_KEEP_WEEKLY=12`
- `BACKUP_DAILY_HOUR_UTC=00`, `BACKUP_WEEKLY_DAY_UTC=1`
- `BACKUP_ALLOW_SQLITE_FALLBACK=true`
- `BACKUP_OFFSITE_ENABLED`, `BACKUP_OFFSITE_TARGET`, `BACKUP_OFFSITE_MODE=sync`
- `BACKUP_HEALTH_MAX_AGE_MINUTES=180`
- `BACKUP_CRON_HOURLY`, `BACKUP_CRON_VERIFY`, `BACKUP_CRON_RESTORE_DRILL`, `BACKUP_CRON_OFFSITE`

**Admin seed:**
- `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME`
- `INITIAL_ADMIN_AUTO_SEED=true` (prod'da false yapın)

**Frontend (Vite):**
- `VITE_API_BASE_URL` (boş → otomatik aynı host)
- `VITE_WS_BASE_URL`

### 13.2 .env.example vs .env farkı

- `.env.example` — git'te commit edilen şablon, secret içermez.
- `.env` — local-only, gerçek credential'lar. **Repo'da committed olmamalı** ama şu anda öyle (bkz. §17 — güvenlik).

---

## 14. Test, build, deploy

### 14.1 Test piramidi (mevcut durum)

| Seviye | Mevcut | Hedef |
|---|---|---|
| Backend unit (pytest) | 32 dosya, ~150 test | ≥70% coverage |
| Backend integration | ~5 test (afg_roundtrip, log_ark1_roundtrip, pos_confirm_multiline) | E2E mock'lu Uniconta + WC |
| Frontend unit (vitest) | 3 dosya, 15 test (cpr, format, toast) | ≥50% lib + critical hook |
| Frontend component (RTL) | toast.test.tsx | Modal'lar, formlar |
| Frontend E2E (Playwright) | 1 test (`smoke.spec.ts`) | Login → POS → Finalize → Log → Melt zinciri |
| Desktop smoke | `make desktop-smoke` shell | Multi-platform (Linux/Win/Mac) |
| Integration | `make integration-smoke` (AI + WC publish) | Daily CI |

### 14.2 Production build

```bash
# Frontend
cd frontend
npm run build           # → dist/
                        # vite.config.ts manualChunks: vendor-react, vendor-router, vendor-query,
                        # vendor-tauri, vendor-xlsx, vendor-charts, route-{alis,depolama,log,vb.}

# Desktop release
make release-desktop    # frontend build + tauri build --release
                        # Sonuç: desktop/src-tauri/target/release/bundle/
                        #   - linux: .deb, .AppImage
                        #   - windows: .msi, .exe (NSIS)
                        #   - macos: .app, .dmg

# Backend (docker)
docker-compose -f docker-compose.yml up -d backend
# Veya systemd service
```

### 14.3 CI/CD (`.github/workflows/`)

Mevcut workflow'lar (varsa):
- `make check` (typecheck + test) PR'larda otomatik.
- Release tag'lerinde desktop build artifact (henüz aktif değil mi kontrol et).

---

## 15. Sorun giderme (FAQ)

**Soru: Tauri pencere açılmıyor / siyah ekran.**
A: WebKitGTK 4.1 Wayland'la bazen DMABUF render hata verir. `dev.js` X11 fallback otomatik enjekte ediyor. Manuel test için:
```bash
GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 make desktop-dev
```

**S: Backend 8100 portu meşgul.**
A:
```bash
make desktop-stop          # session JSON'a göre graceful
# Veya zorla:
fuser -k 8100/tcp
rm -f .run/desktop-dev-session.json
```

**S: SQLite "table X already exists" alembic upgrade hatası.**
A: SQLAlchemy `Base.metadata.create_all` development startup'ta tabloları yaratıyor → sonraki migration "duplicate column" der. Çözüm: manuel stamp.
```bash
.venv/bin/alembic stamp 0019_log_module_audit
```

**S: Uniconta 401 dönüyor sürekli.**
A: `UnicontaClient` token cache process-local. `make desktop-restart` ile temizlenir. Veya `POST /api/v2/uniconta/connect` re-login zorlar. Multi-worker'da prod sorun olur (bkz. §17.6).

**S: OPMC sayfasında durup dururken yıllarca müşteriye 100 risk çıkıyor.**
A: **Çözüldü** (`antifraud_helpers.py:_extract_score_from_value` regex bug). Detay için README sonu commit history'sine bak (O1 fix). Whitelist + known_customer override mantığı eklendi.

**S: Frontend `npm test` çok yavaş (50s).**
A: Vitest jsdom başlangıcı ağır. Bu normal. `npm run test:watch` daha hızlı (warm).

**S: WooCommerce sync hata: "Sipariş bulunamadı".**
A: WC kategori/permalink yanlış olabilir. `WOOCOMMERCE_BASE_URL` doğru mu kontrol et.

**S: OnlyOffice canlı düzenleme açılmıyor (CSP hatası).**
A: Tauri CSP'sinde `frame-src` izinli mi kontrol et. `tauri.conf.json:22-24` `http://127.0.0.1:*` olmalı.

**S: Tauri release build "missing icon" hatası.**
A: `desktop/src-tauri/icons/` doluyor mu? Henüz icon'lar tanımlanmamış olabilir (bkz. §17.4).

---

## 16. Mimari kararlar ve gerekçeleri

### 16.1 Neden Tauri (Electron değil)?

- Daha küçük bundle (~10MB Linux .deb, vs Electron 200MB+).
- Native window IPC + multi-monitor güçlü.
- Rust shell güvenli + low overhead.
- Trade-off: WebKitGTK Linux davranış farkı (Chromium WebView2 Windows'ta sorun çıkarmaz).

### 16.2 Neden SQLite dev + PostgreSQL prod?

- Desktop kullanım: tek-kullanıcı + offline-first. SQLite ideal.
- Web prod: çoklu eşzamanlı session → PostgreSQL transaction kontrolü.
- Geçişler: `test_migration_portability.py` her iki DB'yi test ediyor.

### 16.3 Neden FastAPI (Django değil)?

- Pydantic v2 ile schema-first development.
- Async/await native (SQLAlchemy 2.0 async support).
- OpenAPI auto-generate → frontend tipler hızlı.
- Trade-off: Django admin yok (custom panel gerek).

### 16.4 Neden 2 ayrı yönelim: `v1` (legacy) + `v2`?

- `v1` (`/api/customers`, `/api/inventory`, `/api/pos`) → eski Next.js arayüzü için.
- `v2` (`/api/v2/*`) → kanonik Vite/React desktop arayüzü için.
- Legacy v1 endpoint'ler henüz silinmedi çünkü bazı testler ve script'ler kullanıyor; ileride kaldırılması planlı.

### 16.5 Neden Uniconta hybrid mode (fail-soft)?

- Finalize esnasında Uniconta down olursa CRM kaydı kaybolmamalı.
- `PosDocument.uniconta_sync_status='failed'` → operatör "Tekrar Dene" butonuyla manuel düzeltir.
- Audit trail: `PosDocumentAudit(action="uniconta_auto_failed")`.

### 16.6 Neden OnlyOffice WOPI?

- Kullanıcı Excel ile çalışmaya alışık. Online tablo editing.
- Self-host (data privacy): Müşteri kayıtları 3rd party'e gönderilmez.
- Collabora alternatif olarak duruyor (license preference).

### 16.7 Neden Bogføringsloven §10 = 5 yıl?

- Danimarka muhasebe kanunu: alış belgeleri en az 5 yıl saklanmalı.
- GDPR retention policy `afg_purchase_documents` + `afg_melt_lots`'la zorla.
- Finalize edilmiş kayıtlar immutable.

### 16.8 Neden risk_score'da regex parse'ı kaldırdık?

- AI Modeli açıklama metinlerinde "100% safe" gibi ifadeler vardı.
- Eski `_extract_score_from_value` regex'le ilk sayıyı yakalıyor → 100 = high risk.
- Yıllarca güvenli müşteriye hatalı risk atanıyordu.
- Yeni: sadece numeric type veya explicit `dict["score"]`.

---

## 17. Proje sağlık değerlendirmesi (analiz)

### 17.1 ✅ Beklenen şekilde tamamlanmış olan

| Alan | Durum | Not |
|---|---|---|
| **POS alış akışı** | ✅ Çalışıyor | Finalize lock, audit, Uniconta hybrid sync |
| **Depolama yönetimi** | ✅ Çalışıyor | 12 filtre + sıralama + foto + etiket + history |
| **Log AFG defter** | ✅ Çalışıyor | Route batch-apply atomicity + melt lot lifecycle + PDF |
| **Uniconta entegrasyonu** | ✅ Çalışıyor | Retry/backoff, cache, sync summary, failed list, bulk retry |
| **OPMC anti-fraud** | ✅ Düzeltildi | Parse bug çözüldü, whitelist/known_customer/override eklendi |
| **GDPR retention** | ✅ Kurulu | 7 policy + 5 yıl AFG koruması + public form |
| **OnlyOffice WOPI** | ✅ Çalışıyor | AFG/Depolama/Log canlı düzenleme + sync contract |
| **Multi-monitor display** | ✅ Çalışıyor | Tauri IPC + token-based public route |
| **Audit trail** | ✅ Eksiksiz | PosDocumentAudit, AfgMeltLotHistory, ProductHistory |
| **GFS backup** | ✅ Yapılandırıldı | Hourly/daily/weekly rotasyon + rclone offsite |
| **Cross-module sync** | ✅ Çalışıyor | BroadcastChannel + signalMatches + DEFAULT_CROSS_TRIGGERS |
| **Frontend testing temel** | ✅ Çalışıyor | Vitest 15 test + Playwright smoke + tsc strict |

### 17.2 ⚠️ Kısmi / eksik

| Alan | Durum | Notlar |
|---|---|---|
| **Testing kapsamı** | ⚠️ Düşük | Backend pytest 32 dosya OK; frontend sadece 3 dosya (cpr, format, toast). E2E 1 test. |
| **CI/CD pipeline** | ⚠️ Basit | `.github/workflows` minimal. Release artifact yok. |
| **Multi-worker güvenliği** | ⚠️ Riskli | Uniconta singleton token + cache, DebtorClient cache, OPMC orders cache hep in-memory. |
| **Tauri Windows/Mac** | ⚠️ Test edilmedi | WebView2 ve WKWebView'da koşulmadı. Sign + auto-update yok. |
| **i18n** | ⚠️ Karışık | Türkçe + Danimarkaca + İngilizce karışık (operatörler iki dil biliyor, kabul edilebilir). |
| **A11y** | ⚠️ Eksik | sr-only, ARIA label, focus-trap minimal. WCAG 2.1 audit yapılmadı. |
| **Performance** | ⚠️ Belirsiz | N+1 query audit yok. Reports/dashboard büyük dataset davranışı bilinmiyor. |
| **API rate limit** | ⚠️ Yok | FastAPI'de rate limiting middleware yok. Brute-force/DDoS açık. |
| **Frontend i18n catalog** | ⚠️ Yok | Hard-coded TR/DA stringler. ileride çeviri zor. |

### 17.3 🔴 Kritik eksik / risk

| Alan | Risk | Aksiyon |
|---|---|---|
| **`.env` credential'ları repo'da açık** | 🔴 KRİTİK | OpenAI key, WC keys, WP password, Uniconta password commit edilmiş. `git history rewrite` + secrets rotation gerek. |
| **JWT secret default** | 🔴 KRİTİK | `.env.example`'da `change-me-access-secret`. Prod'da değişti mi kontrol et. |
| **Field encryption key default** | 🔴 KRİTİK | `change-me-32-byte-base64-key`. Üretim verisi yanlış key ile şifrelenmiş olabilir. |
| **CSP gevşek** | 🔴 ORTA | Tauri CSP `unsafe-eval` izinli. XSS surface artmış. |
| **Nginx HTTPS yok** | 🔴 ORTA | Web stack nginx plain HTTP. TLS + HSTS gerek. |
| **HTTPS yokluğu prod** | 🔴 KRİTİK | Web stack production'a giderse credentials cleartext geçer. |
| **Auto admin seed default ON** | 🔴 ORTA | `INITIAL_ADMIN_AUTO_SEED=true` + parola `Admin123!`. Prod'da değiştirilmediyse açık kapı. |
| **Backup encryption yok** | 🔴 ORTA | Yedek dosyalar plaintext. Müşteri kimlik bilgileri (CPR) yedekte açık. |
| **Sentry/error tracking yok** | 🔴 DÜŞÜK | Üretim hatası logging stdout. Müşteri etkilense de görmek zor. |
| **Tauri code signing yok** | 🔴 ORTA | Windows installer "unknown publisher" uyarısı verecek. |

### 17.4 🟡 Eksik kullanıcı özellikleri

| Özellik | Mevcut mı? |
|---|---|
| Password reset | ❌ |
| Admin panel user CRUD | ❌ (Initial admin sadece env'den) |
| Backup UI (admin trigger) | ❌ (sadece Makefile/cron) |
| Two-factor auth | ❌ |
| Audit log UI (login history) | ❌ (DB'de PosDocumentAudit var, görünmüyor) |
| Müşteri data export (GDPR SAR) | ⚠️ Endpoint var, UI yok |
| API key management (3rd party integration için) | ❌ |
| Logout all devices | ❌ |
| Tauri auto-update | ❌ |

### 17.5 Aciliyet matrisi

**SHIPSTOPPER (üretime çıkmadan):**
1. `.env` credential'ları repo'dan temizle, history rewrite.
2. JWT + field encryption key prod'da değiştirilmiş olduğunu doğrula.
3. Nginx HTTPS + HSTS aktive et.
4. `INITIAL_ADMIN_AUTO_SEED=false` prod'da.
5. Backup encryption (gpg/age) ekle.

**KISA VADELI (1-2 ay):**
6. Frontend E2E coverage: 1 → 15 test.
7. Tauri Windows test + code signing setup.
8. Multi-worker safety: token cache → Redis (eğer multi-worker olacaksa).
9. Sentry / error tracking entegrasyonu.
10. Password reset akışı + admin user CRUD UI.

**ORTA VADELI (3-6 ay):**
11. Performance audit (N+1 + slow query log).
12. Tauri auto-update altyapısı.
13. WCAG 2.1 AA compliance audit.
14. i18n catalog (tek dil çıkarma).
15. Job queue (Celery/Bull) async heavy işler için.

---

## 18. Bilinen eksikler ve önerilen roadmap

Detay için §17. Özet öncelik:

### Q1 2026 (1-3 ay)
- [ ] Security hardening (#1-5 yukarıdaki SHIPSTOPPER)
- [ ] Frontend E2E test genişlet (Playwright)
- [ ] Password reset + 2FA
- [ ] Sentry entegrasyonu

### Q2 2026 (4-6 ay)
- [ ] Performance audit + slow query monitoring
- [ ] Tauri multi-platform release (Win + Mac)
- [ ] Auto-update + code signing
- [ ] Admin UI (user CRUD, backup trigger, audit log)

### Q3-Q4 2026
- [ ] Job queue + Redis cache (multi-worker)
- [ ] WCAG 2.1 AA compliance
- [ ] i18n catalog
- [ ] Mobile responsive (tablet için)
- [ ] Cross-region backup

---

## 19. Operasyonel runbook

### 19.1 Günlük operasyon (operatör)

```bash
# Sabah açılışı
make desktop-dev                    # Backend + Frontend + Tauri başlar

# Çalışma sırasında
# - Alış sayfası: müşteri al, kaydet
# - Log sayfası: AFG rota ata
# - Depolama: stok görüntüle
# - Uniconta sayfası: senkronizasyon kontrol

# Akşam kapanışı
make desktop-stop                   # Graceful kapatma
make backup                         # Manuel backup (otomatik cron yoksa)
```

### 19.2 Haftalık operasyon (admin)

```bash
make backup-verify                  # Son backup integrity
make backup-offsite                 # Offsite mirror kontrol
make gdpr-scan                      # Retention policy değerlendirme
make readiness-smoke                # /readyz sağlık
```

### 19.3 Aylık operasyon

```bash
make backup-restore-drill           # Restore tatbikatı
# .env credential rotation
# Secret manager'a token'ları taşı (eğer henüz yapılmadıysa)
# DB index audit (slow query log incele)
```

### 19.4 Acil durum: Backend çökmüş, müşteri kapıda

```bash
# Hızlı toparlanma
make desktop-restart                # Tam restart
# Loglara bak:
journalctl --user -u seroguld-backend -n 100  # systemd ise
tail -f .run/desktop-dev.log                    # dev modunda
# DB integrity check:
sqlite3 data/desktop.db "PRAGMA integrity_check;"
# Migration head doğru mu:
cd backend && .venv/bin/alembic current
# Hata Uniconta'da ise hybrid mode finalize'ı engellemez:
# PosDocument.uniconta_sync_status='failed' olur, CRM kaydı durur.
```

### 19.5 Veri kurtarma (backup'tan)

```bash
make restore-from-backup              # Kontrollü extract
# Manual SQLite kurtarma:
cp data/backups/YYYY-MM-DD/desktop.db data/desktop.db.recovery
sqlite3 data/desktop.db.recovery "PRAGMA integrity_check;"
mv data/desktop.db data/desktop.db.broken
mv data/desktop.db.recovery data/desktop.db
make desktop-restart
```

---

## 20. Glossary

| Terim | Açıklama |
|---|---|
| **AFG** | Afregningsbilag — Danimarka'da müşteriden satın alma için düzenlenen alış makbuzu. Bu projede PosDocument.document_type=PURCHASE_RECEIPT |
| **Afregningsbilag** | AFG'nin tam adı (Danca) |
| **Avance** | Kar marjı (DKK veya %). POS finalize'da gold rate'den avance düşülerek müşteriye teklif edilir. |
| **Bogføringsloven** | Danimarka muhasebe kanunu. §10 alış belgeleri için 5 yıl saklama zorunluluğu. |
| **CPR** | Centrale Personregister — Danimarka kişisel kimlik numarası (DDMMYY-NNNN). Mod-11 algoritması kullanılır. |
| **CVR** | Centralt Virksomhedsregister — Danimarka şirket sicil no |
| **DebtorClient** | Uniconta'da müşteri/borçlu kaydı |
| **DebtorInvoice** | Uniconta'da fatura kaydı |
| **Faktura** | Satış faturası (Danca) |
| **Finguld** | Saf altın (Danca) — gram bazında |
| **Finsølv** | Saf gümüş (Danca) |
| **Forsendelse** | Kargo gönderim (Danca) |
| **GDPR** | General Data Protection Regulation |
| **Guldbarrer** | Altın külçe (Danca) |
| **Guldmønter** | Altın sikke (Danca) |
| **Guldsmykker** | Altın takı (Danca) |
| **Kontant** | Nakit (Danca) |
| **Kreditnota** | Kredi notu (iade faturası) |
| **OIOUBL** | Danimarka standart elektronik fatura formatı (XML) |
| **OPMC** | (Eski adı: Anti-Fraud) — WooCommerce eklentisi risk puanlama. Frontend'de "/opmc" route. |
| **PosDocument** | Finalize edilmiş alış belgesi. sequence_no PK auto-increment. |
| **PosSession** | Aktif alış oturumu. DRAFT iken edit edilebilir, CONFIRMED sonrası immutable. |
| **POS** | Point of Sale — proje kapsamında alış (purchase) odaklı kullanılır. |
| **Salgsfaktura** | Satış faturası (Danca) |
| **SAR** | Subject Access Request — GDPR data export hakkı |
| **Sølvbarrer** | Gümüş külçe (Danca) |
| **Stok No** | Reference number (4 haneli, takılar için manuel girilir) |
| **WC** | WooCommerce kısaltması |
| **WOPI** | Web Application Open Platform Interface — OnlyOffice/Collabora dokuman host protokolü |

---

## EK A: Kritik dosyalar (sık ziyaret edilenler)

**Backend:**
- `backend/app/services/pos_purchase_finalize.py` — Alış finalize akışı
- `backend/app/services/uniconta_service.py` — Uniconta client
- `backend/app/services/antifraud_helpers.py` — OPMC risk parse (kritik bug fix)
- `backend/app/api/afg.py` — Log + melt lot lifecycle
- `backend/app/services/product_service.py` — Product state machine
- `backend/app/config.py` — Settings (tüm env değişkenleri burada)

**Frontend:**
- `frontend/src-v2/lib/api.ts` — HTTP client
- `frontend/src-v2/lib/artifactSync.ts` — Cross-module sync
- `frontend/src-v2/lib/toast.tsx` — Toast notification context
- `frontend/src-v2/make/alis/useAlisMakeState.ts` — En kompleks hook
- `frontend/src-v2/make/log/useLogMakeState.ts` — Log workflow hook
- `frontend/src-v2/types.ts` — Tüm tip tanımları

**Desktop:**
- `desktop/dev.js` — Otomatik dev orchestrator
- `desktop/src-tauri/src/main.rs` — Rust shell
- `desktop/src-tauri/tauri.conf.json` — Tauri config + CSP

**Operasyon:**
- `Makefile` — Tüm komutlar
- `.env` — Local credential'lar (NEVER COMMIT)
- `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` — Production deploy

---

## EK B: İletişim ve sahiplik

- **Müşteri:** Recai Demir (Sero Guld og Sølv ApS)
- **Konum:** Valby Langgade 84, 2500 Valby, Danimarka
- **CVR:** 34 09 30 83
- **Email (uniconta scan):** scan613856230@uniconta-inbox.dk
- **Uniconta hesap:** seroguld / Company ID 55606
- **WC site:** https://seroguld.dk

---

> **Bu dökümanı güncelleyin** — kod tabanı değiştikçe sayılar/dosya yolları sapacaktır. Major değişiklikten sonra:
> 1. §4 (dizin yapısı) güncelle
> 2. §8.5 (migration) yeni rev_id'leri ekle
> 3. §11 (endpoint kataloğu) yeni route'ları ekle
> 4. §17 (sağlık) checklisti tekrar gözden geçir
>
> Bu doc'a `feat(docs): ...` commit mesajıyla ekle ki release notes'da görünür olsun.
