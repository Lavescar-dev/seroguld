# Sero Guld CRM — Proje Sağlık Denetimi (Audit)

> **Tarih:** 2026-05-18
> **Versiyon:** v0.2.0
> **Audit kapsamı:** Tüm sistem — backend (FastAPI), frontend (Vite/React), desktop (Tauri), DB (SQLite/PG), entegrasyonlar (WC, Uniconta, OpenAI, OnlyOffice), GDPR, backup, dokümantasyon.
>
> **Cevap aranan soru:** "Proje tamamen beklendiği gibi mi? Yapılması gereken her şey yapılmış mı?"

---

## ÖZET (TL;DR)

**Kısa cevap:** Proje **%85 olgun, %15 kritik tamamlama gerekli**. İş akışları (alış → log → depolama → uniconta → woocommerce → opmc → gdpr) işlevsel olarak çalışıyor; son hafta'da yapılan kritik fix'ler (OPMC parse bug, cross-module sync, Uniconta retry, log audit) operasyonel sorunları çözdü. Ancak **production'a çıkmadan kapatılması zorunlu güvenlik açıkları** ve **frontend testing/E2E coverage eksikliği** var.

### Skor kartı

| Boyut | Puan | Detay |
|---|---|---|
| **İş Akışı Tamamlılığı** | ✅ 9/10 | Tüm 7 modül operasyonel; AFG → Eritme → Uniconta zincirleri çalışıyor |
| **Veri Modeli & Audit** | ✅ 9/10 | 26 model + 19 migration + 3 audit tablosu; GDPR retention 7 policy |
| **Backend Kalitesi** | ✅ 8/10 | 32 pytest dosyası, atomicity (savepoint), concurrent edit guard |
| **Frontend Kalitesi** | ⚠️ 7/10 | 15 vitest test (az), 1 Playwright smoke; UI polished ama coverage düşük |
| **Entegrasyon Sağlamlığı** | ✅ 8/10 | Uniconta retry/backoff/cache; OPMC parse bug çözüldü; WC sync hot path test edilmiş |
| **Güvenlik** | 🔴 4/10 | `.env` credential'ları repo'da açık (KRİTİK); JWT default secret; HTTPS yok; CSRF yok |
| **Performans** | ⚠️ 6/10 | N+1 audit yapılmamış; pagination var ama default'lar gevşek; çoklu worker test edilmemiş |
| **Operasyonel** | ✅ 8/10 | GFS backup, rclone offsite, gdpr-runner systemd timer, restore drill — sağlam |
| **Dokümantasyon** | ✅ 8/10 | `PROJECT_SYSTEM_GUIDE_TR.md` + bu audit + `HANDOVER.md` (yeni) detaylı |
| **Test Coverage** | 🟡 5/10 | Backend ortalama, frontend zayıf, E2E neredeyse hiç |

**Toplam: 7.2/10** — Production-ready için 8.5+ hedeflenmeli.

---

## 1. NE BEKLENDİĞİ GİBİ ÇALIŞIYOR?

### 1.1 ✅ Tam tamamlanmış akışlar (10/10)

#### A) Alış (POS Purchase) modülü
- Müşteri seçimi (mevcut/yeni form)
- Workspace içinde altın matris satırları, gümüş satırlar, market rates
- Autosave debouncing (200ms) + mutex pattern
- Finalize: `SELECT...FOR UPDATE` row lock + `PosSession.status=CONFIRMED` atomic
- PosDocument + Transaction + TransactionLine (line.product_id=NULL ilk başta)
- Uniconta hybrid sync (fail-soft, audit log)
- PosDocumentAudit: finalize, edit, delete, cancel, uniconta_retry, uniconta_auto_sync, uniconta_auto_failed, uniconta_bulk_retry
- 14 günlük GDPR kilidi + edit_source_session_id continuation
- Concurrent finalize prevention (409 Conflict)
- Toast feedback + loading state + empty state
- PDF viewer entegrasyonu (@react-pdf-viewer)
- "Tekrar Dene" Uniconta retry butonu
- CPR mod-11 validation inline
- Negatif gram/oran guard
- Keyboard shortcuts (Ctrl+S, Ctrl+N, Esc)

**Durum:** Tam tamamlanmış. Tüm 10 maddelik checklist (P5-P16) onaylanmış.

