# MODULE STATUS — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** VERIFIED (kod + backend/frontend/desktop testleri; gerçek Windows ve canlı Uniconta kapsam dışı)

Durumlar: IMPLEMENTED / PARTIAL / STUB / MISSING / UNKNOWN / DEPRECATED / BROKEN / UNTESTED.

| # | Modül | Durum | UI | Backend | Veri | Test | Windows | Kanıt |
|---|---|---|---|---|---|---|---|---|
| 1 | Alış (POS/AFG) | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ (7+ pytest) | UNTESTED (UI render) | `v2_alis.py`, `pos_purchase_finalize.py`, `make/alis/` |
| 2 | Müşteriler | IMPLEMENTED | ✅ | ✅ | ✅ (AES-GCM) | ✅ | UNTESTED | `api/customers.py`, `make/` müşteri sayfaları |
| 3 | Depolama (envanter) | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ (workbook import testli) | UNTESTED | `v2_inventory.py`, `make/depolama/` |
| 4 | Log (AFG defteri) | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ (`test_log_ark1_roundtrip.py`) | UNTESTED | `v2_log.py`, `afg.py`, `make/log/` |
| 5 | Melt lot (eritme) | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ | UNTESTED | `afg.py:695-778` |
| 6 | Satış | **PARTIAL** | kısmi (POS trade_side, Woo) | ✅ legacy | ⚠️ teknik borç (enum snapshot) | ✅ override testi | UNTESTED | `pos_service.py:859-864,2286-2302`; modern modül MISSING |
| 7 | WooCommerce | IMPLEMENTED | ✅ | ✅ | ✅ sync_log | ✅ (4 pytest) | UNTESTED | `services/woocommerce.py`, `v2_woocommerce.py` |
| 8 | WordPress GDPR köprüsü | PARTIAL | ✅ public sayfalar | ✅ config endpoint | — | kısmi | — | snippet var; PHP plugin eksik (BROKEN script) |
| 9 | Uniconta | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ (smoke script) | — | `uniconta_service.py`, `make/uniconta/` |
| 10 | OPMC anti-fraud | IMPLEMENTED | ✅ | ✅ | ✅ | ✅ | UNTESTED | `antifraud_helpers.py`, `/opmc` |
| 11 | GDPR | IMPLEMENTED | ✅ cockpit + public | ✅ | ✅ 5 tablo | ✅ (2 pytest) | UNTESTED | `api/gdpr.py`, `gdpr_service.py` |
| 12 | Müşteri ekranı | IMPLEMENTED (Linux) | ✅ | ✅ WS | ✅ | CI smoke (feedback wf) | **UNTESTED çift monitör** | `main.rs:312-343`, `useDisplayLiveMakeState.ts` |
| 13 | Dashboard | IMPLEMENTED | ✅ | ✅ | — | — | UNTESTED | `make/dashboard/` |
| 14 | Raporlar | PARTIAL | ⚠️ route'suz `ReportsPage.tsx` (ölü) | ✅ `/api/reports/*` + Excel export | ✅ | ✅ `test_reports_export.py` | — | UI erişimi yok |
| 15 | AI servis | IMPLEMENTED | ⚠️ route'suz `AiPage.tsx` (ölü) | ✅ | ✅ ai_usage_log | ✅ (2 pytest) | — | `test_ai_service_prompt.py` |
| 16 | OnlyOffice dock | IMPLEMENTED | ✅ | ✅ | ✅ artifacts | ✅ | UNTESTED | `document_artifact_*`, `officeDock.ts` |
| 17 | Auth | IMPLEMENTED | ✅ login | ✅ JWT+refresh | ✅ | ✅ `test_security.py` | UNTESTED | `api/auth.py` |
| 18 | Backup/restore | IMPLEMENTED | — | script | ✅ | ✅ monitoring testi | — | `scripts/backup-*.sh`; **şifreleme MISSING** |
| 19 | Ayarlar | IMPLEMENTED | ✅ | ✅ | — | — | — | `/settings` |
| 20 | Koyu/açık tema | **BROKEN (no-op)** | ⚠️ toggle var, stil yok | — | — | — | — | `useRootMakeState.ts:120-158`; `dark:` 0 sonuç |
| 21 | legacy-next frontend | DEPRECATED | karantina | — | — | — | — | `legacy-next/README.md` |
| 22 | Platin (müşteri ekranı) | STUB | TODO satır | kısmi | ✅ metal enum | — | — | `CustomerDisplayCanvas.tsx:494` |

## Notlar

- **"UNTESTED (Windows)"**: Kod statik olarak platform-uyumlu görünse de gerçek Windows runtime doğrulaması yok; bkz. [PLATFORM_COMPATIBILITY.md](PLATFORM_COMPATIBILITY.md).
- **Stub/placeholder taraması:** backend'de TODO/FIXME yok; frontend'de tek TODO platin bloğu. "Yakında" metni 0 sonuç.
- **Ölü kod:** `pages/AiPage.tsx`, `pages/ReportsPage.tsx` route'suz; `components/SectionCard.tsx` eski koyu tema kalıntısı.
- **Test envanteri:** backend tam suite 130 test; frontend 17 vitest dosyası / 54 test + Playwright spec; desktop Rust unit suite ve Windows display smoke (CI) ayrıca doğrulanır.
