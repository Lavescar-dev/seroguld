# Sero Guld CRM — Dokümantasyon İndeksi

> **Son güncellenme:** 2026-08-13
> **Sürüm:** v0.3.4 · **Migration head:** `0034_market_rate_confirmation`

Bu klasör Sero Guld CRM projesinin tüm dokümantasyonunu içerir. Aşağıda **hangi dokümana ne zaman bakmanız gerektiği** özetlenmiştir.

---

## ⭐ Kanonik katmanlı dokümantasyon (2026-07-27 A–Z denetimi)

**AI oturumları buradan başlar:** [`AI_START_HERE.md`](AI_START_HERE.md)

| Belge | İçerik |
|---|---|
| [`AI_START_HERE.md`](AI_START_HERE.md) | İlk okunacak giriş: harita, stack, invariantlar, tehlikeler |
| [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) | İşletme bağlamı, Excel→CRM geçişi, kapsam |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Repo topolojisi, bileşenler, veri akışları |
| [`BUSINESS_FLOWS.md`](BUSINESS_FLOWS.md) | İş akışları (AS-IS / TO-BE) |
| [`DATA_STORAGE_AND_EXCEL.md`](DATA_STORAGE_AND_EXCEL.md) | Veri modeli, iki depolama alanı, Excel |
| [`WORDPRESS_INTEGRATION.md`](WORDPRESS_INTEGRATION.md) | WP/Woo entegrasyonu |
| [`MODULE_STATUS.md`](MODULE_STATUS.md) | Modül durum matrisi |
| [`PLATFORM_COMPATIBILITY.md`](PLATFORM_COMPATIBILITY.md) | Linux/Hyprland/Windows, çift monitör |
| [`DEVELOPMENT_AND_OPERATIONS.md`](DEVELOPMENT_AND_OPERATIONS.md) | Kurulum, komutlar, env, operasyon |
| [`CURRENT_STATE_AND_ROADMAP.md`](CURRENT_STATE_AND_ROADMAP.md) | Durum + P0-P3 backlog + iş paketleri |
| [`DECISIONS_AND_OPEN_QUESTIONS.md`](DECISIONS_AND_OPEN_QUESTIONS.md) | Kararlar, çelişkiler, açık sorular |
| [`REPORT_ARCHIVE_POLICY.md`](REPORT_ARCHIVE_POLICY.md) | 00-LATEST / 99-ARCHIVE rotasyonu |

> ⚠️ Bilinen bayatlıklar: aşağıdaki eski belgelerde `referans/` klasörü anlatılır ancak bu klasör repo'da yoktur (referans Excel'ler Windows handoff paketindedir); satır sayıları güncel değildir. Çelişkilerin tam listesi: [`DECISIONS_AND_OPEN_QUESTIONS.md`](DECISIONS_AND_OPEN_QUESTIONS.md) §3.

---

## 🎯 Yeni teknisyen / geliştirici iseniz

**Şu sırayla okuyun:**

1. **[`PROJECT_SYSTEM_GUIDE_TR.md`](PROJECT_SYSTEM_GUIDE_TR.md)** — Ana sistem dokümantasyonu (940+ sat)
   - Proje özeti, teknoloji stack'i, mimari, modül haritası, akışlar
   - **Burada başlayın.**

2. **[`HANDOVER.md`](HANDOVER.md)** — Detaylı teknisyen devir kılavuzu (1300+ sat)
   - 20 bölüm: dizin yapısı, backend/frontend modülleri detayı, API kataloğu, .env referansı, FAQ, runbook, glossary
   - Sıfırdan projeyi devralacak biri için tam referans

3. **[`PROJECT_HEALTH_AUDIT.md`](PROJECT_HEALTH_AUDIT.md)** — Proje sağlık denetimi (700+ sat)
   - Skor kartı, neyin yapıldı/eksik kaldığı, kritik güvenlik açıkları, roadmap

---

## 🚀 Çalışmaya başlarken

### Geliştirme rutini
- **[`DEV_RUNTIME_PROTOCOL.md`](DEV_RUNTIME_PROTOCOL.md)** — `make desktop-dev` zinciri, runtime kartı doğrulama, restart kuralları
- **[`DESKTOP_SMOKE_PREREQUISITES_TR.md`](DESKTOP_SMOKE_PREREQUISITES_TR.md)** — Tauri smoke test için webdriver kurulumu

### Production ve operasyon
- **[`PRODUCTION_DESKTOP_RUNBOOK_TR.md`](PRODUCTION_DESKTOP_RUNBOOK_TR.md)** — Production deploy adımları, güvenlik checklist, release build
- **[`WINDOWS_RELEASE_RUNBOOK_TR.md`](WINDOWS_RELEASE_RUNBOOK_TR.md)** — Docker'sız Windows installer'ı yeniden üretme, doğrulama ve teslim
- **[`RELEASE_0.3.4_TR.md`](RELEASE_0.3.4_TR.md)** — 0.3.4 installer hash'i, test sonuçları ve teslim raporu