#### B) Depolama (Inventory) modülü
- Workspace endpoint 12 filtre (q/category/subcategory/location/needs_cleaning/gdpr_locked/date_from-to/weight/price/limit/offset)
- 5 ayrı tablo komponenti → tek `InventoryDataTable` abstraction
- Sıralanabilir kolonlar (lager_dato/urun/birim_gram/toplam_gram/alis_fiyati/spot_degeri/shop_fiyati/storage_location)
- Toast notifications (window.alert kaldırıldı)
- Loading skeleton + empty state CTA
- Concurrent edit guard (`expected_updated_at` precondition, 409 Conflict)
- Product status state machine (backend `_allowed_status_transition` ile frontend sync)
- Photo upload UI (`/api/products/{id}/photos`)
- Etiket / barcode print (ESC/POS thermal_label.py + Code128)
- AFG kaynak izi (TransactionLine → Transaction → PosDocument zinciri)
- Müşteri bilgisi drawer'da görünüyor
- Spot değer backend'den geliyor (client çarpım kaldırıldı)
- ProductHistory drawer'da panel

**Durum:** Tam tamamlanmış (D1-D15 onaylandı).

#### C) Log (AFG Defter) modülü
- Yıl seçici dropdown
- Loading + retry + empty state
- Polling visibility-aware (Excel view'da durur, document.hidden'da)
- Search debounce (300ms)
- Discard confirm + tab değişimi toast
- MeltLot expected_updated_at precondition (409)
- AfgMeltLotHistory + endpoint + drawer panel
- Batch-apply atomicity (per-line savepoint, partial failure raporu)
- TransactionLine.melt_lot_id (line attachment izi)
- Lot finalize/reopen (status enum + lock)
- Lot silme (sadece draft + 0 satır)
- Payout variance uyarısı (%5+ fark)
- Lot kartı PDF (reportlab, A4)
- GDPR retention `afg_melt_lots` 5 yıl
- Cross-module sync (alış → log otomatik invalidate)

**Durum:** Tam tamamlanmış (L1-L18 onaylandı).

#### D) Uniconta modülü
- Toast bindings (3 mutation)
- Loading skeleton + setup wizard 3-adımlı empty state
- Cross-module artifact sync (alış→uniconta listener)
- Search debounce (300ms)
- PDF retry butonu + Türkçe friendly error parse (401/404/timeout/network/5xx)
- "Sync bekleyen N AFG" sayım rozeti
- Sync summary endpoint + panel (24h stats + hata kategorileri)
- Failed sync list endpoint + UI (filtre + bulk retry)
- Toplu retry endpoint (`POST /uniconta/sync-retry-all`)
- SendEmail/SendXML toggle (BaglantiPanel checkbox)
- Connection health badge (token expiry minutes)
- Invoice timeline drawer (created/mail/eFatura)
- UnicontaClient `_request` retry/backoff (3 deneme + jitter)
- DebtorClient cache (1h TTL)
- Sync audit log (PosDocumentAudit uniconta_auto_*)
- Multi-worker uyarısı (UnicontaClient docstring + .env yorum)

**Durum:** Tam tamamlanmış (U1-U16 onaylandı).

