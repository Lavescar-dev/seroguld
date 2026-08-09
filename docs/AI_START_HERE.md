# AI START HERE — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Migration head:** `0023_pos_document_customer_snapshot` · **Doğrulama seviyesi:** VERIFIED (kod + test + yapılandırma)

Bu dosya, projeye yeni giren bir AI oturumunun (Codex/Kimi) **ilk okuyacağı** belgedir. Ayrıntıyı tekrar etmez; kanonik belgelere yönlendirir.

---

## 1. Proje nedir?

**Sero Guld CRM**, Danimarka/Valby'deki kuyumcu **Sero Guld og Sølv ApS** için geliştirilen masaüstü CRM'dir. İşletme operasyonu tarihsel olarak **Excel** üzerinde yürüyordu; CRM bu Excel düzenini (Alış belgesi, Depolama, Log/AFG defteri) sürdürülebilir bir sisteme taşır. Ana senaryo: müşteriden fiziksel altın/gümüş **alımı (AFG)**, envantere/route kararı, eritme (melt lot), WooCommerce satışı ve Uniconta muhasebe senkronu.

## 2. Repo haritası

| Yol | Rol | Durum |
|---|---|---|
| `seroguld-crm/` | **PRIMARY_REPO** — FastAPI backend + Vite/React frontend + Tauri desktop | Aktif çalışma kopyası |
| `../seroguld-priser/` | Mağaza fiyat panosu prototipi (Vite, Cloudflare) | Ayrı proje, git yok |
| `../seroguld-webshops/` | Gelecek headless WooCommerce vitrin taslağı (Aurum/Nord) | Ayrı proje, git yok |
| `../seroguld-windows-handoff-20260617-2a12df1/` | Windows'a geçiş paketi (kod zip + runtime + ps1) | Teslim paketi |
| `../remote-codex-handoff/` | 2026-06-17 handoff belgeleri | Tarihsel |
| `../.mirror/seroguld-crm-664eb7e/` | `664eb7e`'de donmuş mirror snapshot | Tarihsel |
| `../.recover/seroguld-crm-old/` | Eski kurtarma artığı (sadece .git) | Tarihsel |

Detay: [ARCHITECTURE.md](ARCHITECTURE.md) §1.

## 3. Teknoloji yığını (özet)

- **Backend:** Python 3, FastAPI 0.115, async SQLAlchemy 2.0, Alembic (23 migration, head `0023_pos_document_customer_snapshot`), Pydantic 2. Geliştirmede **SQLite** (`data/desktop.db`), prod hedefi PostgreSQL.
- **Frontend:** Vite 6 + React 18 + TS, kanonik kaynak `frontend/src-v2/` (hash router). `frontend/legacy-next/` DEPRECATED karantina.
- **Desktop:** Tauri v2 (Rust), tek `main.rs`; bundle hedefi yalnız **Windows NSIS**. Windows'ta WebView2, Linux'ta WebKitGTK.
- **Entegrasyonlar:** Uniconta (DK ERP), WooCommerce + WordPress (seroguld.dk), OPMC anti-fraud, Stooq canlı kur, OnlyOffice WOPI (Excel dock), OpenAI (AI servis).
- Detay: [ARCHITECTURE.md](ARCHITECTURE.md), [DEVELOPMENT_AND_OPERATIONS.md](DEVELOPMENT_AND_OPERATIONS.md).

## 4. Ana modüller ve gerçek durum

| Modül | Durum | Not |
|---|---|---|
| Alış (POS / AFG) | IMPLEMENTED | `trade_side=buy_from_customer`; finalize idempotent |
| Müşteriler | IMPLEMENTED | AES-GCM alan şifreli CPR/kimlik; aranabilir hash |
| Depolama (envanter) | IMPLEMENTED | `products` tablosu; fiziksel stok |
| Log (AFG defteri + melt lot) | IMPLEMENTED | Route kararı: inventory/undecided/melt |
| Satış | **PARTIAL** | Legacy POS `sell_to_customer` + Woo webhook; ayrı modern satış modülü YOK — iş kuralları net değil (DISCOVERY) |
| WooCommerce | IMPLEMENTED | Publish + webhook sipariş → satış |
| WordPress GDPR köprüsü | PARTIAL | Snippet + public endpoint'ler var; PHP plugin paketi scripti beklenen dosyayı bulamıyor |
| Uniconta | IMPLEMENTED | Finalize sonrası hybrid sync, idempotency guard |
| OPMC anti-fraud | IMPLEMENTED | WC Anti-Fraud parse + override |
| GDPR | IMPLEMENTED | 7 retention policy, runner, public formlar |
| Müşteri ekranı (2. monitör) | IMPLEMENTED (Linux) / UNTESTED (Windows çift monitör) | Tauri komutu + WS `/api/v2/display/:token/ws` |

Tam matris: [MODULE_STATUS.md](MODULE_STATUS.md).

## 5. Değiştirilemez iş kuralları / invariantlar

