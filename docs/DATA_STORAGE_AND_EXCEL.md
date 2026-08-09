# DATA STORAGE AND EXCEL — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Migration head:** `0023_pos_document_customer_snapshot` · **Doğrulama seviyesi:** VERIFIED

## 1. Veritabanı

- **Dev/aktif:** SQLite `data/desktop.db` (`.env` `DATABASE_URL` ile). **Artık:** `data/seroguld_crm.db` 0 bayt, kullanılmıyor (INFERRED).
- **Prod hedef:** PostgreSQL (docker-compose: postgres servisi; asyncpg/psycopg). URL normalize edici `backend/app/database.py:16-23`.
- **Migration:** Alembic 23 migration, tek lineer zincir `0001_initial` → `0023_pos_document_customer_snapshot`.

## 2. Tablo haritası (özet)

| Tablo | Amaç | Kritik alanlar |
|---|---|---|
| `users` | Müşteri + personel | role, email, phone, postal_code, `cpr_number_encrypted`, `cpr_hash`, `cpr_last4`, `address_encrypted`, gdpr_status, woocommerce_customer_id |
| `customer_identity_documents` | Kimlik belgeleri | doc type, `identity_doc_number_encrypted`+hash, foto refs |
| `customer_activity_events` | Antifraud parmak izi | adres/telefon/cpr/kimlik **hash**'leri |
| `products` | **Depolama** envanteri | product_number, metal_type, weight_grams, purity_karat, purity_percentage, pure_gold_grams, purchase/sale/shop price DKK, status (purchased/in_inventory/for_sale/sold/melted/undecided), photos(JSON), woocommerce_product_id, storage_location, gdpr lock |
| `product_history` | Ürün audit | action, old/new JSON, performed_by |
| `pos_sessions` | Alış/satış workspace | session_code, display_token, trade_side, margin, final_offer_dkk, status, visible_snapshot |
| `pos_session_lines` | Çok satırlı alış | metal, weight_grams, purity_karat/percentage, rate_dkk, line_offer_dkk |
| `pos_documents` | **AFG / fatura belgesi** | document_type, gross/net/vat, müşteri snapshot, uniconta_sync_status/invoice_number/pdf_path |
| `pos_document_audit` | Belge audit | action, actor, payload, request_ip |
| `transactions` / `transaction_lines` | Finansal defter | trade_side, tutarlar; satırda melt_lot_id |
| `afg_melt_lots` + `_history` | Eritme lotları | metal_bucket, before/after ağırlık, sigorta/nakliye/rafinaj, quote_eur, exchange_rate_dkk, payout_total_dkk, status |
| `reference_sequences` | Numaralandırma | key, next_value |
| `document_artifacts` | Excel artefakt kaydı | artifact_key, module, version_kind, is_live, file_path, checksum_sha256 |
| `woocommerce_sync_log` | Woo işlem logu | action, payload, status, error |
| `ai_usage_log` | AI maliyet | model, token, maliyet USD |
| `gdpr_*` (5 tablo) | GDPR talep/retention | policy gün/aksiyon, job, event |

## 3. Para / gram / karat disiplini

- Her yerde `Decimal`; `quantize_2` = `Decimal("0.01")` ROUND_HALF_UP; `to_decimal` float/str güvenli (`utils/helpers.py:11-21`).
- DB: gram `Numeric(10,2)`, saflık `Numeric(5,2)`, kur `Numeric(10,2)`, tutar `Numeric(12,2)`, melt lot kuru `Numeric(8,4)`.
- Karat→saflık: 8k=33.3 / 9k=37.5 / 10k=41.7 / 14k=58.5 / 18k=75.0 / 22k=91.6 / 24k=99.9.
- Melt lot EUR→DKK varsayılan kur 7.45.

## 4. Dosya / evrak / fotoğraf depolaması