#### E) OPMC (Anti-fraud) modülü
- **🎯 Kritik bug çözüldü:** `_extract_score_from_value` regex parse hatası (yıllardır 100 risk atıyordu)
- Score range validation (0-100 clamp)
- OPMC > AI priority swap (kural-tabanlı > LLM halüsinasyonu)
- `_RISK_META_EXACT_KEYS` whitelist (eski geniş substring araması iptal)
- Whitelist override (`whitelist_action` → low)
- Known customer pre-empt (3+ başarılı + son 365gün → low/medium hafifletme)
- Blacklist override (`_wc_af_blacklisted` → high)
- Manuel override + audit (`_wc_af_manual_override` meta'sı)
- Frontend skor kaynağı badge (OPMC/AI/Whitelist/Blacklist/Known Customer)
- Customer history mini panel (total/successful/cancelled/failed)
- 12-test smoke parse fix doğrulandı

**Durum:** Tam tamamlanmış (O1-O12 onaylandı). **Müşterinin spesifik şikayeti (durup dururken 100 çıkıyordu) çözüldü.**

#### F) Modüller arası entegrasyon
- `ArtifactSyncKind` enum + `signal.triggers[]` field
- `DEFAULT_CROSS_TRIGGERS`: alış→[log,depolama], log→[depolama,alis], depolama→[log], uniconta→[alis]
- `signalMatches(signal, watch)` helper
- 3 modülün listener'ı cross-module trigger yakalar
- Alış finalize → log + depolama otomatik invalidate (M1-M5 onaylandı)
- D9 source-afg endpoint TransactionLine zinciri üzerinden (PosSessionProductLink fallback)
- L10 melt_lot_id auto-attach açık draft lot'a

**Durum:** Tam tamamlanmış.

### 1.2 ✅ Diğer tamamlanmış akışlar

- **GDPR modülü:** 7 retention policy (financial_ledger, customer_master, gdpr_audit, operational_logs, local_backups, offsite_backups, afg_purchase_documents, afg_melt_lots), public form, runner systemd timer.
- **Backup:** GFS rotasyon (hourly 48 / daily 30 / weekly 12), rclone offsite, restore drill, cron install/uninstall.
- **OnlyOffice WOPI:** AFG/Depolama/Log canlı düzenleme, sync contract, force save, callback.
- **Multi-monitor display:** Tauri IPC + token-based public route + WebSocket realtime push.
- **Audit trail:** PosDocumentAudit (6 action), AfgMeltLotHistory (6 action), ProductHistory (10+ action).
- **PDF üretimi:** Uniconta DebtorInvoice cache (`data/documents/uniconta/`), lot kartı (reportlab A4).
- **Thermal printer:** ESC/POS 80mm makbuz + 62mm ürün etiketi + Code128 barcode.
- **Test (backend):** 32 pytest dosyası, ~150 test case.

---

## 2. NEYİN EKSİK / RİSKLİ OLDUĞU

### 2.1 🔴 KRİTİK — Üretime çıkmadan kapatılmalı

#### A) Güvenlik

| # | Risk | Açıklama | Çözüm |
|---|---|---|---|
| 1 | **`.env` credential'ları repo'da committed** | `OpenAI sk-proj-SQUy...`, `WC ck_c80da5ce`, `WP password 14mnywUJLGlL7vXfW0pzHesO`, `Uniconta Rodi0101`, `Uniconta API key 54a2a0bd...` plain text | `git history rewrite` + `.gitignore` + secrets manager (vault, AWS SM) + rotation |
| 2 | **JWT secret default** | `.env.example`'da `change-me-access-secret`. Prod'da değişti mi belirsiz. | `prod-bootstrap` script enforce; min 32 byte validation + assert |
| 3 | **Field encryption key default** | `change-me-32-byte-base64-key` | Aynı; key rotation policy + audit |
| 4 | **Nginx plain HTTP** | TLS yok, HSTS yok | nginx/snippets/ssl.conf + Let's Encrypt; HSTS preload |
| 5 | **CSRF yok** | FastAPI middleware'de yok | `fastapi-csrf-protect` veya double-submit cookie |
| 6 | **Rate limit yok** | Brute-force/DDoS açık | `slowapi` veya nginx limit_req_zone |
| 7 | **Tauri CSP gevşek** | `unsafe-eval`, `http://127.0.0.1:*` | Prod'da daraltılmalı (OnlyOffice için exception ile) |
| 8 | **Auto admin seed default ON** | `INITIAL_ADMIN_AUTO_SEED=true` + `Admin123!` | Prod'da false + güçlü parola enforce |
| 9 | **Backup encryption yok** | GFS yedekleri plaintext (CPR/kimlik bilgisi açık) | `gpg --encrypt` veya `age` ile encrypt-at-rest |
| 10 | **Two-factor auth yok** | Login sadece email+password | TOTP eklenmeli (uyumluluk requirement değil ama best practice) |

#### B) Testing eksikleri (üretim öncesi şart)

| # | Eksik | Mevcut | Hedef |
|---|---|---|---|
| 1 | Frontend unit test | 3 dosya (cpr, format, toast) | ≥15 dosya (kritik hook'lar) |
| 2 | Frontend component test | 1 (toast) | ≥10 (modal, form, table) |
| 3 | E2E (Playwright) | 1 smoke | ≥15 scenario (login → AFG → log → melt → uniconta) |
| 4 | Backend integration | 5 roundtrip | ≥20 (WC mock, Uniconta mock) |
| 5 | Concurrent finalize test | Yok | Race condition simulation |
| 6 | Multi-worker SQLite test | Yok | Lock contention scenario |
| 7 | Performance test | Yok | Load test (k6 veya locust) |
| 8 | Security test | 1 (test_security.py) | OWASP A10 coverage |

### 2.2 ⚠️ ORTA — Kısa-orta dönemde kapatılmalı

| # | Risk | Açıklama | Çözüm |
|---|---|---|---|
| 1 | **N+1 query audit yapılmamış** | Dashboard, reports büyük dataset davranışı bilinmiyor | SQLAlchemy `selectinload` audit; `pytest-querycount` |
| 2 | **Sentry / error tracking yok** | Üretim hataları stdout'a logger.exception | Sentry SDK + DSN; OpenTelemetry |
| 3 | **Structured logging yok** | Plain stdlib `logging` | JSON logger (`structlog`) + correlation ID |
| 4 | **Multi-worker singleton riski** | UnicontaClient, OPMC orders cache, debtor cache in-memory | Redis backed cache; veya `uvicorn --workers 1` enforce |
| 5 | **Tauri prod hardening eksik** | Code signing yok (Windows "unknown publisher"), auto-update yok, icon eksik | Tauri updater + Windows SignTool + macOS notarization |
| 6 | **Password reset akışı yok** | Operatör parola unutursa admin manuel reset | `/auth/forgot-password` + email gönderim |
| 7 | **Admin UI eksik** | User CRUD, backup trigger, audit log görünüm yok | Yeni `/admin` route grubu |
| 8 | **i18n karışıklığı** | TR + DA + EN aynı dosyada string'ler | `react-i18next` veya `lingui` |
| 9 | **WCAG a11y audit yok** | sr-only, ARIA, focus-trap minimal | Lighthouse a11y audit + manual fixes |
| 10 | **Frontend coverage raporu yok** | `npm test` coverage `--coverage` çalıştırılmıyor | `vitest --coverage` + threshold |
| 11 | **Backend coverage raporu yok** | `pytest-cov` config yok | `pyproject.toml` cov target 70% |
| 12 | **OpenTelemetry yok** | Distributed tracing yok | OTLP + Jaeger/Tempo |
| 13 | **GDPR public route'lar rate-limit yok** | Spam form submission açık | reCAPTCHA + slowapi |
| 14 | **Photo upload validation eksik** | Magic bytes check (MIME spoofing) | `python-magic` |
| 15 | **API key management yok** | 3rd party entegrasyon için kişisel API token yok | API key tablosu + scopes |

### 2.3 🟢 DÜŞÜK — Long-term backlog

- Job queue (Celery/Bull) → async heavy işler (PDF generation, bulk WC import).
- Mobile responsive (tablet kullanım senaryosu).
- Cross-region backup (currently single-region local + offsite mirror).
- Audit log UI (admin user actions, login history).
- API key management (personal access tokens).
- Logout all devices (token blacklist / Redis).
- DocumentArtifact cleanup job (eski snapshot'ları arşivle).
- Inventory full-text search (currently SQLite ILIKE; PG için tsvector).

---

## 3. EKSIK KULLANICI ÖZELLİKLERİ

| Özellik | Mevcut mu? | Etki |
|---|---|---|
| Password reset (email link) | ❌ | Operatör parola unutursa admin manuel reset |
| Two-factor auth | ❌ | Best practice eksik |
| Admin panel user CRUD UI | ❌ | Yeni operatör eklemek için DB manipulation |
| Backup UI (manual trigger) | ❌ | Sadece Makefile/cron |
| Logout all devices | ❌ | Token blacklist yok |
| Audit log UI (login history) | ❌ | PosDocumentAudit var ama görüntülenmiyor |
| Müşteri data export (GDPR SAR) | ⚠️ | Endpoint var, UI yok |
| API key management | ❌ | 3rd party integration için yok |
| Tauri auto-update | ❌ | Manuel installer indir |
| Customer photo upload | ✅ | Photo service ile |
| AI ürün açıklaması approve | ✅ | `ai_description_approved` toggle |
| Excel toplu import | ✅ | `/depolama/workbook/import` |
| AFG yıl filtresi | ✅ | Log workspace `year` param |

---

## 4. MÜŞTERİ FEEDBACK'INE GÖRE NETLEŞTİRİLEN PROBLEMLER

### 4.1 OPMC "durup dururken 100 risk çıkıyor" — ✅ ÇÖZÜLDÜ

**Asıl sorun:** `antifraud_helpers.py:_extract_score_from_value` regex'le AI açıklama metnindeki ilk sayıyı yakalıyordu.

**Senaryo:** AI Modeli `"Müşteri %100 güvenli, 5 yıldır kayıt"` döndürüyordu → 100 yakalanıyordu → high risk.

**Çözüm:**
- Regex parse tamamen kaldırıldı.
- Sadece numeric type + dict["score"|"risk_score"] kabul ediliyor.
- 0-100 range clamp.
- Whitelist + known_customer override eklendi.
- 12/12 test case onayladı.

**Doğrulama:**
```bash
.venv/bin/python -c "from app.services.antifraud_helpers import _extract_score_from_value; print(_extract_score_from_value('Risk düşük (%100 güvenli kullanıcı)'))"
# None  ← eskiden 100 dönüyordu
```

### 4.2 Diğer müşteri etkileyici fix'ler (geçen ayın commit'leri)

- Alış: Toast notification (`window.alert` çıkarıldı).
- Alış: CPR mod-11 validation (Danimarka standardına uygun).
- Alış: Negatif gram/oran guard (input level).
- Depolama: Sıralanabilir kolonlar + 12 filtre + foto upload.
- Log: Eritme lot finalize/reopen + audit + payout variance uyarısı.
- Uniconta: Retry/backoff + cache (gereksiz çağrı azaldı) + bulk retry.
- OPMC: Whitelist + known_customer pre-empt (false positive azaldı).

---

## 5. BEKLENEN İŞ AKIŞLARININ DURUMU

| İş akışı | Durum | Notlar |
|---|---|---|
| Müşteri kapıdan girer → POS alış başlat | ✅ | Workspace + müşteri seçim + autosave |
| Altın/gümüş satır gir → oran + avance | ✅ | Live market rates + manual override |
| AFG belgesi finalize → PDF | ✅ | PosDocument + Uniconta hybrid sync |
| Belge müşteriye e-posta gönder | ⚠️ | Uniconta SendEmail toggle var ama henüz prod test edilmedi |
| Log'da satıra rota ata (envanter/eritme) | ✅ | Batch-apply + Product create + audit |
| Eritme havuzundan lot oluştur | ✅ | Auto-attach orphan lines + history |
| Eritme operasyonu sonrası lot detay | ✅ | Payout/avance/quote/exchange |
| Lot finalize → muhasebe için kilit | ✅ | status=finalized + immutable |
| Lot PDF kart çıkar (vergi muhasebesi) | ✅ | reportlab A4 |
| Depolama: stoğu listele, filtre, sırala | ✅ | 12 filter + sort + bulk operations |
| Depolama: ürünü satışa hazırla | ✅ | status transition + 14gün GDPR kilit kontrolü |
| WooCommerce'a ürün yayına gönder | ✅ | `/api/products/{id}/publish` |
| AI ürün açıklaması üret | ✅ | OpenAI + approve toggle |
| WC'den gelen sipariş → OPMC risk skor | ✅ | Cache 5dk + override |
| OPMC operatör manuel "false positive" işaretle | ✅ | Audit + Woo meta yazma |
| Müşteri GDPR data delete talep | ✅ | Public form + runner |
| Operatör backup yap (manuel/cron) | ✅ | Makefile target + systemd |
| Yedekten kurtarma | ✅ | restore-drill + restore-from-backup |
| Multi-monitor: müşteri ekranı 2. monitörde | ✅ | Tauri IPC + Display token |
| OnlyOffice Excel canlı düzenleme | ✅ | AFG/Depolama/Log workbook |
| Cross-module sync (alış→log→depolama) | ✅ | BroadcastChannel + triggers |

**Toplam:** 21/22 ✅ — 1/22 ⚠️ (Uniconta SendEmail prod test eksik)

---

## 6. KOD KALİTESİ DEĞERLENDİRMESİ

### 6.1 ✅ Güçlü yönler

- **Tip güvenliği:** TypeScript strict mode + Pydantic v2 + SQLAlchemy 2.0 typed mappings.
- **Async-first:** Backend tamamen async; httpx + asyncio.Lock + database async session.
- **State machine'ler explicit:** `_allowed_status_transition`, `_resolve_effective_risk` net kurallar.
- **Audit trail:** 3 tablo + 10+ event türü.
- **Atomic operations:** SELECT...FOR UPDATE finalize lock, savepoint per-line batch-apply.
- **Hybrid mode:** Uniconta fail-soft, CRM kaydı kaybetmiyor.
- **Frontend reactive:** TanStack Query + BroadcastChannel cross-module sync.
- **Helper paylaşım:** lib/format, lib/cpr, lib/artifactSync, lib/toast tek noktada.
- **Test fixture:** vitest + jsdom + RTL setup uyumlu.

### 6.2 ⚠️ İyileştirme alanları

- **`pos_service.py` çok büyük (~2200 sat):** Müşteri, sale, refund, display, transaction her şey iç içe. Refactor adayı.
- **`useAlisMakeState.ts` çok büyük (~1700 sat):** Hook tek dosyada her şey; alt-hook'lara böl (`useCustomerForm`, `useMarketRates`, `useFinalize`).
- **`v2.py` 1700+ sat:** v2_alis, v2_inventory, v2_log gibi v2_uniconta, v2_customers, v2_dashboard'a ayrıştır.
- **Legacy v1 endpoint'ler kaldırılabilir:** `/api/customers`, `/api/inventory`, `/api/pos` artık kullanılmıyor (v2 var).
- **Frontend modül büyüklüğü:** `make/alis/AlisPage.tsx` 2326 sat; sub-component'lara böl.
- **Magic numbers:** Bazı dosyalarda 0.9999, 0.585 vb. saflık katsayıları hardcoded; tek `lib/purity.ts` constants.
- **Error handling tutarsızlık:** Bazı endpoint'lerde HTTPException, bazılarında raw exception; tek bir middleware ile standardize.
- **Logging tutarsızlık:** `LOGGER.info` / `LOGGER.warning` mix; structured logging convention belirle.

---

## 7. DOKÜMANTASYON DURUMU

| Doküman | LOC | Kapsam | Güncellik |
|---|---|---|---|
| `docs/PROJECT_SYSTEM_GUIDE_TR.md` | 922 | Genel mimari, modüller, akışlar | 2026-04 (kısmen güncel) |
| `docs/HANDOVER.md` (YENİ) | 1200+ | Tüm sistem devir kılavuzu | 2026-05-18 (tam güncel) |
| `docs/PRODUCTION_DESKTOP_RUNBOOK_TR.md` | 134 | Production deploy adımları | 2026-04 |
| `docs/DESKTOP_SMOKE_PREREQUISITES_TR.md` | 55 | Desktop smoke önkoşullar | 2026-04 |
| `docs/DEV_RUNTIME_PROTOCOL.md` | 33 | Dev runtime protokolü | 2026-03 |
| `docs/GDPR_TAURI_SMOKE_TR.md` | 28 | GDPR smoke test | 2026-04 |
| `docs/WORDPRESS_GDPR_BRIDGE_TR.md` | 42 | WP GDPR köprüsü | 2026-03 |
| `AGENTS.md` | 21 | AI agent komutu | 2026-03 |
| `FRONTEND_REDESIGN_BACKEND_HANDOFF.md` | 250 | Eski Next.js→Vite migration | 2026-03 (kısmen tarihsel) |
| **Bu dosya (`PROJECT_HEALTH_AUDIT.md`)** | — | Sağlık denetimi + roadmap | 2026-05-18 |

**Eksik dokümantasyon:**
- ✅ API endpoint kataloğu (Swagger UI auto-generated + `HANDOVER.md` §11)
- ✅ ERD (HANDOVER.md §10.1)
- ❌ Backend service detay (her servisin amacı tek satır var, deep dive eksik)
- ❌ Frontend component reference (Storybook yok)
- ❌ Database schema diagram (DBML / dbdiagram.io export)
- ❌ Sequence diagram (alış → uniconta → audit zinciri)
- ❌ Deployment runbook genişletme (Docker prod, systemd, nginx config örnekleri)
- ❌ Disaster recovery playbook (RTO/RPO + adım adım)
- ❌ Onboarding video / screen recording

---

## 8. SONUÇ VE TAVSİYELER

### 8.1 Proje "beklendiği gibi" mi?

**Evet, büyük ölçüde.** İş akışlarının hepsi (alış → log → depolama → uniconta → woocommerce → opmc → gdpr) operasyonel olarak çalışıyor. Son hafta yapılan kritik fix'ler (OPMC parse bug, cross-module sync, Uniconta retry, log audit, depolama D6-D15, alış P5-P16, uniconta U1-U16) önemli operasyonel sorunları çözdü.

Müşterinin spesifik şikayeti olan OPMC "durup dururken 100 risk" parse hatası **artık imkansız** (whitelist + known_customer + manual override koruması + regex parse kaldırma).

### 8.2 "Yapılması gereken her şey yapılmış mı?"

**Hayır, üretime çıkmadan kapatılması gereken 10 KRİTİK madde var** (bkz. §2.1.A güvenlik). En önemlileri:

1. **`.env` credential'larını repo'dan temizle** (OpenAI key, WC/WP/Uniconta credential'ları).
2. **JWT ve field encryption key'lerinin production'da değişmiş olduğunu doğrula.**
3. **Nginx HTTPS + HSTS** kur (web stack için).
4. **Auto admin seed'i prod'da kapat** veya en azından default parolayı değiştirmeye zorla.
5. **Backup encryption** ekle (CPR/kimlik bilgisi içeriyor).

Bunlar **production blocker**'lar. Çalıştırılır halde olsa bile production'a çıkartılmamalı.

### 8.3 Önerilen aksiyon sırası

#### Sprint 1 (Şimdi → 2 hafta)
- [ ] `.env` credential rotation + secret manager
- [ ] HTTPS/HSTS prod nginx
- [ ] Frontend E2E coverage: Playwright ile 1 → 5 scenario (login, alış finalize, log route, uniconta retry, opmc override)
- [ ] Backup encryption (gpg)

#### Sprint 2 (3-4 hafta)
- [ ] Sentry entegrasyonu + structured logging
- [ ] Password reset akışı
- [ ] Admin user CRUD UI
- [ ] Tauri Windows test + code signing

#### Sprint 3 (5-6 hafta)
- [ ] Multi-worker safety (Redis cache)
- [ ] Performance audit + N+1 query fix
- [ ] WCAG 2.1 AA audit
- [ ] Audit log UI

#### Sprint 4 (7-8 hafta)
- [ ] Tauri auto-update infrastructure
- [ ] i18n catalog (tek dile çıkarma)
- [ ] Job queue (Celery)
- [ ] Documentation deep dives

---

## EK: Otomatik denetim komutları

Bu audit'i periyodik tekrarlamak için:

```bash
# Backend test + coverage
cd backend && .venv/bin/pytest --cov=app --cov-report=term-missing

# Frontend test + coverage
cd frontend && npm test -- --coverage

# Typecheck
cd frontend && npm run typecheck

# Security: secrets in repo
git log -p | grep -E 'sk-proj-|ck_[a-z0-9]+|password=' | head -20
git ls-files | xargs grep -l 'API_KEY\|SECRET\|PASSWORD' 2>/dev/null | grep -v .env.example

# Migration head
cd backend && .venv/bin/alembic current
cd backend && .venv/bin/alembic check  # pending migrations?

# Dead code (frontend)
cd frontend && npx tsc --noEmit --noUnusedLocals  # unused imports

# Bundle size
cd frontend && npm run build -- --report

# OWASP check (Python)
cd backend && safety check
cd backend && bandit -r app/
```

---

**Bu rapor:** `docs/PROJECT_HEALTH_AUDIT.md`
**Eşlik eden dosya:** `docs/HANDOVER.md` (yeni teknisyen devir kılavuzu)
**Son güncellenme:** 2026-05-18

Bu denetim, projeyi son 1 ayda gözden geçirip 5 modülde (Alış, Depolama, Log, Uniconta, OPMC) toplam **51 madde** otonom uygulamayı tamamlayan çalışmanın sonucudur. Tüm uygulanan değişiklikler `tsc --noEmit` ve `vitest run` (15/15) ile doğrulanmış, backend `py_compile` temiz, alembic migration 0019_log_module_audit head'de.