1. **Para/gram hesapları yalnız `Decimal` + `quantize_2` (ROUND_HALF_UP)** — `backend/app/utils/helpers.py:11-21`. Float YASAK.
2. **AFG finalize idempotenttir** — satır kilidi + DRAFT kontrolü; tekrar finalize 409 (`pos_purchase_finalize.py:37-51`).
3. **AFG satırı tek hedefe route edilir** — `destination ∈ {inventory, undecided, melt}`; duplicate line_id reddedilir.
4. **CPR/kimlik numaraları asla düz metin saklanmaz** — AES-GCM + hash; müşteri ekranında **maskeli** gösterilir.
5. **Tek worker:** `uvicorn --workers 1` zorunlu (Uniconta/OPMC/DebtorClient cache process-singleton).
6. **Bogføringsloven §10:** AFG belgeleri ve melt lot'lar 5 yıl saklanır (retention `keep_restrict`).
7. **Müşteri ekranında operatör verisi (marj, tam CPR) görünmez.**

## 6. Bilinen tehlikeler

- **Windows release doğrulaması zayıf:** release workflow'unda smoke YOK; gerçek donanım + çift monitör hiç test edilmedi. Beyaz ekran fix'i (`24f86ee`) CI'da yalnız feedback workflow'unda doğrulanıyor. → [PLATFORM_COMPATIBILITY.md](PLATFORM_COMPATIBILITY.md)
- **Release exe'de log yok:** `windows_subsystem="windows"` + log plugin yok → sahada sessiz beyaz ekran riski.
- **Güvenlik açıkları (PROJECT_HEALTH_AUDIT 4/10):** rate-limit/CSRF yok, prod CSP'de `unsafe-eval`, yedekler şifresiz, 2FA yok, otomatik admin seed.
- **Koyu tema düğmesi işlevsiz** (hiç `dark:` stili yok); kullanıcı UI'ı fazla koyu buluyor → [CURRENT_STATE_AND_ROADMAP.md](CURRENT_STATE_AND_ROADMAP.md) tema iş paketi.
- **Doküman tuzakları:** `docs/README.md`'deki `referans/` klasörü repo'da YOK; `scripts/package-wordpress-bridge.sh` eksik PHP plugin bekliyor; AGENTS.md'deki ".env committed" iddiası git ile çelişiyor.

## 7. Yerel başlatma

```bash
make desktop-dev      # kanonik geliştirme zinciri (backend 8100 + vite 3300 + tauri)
make desktop-status   # runtime fingerprint / session durumu
make backend-test     # pytest (backend/.venv gerekli)
cd frontend && npm run typecheck && npm test
```

Detay ve env değişkenleri: [DEVELOPMENT_AND_OPERATIONS.md](DEVELOPMENT_AND_OPERATIONS.md).

## 8. Doküman indeksi

| Belge | İçerik |
|---|---|
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | İşletme bağlamı, Excel→CRM geçişi, kapsam |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Repo topolojisi, bileşenler, veri akışları, diyagramlar |
| [BUSINESS_FLOWS.md](BUSINESS_FLOWS.md) | Müşteri, AFG, altın/gümüş, depolama, satış akışları (AS-IS/TO-BE) |
| [DATA_STORAGE_AND_EXCEL.md](DATA_STORAGE_AND_EXCEL.md) | Veri modeli, iki depolama alanı, Excel import/export |
| [WORDPRESS_INTEGRATION.md](WORDPRESS_INTEGRATION.md) | WP/Woo contract, auth, webhook, köprü |
| [MODULE_STATUS.md](MODULE_STATUS.md) | Modül durum matrisi + kanıt yolları |
| [PLATFORM_COMPATIBILITY.md](PLATFORM_COMPATIBILITY.md) | Linux/Hyprland/Windows, çift monitör, beyaz ekran |
| [DEVELOPMENT_AND_OPERATIONS.md](DEVELOPMENT_AND_OPERATIONS.md) | Kurulum, komutlar, env, backup, release |
| [CURRENT_STATE_AND_ROADMAP.md](CURRENT_STATE_AND_ROADMAP.md) | Tamamlanan/kısmi/eksik + P0-P3 backlog |
| [DECISIONS_AND_OPEN_QUESTIONS.md](DECISIONS_AND_OPEN_QUESTIONS.md) | Kararlar, çelişkiler, açık iş soruları |
| [REPORT_ARCHIVE_POLICY.md](REPORT_ARCHIVE_POLICY.md) | 00-LATEST / 99-ARCHIVE rotasyon kuralları |
| `HANDOVER.md` / `PROJECT_SYSTEM_GUIDE_TR.md` | Derin tarihsel referans (2026-05-18) |

## 9. En önemli sonraki işler

1. **WP-01:** `windows-desktop-release.yml`'e Windows display smoke ekle + release exe'de teşhis loglaması (P1).
2. **SALES-00:** Satış modülü iş kurallarını kullanıcıyla netleştir (DISCOVERY — kod yazmadan önce).
3. **SEC-01:** Güvenlik audit'indeki P0/P1 maddeleri (rate-limit, CSP, yedek şifreleme).
4. **THEME-01:** Açık tema dönüşümü (design token'ları + 120 koyu blok).

Tam sıra ve iş paketleri: [CURRENT_STATE_AND_ROADMAP.md](CURRENT_STATE_AND_ROADMAP.md).