- `MEDIA_ROOT_DIR` (ürün fotoğrafları, `PHOTO_MAX_SIZE_MB` sınırlı, Pillow+AVIF), `DOCUMENT_ROOT_DIR` (belge PDF'leri), `data/documents/` mevcut.
- PDF/etiket/fiş üretimi reportlab (commit `d6163dd`).
- `document_artifacts` her Excel artefaktı için sha256 checksum tutar.

## 5. Excel entegrasyonu

| Yön | Mekanizma | Kanıt |
|---|---|---|
| Export | Workspace/liste/rapor/workbook (openpyxl 3.1.5) | `pos_workspace_exports.py:86`, `api/reports.py:222`, `GET /log/workbook`, `GET /depolama/workbook` |
| Import | Ham workbook import (Depolama + Log Ark1) | `document_artifact_service.py:1476,1484`, `document_artifact_afg.py:215`, `document_artifact_inventory.py:273`; test `test_raw_workbook_imports.py:249,378` |
| Canlı dock | OnlyOffice WOPI düzenleme + cell→workspace senkron | `document_artifact_*` servisleri; reconcile-preview/apply `v2_alis.py:349-377`, `v2_inventory.py:214` |

### Referans Excel şemaları (yalnız yapı — kişisel/finansal değer kopyalanmadı)

- `Depolama.xlsx` — sheet `Lager`, ~386 satır; üstte spot fiyat özeti; altın tablosu (`Lager dato, Ürün, Gram, tane, Haz altin gram, Alis fiyati, Spot fiyati, …, Uzunluk/Genişlik/Kalınlık, Üretici`), satır ~258'den itibaren gümüş tablosu (`Vare, Vægt, Antal, Finsølv gram, Købspris, Verdensmarkedsprisen`).
- `Log sistemi- afg verileri buraya yazdiriyorum..xlsx` — sheet `Ark1`, ~98 satır, 4 yan yana blok: AFG defteri (`Afg nr., Dato, Musteri, Gram, Kr., Has altin`), takı stoğu, beyaz altın, "ayrı depolama (satılacak mı belli değil)".
- `Afregningsbilag ( alis frontumuz).xlsm` — 5 sheet: belge şablonu, fatura guld/sølv, fatura diverse, `Variable værdier` (dagspris, lødighed, avanceprocent), kılavuz.

## 6. Source-of-truth ve reconciliation

- **Source-of-truth:** CRM veritabanı (işlem/belge/ürün kayıtları). Excel artefaktları `document_artifacts` ile versiyonlanmış/canlı işaretli bağlı dokümanlardır.
- **Alış workspace güvenliği:** Her sections/customer değişikliği `workspace_revision` ile compare-and-swap uygulanır; stale callback 409 alır. Builder yalnızca okur ve legacy sıfır fiyatı `needs_price_repair` olarak bildirir; GET sırasında commit yapmaz.
- **Belge müşteri snapshot'ı:** Finalize edilen `pos_documents` satırlarında adres/posta kodu/şehir snapshot'ı tutulur; sonradan müşteri kartı değişse bile finansal belge ekranı değişmez.
- **Senkron:** Excel→CRM import + WOPI reconcile (çift yönlü doküman düzeyinde); ham operasyonel veri CRM'e yazılır.
- **Duplicate önleme:** finalize satır kilidi + 409; ürün/belge numaraları `reference_sequences`; Woo `woocommerce_product_id` eşleşmesi.
- **Reconciliation:** Log ↔ Depolama `source-afg` zinciri (TransactionLine→Transaction→PosDocument); melt lot payout varyansı. Excel↔CRM için reconcile-preview/apply endpoint'leri.
- **UNKNOWN:** İşletmenin günlük operasyonda Excel'i hâlâ paralel yazıp yazmadığı (cutover durumu) — kullanıcıya sorulacak.

## 7. Yedekleme / geri yükleme

- `scripts/backup-gfs.sh` — GFS rotasyonu (hourly 48 / daily 30 / weekly 12), SQLite + pg_dump destekli → `data/backups/{hourly,daily,weekly}/`.
- `backup-verify.sh` bütünlük, `backup-offsite-sync.sh` rclone offsite mirror, `backup-restore-drill.sh` tatbikat (`data/restore-drill/`), cron installer.
- Sağlık yaş sınırları config'te; test `test_backup_monitoring_helpers.py`.
- **RİSK (VERIFIED):** yedekler **şifresiz** — CPR içeren plaintext yedek (PROJECT_HEALTH_AUDIT'te işaretli).

## 8. Veri hassasiyeti

- CPR/adres/kimlik: AES-GCM (`FIELD_ENCRYPTION_KEY`) + arama için hash. Müşteri ekranı maskeli.
- Loglara kişisel veri yazılmaması kuralı: `remote-codex-handoff/AGENTS.md` ve bu denetimin rapor politikası; kodda audit payload'ları JSON olarak tutulur (içerik sınırlı).
- GDPR retention: financial_ledger, afg_purchase_documents, afg_melt_lots, customer_master, gdpr_audit = 5 yıl; operational_logs 90 gün; backups 35/90 gün.