---

## 🔐 Özel akışlar

### GDPR
- **[`GDPR_TAURI_SMOKE_TR.md`](GDPR_TAURI_SMOKE_TR.md)** — Desktop içinde GDPR cockpit ve public bridge doğrulama akışı

### WordPress entegrasyonu
- **[`WORDPRESS_GDPR_BRIDGE_TR.md`](WORDPRESS_GDPR_BRIDGE_TR.md)** — WP'de privacy/cookie linklerini CRM'e bağlama

---

## 📦 Referans materyalleri

### `referans/` — Excel kaynak dokümanları
- `REFERENCE_DATA_DICTIONARY_TR.md` — Excel kolon ↔ CRM field mapping sözlüğü
- `EXCEL_TO_CRM_FIELD_MAP.csv` — Field mapping CSV
- `SPRINT1_EXECUTION_BACKLOG_TR.md` — Eski Sprint 1 backlog
- `README.md` — Referans klasörü kullanım notu

---

## 🗂️ Arşivlenen / tarihsel dokümanlar

Aşağıdaki dökümanlar proje gelişim sürecindeki belirli bir aşamayı yansıtır; **güncel durum için ana dokümantasyona bakın**.

- **`/FRONTEND_REDESIGN_BACKEND_HANDOFF.md`** (repo root) — Next.js → Vite/React Router geçişi sırasında backend kontrat dondurma dokümanı (2026-03). **Redesign tamamlandı**, sadece tarihsel referans.

---

## 🧭 Hızlı doc seçici

| Senaryon | Bakacağın doc |
|---|---|
| Sıfırdan projeyi anlamak | `PROJECT_SYSTEM_GUIDE_TR.md` → `HANDOVER.md` |
| Geliştirme ortamı kurmak | `HANDOVER.md` §6 + `DEV_RUNTIME_PROTOCOL.md` |
| Bir modülü değiştirmek | `HANDOVER.md` §8 (backend) / §9 (frontend) |
| API endpoint aramak | `HANDOVER.md` §11 veya Swagger UI (`/docs`) |
| `.env` değişkeni anlamak | `HANDOVER.md` §13 |
| Eksiklikleri / riskleri görmek | `PROJECT_HEALTH_AUDIT.md` |
| Docker'sız Windows installer üretmek | `WINDOWS_RELEASE_RUNBOOK_TR.md` |
| 0.3.4 teslim kanıtlarını görmek | `RELEASE_0.3.4_TR.md` |
| Eski/web production notları | `PRODUCTION_DESKTOP_RUNBOOK_TR.md` |
| Desktop smoke test yapmak | `DESKTOP_SMOKE_PREREQUISITES_TR.md` |
| GDPR akışı test etmek | `GDPR_TAURI_SMOKE_TR.md` |
| WP'ye GDPR linkleri eklemek | `WORDPRESS_GDPR_BRIDGE_TR.md` |
| Tauri runtime sorunu | `DEV_RUNTIME_PROTOCOL.md` |
| Sorun gidermek (FAQ) | `HANDOVER.md` §15 |
| Glossary (Danca/TR terimler) | `HANDOVER.md` §20 |

---

## 📋 Doc bakım kuralları

Dokümanlar kod tabanı değiştikçe **senkronize tutulmalıdır**:

1. Yeni Alembic migration eklenirse → `PROJECT_SYSTEM_GUIDE_TR.md` §9.9 + `HANDOVER.md` §8.5
2. Yeni endpoint eklenirse → `HANDOVER.md` §11 (kataloğa ekle)
3. Yeni modül eklenirse → `PROJECT_SYSTEM_GUIDE_TR.md` §6 + `HANDOVER.md` §8/9
4. Yeni `.env` değişkeni eklenirse → `HANDOVER.md` §13 + `.env.example`
5. Yeni güvenlik düzeltmesi → `PROJECT_HEALTH_AUDIT.md` §2 (durumu güncelle)
6. Sprint tamamlanırsa → `PROJECT_SYSTEM_GUIDE_TR.md` §22-24

**Major değişiklikten sonra:** Her dokümanın "Son güncellenme" tarihini güncelle.

---

## 🤝 İlgili dış dökümanlar

- `/AGENTS.md` — AI/dev ajan çalışma kuralları
- `/Makefile` — Tüm operasyon komutları (40+ target)
- `/README.md` (repo root) — Proje açıklaması (varsa)
- `/.env.example` — Konfigürasyon şablonu

---

## 📞 Kim?

- **Müşteri:** Recai Demir (Sero Guld og Sølv ApS, Valby/Danimarka)
- **CVR:** 34 09 30 83
- **CRM site:** https://seroguld.dk
- **Uniconta hesap:** seroguld / Company ID 55606
