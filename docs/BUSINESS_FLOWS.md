# BUSINESS FLOWS — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** VERIFIED (kod + test)

Her akış: **AS-IS** (gerçekte çalışan), **PARTIAL**, **MISSING**, **TO-BE** (öneri). Kanıtlar dosya:satır.

## 1. Müşteri yönetimi

- **AS-IS:** Alış workspace'inden müşteri arama/seçme (`v2_alis.py:233`), yeni müşteri oluşturma (`:259`), postal code lookup (`:225`). `/musteriler` sayfası liste + detay (`CustomerDetailOut`: istatistik + risk). Müşteri sonradan yeniden kullanılabilir. (USER-REPORTED gereksinimler doğrulandı.)
- **Veri:** `users` tablosu (müşteri+personel tek tablo); CPR/adres/kimlik no AES-GCM şifreli + aranabilir hash (`utils/security.py:75-121`); `customer_identity_documents` (passport/id_card/driver_license + foto).
- **Hata durumları:** CPR doğrulama (frontend `cpr` validasyonu, 7 vitest); müşteri başına açık taslak çakışması 409 (`pos_service.py:850-857`).
- **Yetki:** tüm müşteri endpoint'leri admin-only.
- **Test:** `test_customer_input_validation.py`, `test_customer_risk.py`.
- **MISSING:** Personel-bazlı erişim sınırı (tek admin rolü).

## 2. AFG fiziksel alım (Alış / POS)

**AFG = Afregningsbilag** — Danimarka'da müşteriden satın alma makbuzu; `PosDocument.document_type=PURCHASE_RECEIPT`. (VERIFIED — `docs/HANDOVER.md:1395-1396`, `pos_purchase_finalize.py:186,239`)

- **AS-IS akış:**
  1. `POST /api/v2/alis/workspace` → PosSession DRAFT, `trade_side=buy_from_customer` (`v2_alis.py:137`).
  2. Satırlar: `PUT …/rows` → PosSessionLine: `product_type`, `metal_type` (yellow/white gold, silver, platinum, palladium), `weight_grams`, `purity_karat`, `purity_percentage`, `rate_dkk` (`:272`). **Altın: gram + karat; gümüş: gram + saflık % (aynı kolonlar).** (USER-REPORTED beklenti doğrulandı.)
  3. Kur: Stooq canlı DKK/gram (20 sn cache) veya manuel; `rate_source` işaretli (`gold_price.py:13-31`).
  4. Teklif: `calculate_offer` — `pure_grams = weight × purity%/100`; alışta `×(1−margin)`; `quantize_2` ROUND_HALF_UP (`pos_value_helpers.py:118-138`).
  5. Finalize: `POST …/finalize` → satır kilidi + DRAFT kontrolü (tekrar: **409**), müşteri zorunlu (422), toplam>0 (422); PosDocument + Transaction + TransactionLine tek seferlik (`_ensure_*`); session CONFIRMED; ödeme notu `Betaling: Kontant|Bankoverførsel`; Uniconta hybrid sync (hata yutulur, durum belgeye yazılır) (`pos_purchase_finalize.py:27-338`).
  6. Çıktılar: liste + Excel export (`v2_alis.py:167,184`), termal fiş (`:458`), belge detay/düzenle/sil (`:403-508`).
- **Düzeltme:** "edit" akışı mevcut belgeyi günceller, yeni workspace'i CANCELLED yapar (`:113-214`).
- **Test:** `test_afg_roundtrip.py`, `test_pos_confirm_multiline_buy.py`, `test_pos_session_lines.py`, `test_pos_trade_side_math.py`.
- **TO-BE:** kullanıcıdan beklenen ek iş kuralı bildirilmedi; mevcut akış gereksinimleri karşılıyor.

## 3. Altın / gümüş satırları

- **AS-IS:** Tek satır modeli iki metali de taşır. Karat→saflık tablosu: 8k=33.3, 9k=37.5, 10k=41.7, 14k=58.5, 18k=75.0, 22k=91.6, 24k=99.9 (`woocommerce_import_helpers.py:29-37`). DB hassasiyetleri: gram `Numeric(10,2)`, saflık `Numeric(5,2)`, tutar `Numeric(12,2)`.
- **PARTIAL:** Platin satırları müşteri ekranında TODO (`CustomerDisplayCanvas.tsx:494` — backend bekliyor).

## 4. Depolama alanları (iki alan — kullanıcının unuttuğu)

Kullanıcının hatırlayamadığı iki "depolama" alanı kod ve referans Excel ile **VERIFIED**:

1. **Depolama** = fiziksel envanter (`products`). UI `/depolama`, API `/api/v2/depolama/*`. Excel atası `Depolama.xlsx` (sheet `Lager`). 12 filtre, sort, foto, etiket PDF, concurrent edit guard, `source-afg` izi (`v2_inventory.py:274`).
2. **Log (AFG defteri)** = AFG belge satırlarının defteri + eritme yönetimi. UI `/log` (alias `/afg`), API `/api/v2/log/*`. Excel atası `Log sistemi- afg verileri buraya yazdiriyorum..xlsx` (sheet `Ark1`, 4 yan yana blok: AFG defteri / takı stoğu / beyaz altın / ayrı depo). Route kararı batch apply (duplicate reddi, savepoint'li partial-failure — `afg.py:921`).

- **Akış:** Finalize → Log'da `awaiting_decision` → route: `inventory|undecided` → Product; `melt` → Product MELTED + melt lot auto-attach (`afg.py:43,1050,1152-1153`).
- **Melt lot:** draft→finalized (payout_total_dkk + sale_date zorunlu), reopen, delete (satır linkleri null'lanır); maliyetler: sigorta/nakliye/rafinaj + EUR kotasyon × kur (vars. 7.45) → payout varyansı; her mutasyon `AfgMeltLotHistory`'de (`afg.py:695-778`).

## 5. Satış

- **AS-IS (PARTIAL):**
  - Legacy POS session `trade_side=sell_to_customer` + `PosSessionProductLink` ("LEGACY sale akışı" — `docs/HANDOVER.md:698`).
  - PosDocument `sale_invoice`; fiyat sapmasında override onayı + audit (`pos_service.py:126,1723-1763`; test `test_pos_sale_override_approval.py`).
  - WooCommerce webshop satışı → webhook `_apply_sale_items` → CRM satış kaydı (`webhooks.py:110`).
  - Depolama'da "Satışa Hazırla" aksiyonu; Product status FOR_SALE→SOLD.
  - Teknik borç: DB enum'una `BUY_FROM_CUSTOMER` yazılıp trade_side snapshot'tan okunuyor (`pos_service.py:859-864`).
- **MISSING:** Ayrı modern satış modülü/ekranı; satışa özel iş kuralları (iade, kredi notu akışı UI'da, taksit vb.).
- **TO-BE / DISCOVERY:** İş kuralları kullanıcıdan netleştirilmeden tasarlanmayacak. Sorular: [DECISIONS_AND_OPEN_QUESTIONS.md](DECISIONS_AND_OPEN_QUESTIONS.md) §Satış.

## 6. Excel ile veri alışverişi

- **AS-IS:** Workspace/liste/rapor export (openpyxl); Log + Depolama workbook import (gerçek dosyalarla testli); OnlyOffice WOPI canlı dock + reconcile-preview/apply.
- Detay: [DATA_STORAGE_AND_EXCEL.md](DATA_STORAGE_AND_EXCEL.md).

## 7. WordPress / WooCommerce

- **AS-IS:** CRM→Woo ürün publish/unpublish/foto/SEO; Woo→CRM webhook sipariş satışı, sync-recent, ürün import (wc_id idempotent); GDPR köprüsü (public config endpoint + footer snippet).
- Detay: [WORDPRESS_INTEGRATION.md](WORDPRESS_INTEGRATION.md).

## 8. Operatör + müşteri ekranı

- **AS-IS (Linux VERIFIED):** Operatör `main` penceresi; müşteri penceresi Tauri komutuyla ikinci monitöre fullscreen açılır; tek monitörde pencere açılmaz (sessiz fallback, `has_secondary_monitor=false`); `/musteri-ekran` operatör önizlemesi.
- **Müşteriye gösterilen:** ad/iletişim, **maskeli CPR/kimlik**, satırlar, gram/ayar/fiyat, toplam teklif, belge no. Operatöre özel: marj, kur kaynağı, tam CPR.
- **PARTIAL/UNTESTED:** Windows'ta çift monitör hiç doğrulanmadı; monitör çıkar/tak davranışı test edilmedi; pencere pozisyonu persist edilmiyor.
- **TO-BE:** [PLATFORM_COMPATIBILITY.md](PLATFORM_COMPATIBILITY.md) §Önerilen mimari.

## 9. İptal / düzeltme / silme

- Session: draft→cancelled. Belge: edit akışı (yukarıda). Ürün: soft delete (`0012_product_soft_delete`). Melt lot: reopen/delete (history'li). Silmeler audit tablolarına işlenir; finansal kayıtlar 5 yıl `keep_restrict` (Bogføringsloven §10).

## 10. Yetki sınırları (özet)

Tüm operasyonel v2 endpoint'leri `require_admin`; müşteri ekranı token'lı public salt-okunur; GDPR public formlar auth'suz; webhook'lar HMAC imzalı. Detay: backend `api/deps.py:48-55`.
