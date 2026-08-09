# PROJECT OVERVIEW — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000` · **Doğrulama seviyesi:** VERIFIED (kod + test) + USER-REPORTED (iş bağlamı)

## 1. İşletme bağlamı

- **İşletme:** Sero Guld og Sølv ApS — Valby Langgade 84, Valby/Danimarka; site `https://seroguld.dk`. (VERIFIED — `docs/HANDOVER.md:1457-1464`, `docs/README.md:110-115`)
- **Proje adı:** Kullanıcı projeyi "Sero Guld CRM" olarak adlandırıyor; repo/paket adı `seroguld` / "SERO GULD CRM" (USER-REPORTED isim eşleşmesi, kod ile doğrulandı).
- **Başlangıç:** ilk commit `0241f71` 2026-04-22 ("Seroguld ERP monorepo"); tarihsel commit sayıları çalışma branch'ine göre değişebilir. (VERIFIED — git log)
- **Mevcut operasyon (USER-REPORTED → VERIFIED):** İşletme operasyonu Excel ile yürüyordu. Kanonik referans Excel dosyaları repo içindeki `referans/` klasöründedir:
  - `Depolama.xlsx` — lager/envanter defteri (altın + gümüş tabloları).
  - `Log sistemi- afg verileri buraya yazdiriyorum..xlsx` — AFG kayıt defteri + yönlendirme blokları.
  - `Afregningsbilag ( alis frontumuz).xlsm` — makrolu alış belgesi şablonu.

## 2. Excel'den CRM'e geçiş

CRM, Excel'deki üç düzeni birebir modüllere dönüştürür:

| Excel | CRM modülü | Durum |
|---|---|---|
| `Afregningsbilag … .xlsm` (alış belgesi) | Alış (POS) + AFG finalize | IMPLEMENTED |
| `Depolama.xlsx` (lager) | Depolama (`products`) | IMPLEMENTED + workbook import/export |
| `Log sistemi- afg … .xlsx` (Ark1) | Log (AFG defteri + melt lot) | IMPLEMENTED + workbook import |

- Gerçek Excel dosyaları backend testlerinde import ediliyor: `backend/tests/test_raw_workbook_imports.py:249,378`. (VERIFIED)
- OnlyOffice WOPI dock ile Excel dosyaları CRM içinde canlı düzenlenebiliyor; cell→workspace senkron kontratı var (reconcile-preview/apply). (VERIFIED)
- Source-of-truth geçiş durumu: **CRM artık birincil sistem olacak şekilde tasarlanmış**; Excel "canlı doküman artefaktı" olarak bağlı. Cutover'ın tamamlanıp tamamlanmadığı UNKNOWN (kullanıcıya sorulacak).

Detay: [DATA_STORAGE_AND_EXCEL.md](DATA_STORAGE_AND_EXCEL.md).

## 3. Kullanıcı türleri

| Rol | Kim | Erişim |
|---|---|---|
| `admin` | Operatör / işletme sahibi | Tüm v2 endpoint'leri (`require_admin`) |
| `customer` | WooCommerce müşterisi (opsiyonel CRM hesabı) | Kendi verisi (`require_customer`) |
| Halka açık | Site ziyaretçisi | GDPR public formlar + müşteri ekranı (token'lı, auth'suz, salt-okunur snapshot) |

Roller: `backend/app/models/enums.py:9-11` — yalnız iki rol; personel-bazlı yetki ayrımı YOK.

## 4. Ana hedefler

1. Fiziksel alım (AFG) akışını Excel'den daha güvenilir ve izlenebilir yapmak. ✅ büyük ölçüde tamam
2. Envanter (Depolama) ve AFG defteri (Log) kayıtlarını tek sistemde toplamak. ✅
3. Eritme (melt lot) gider/payout takibi. ✅
4. WooCommerce mağazasıyla ürün/satış senkronu. ✅ (tek yönde satış webhook dahil)
5. Uniconta muhasebe entegrasyonu. ✅ (hybrid sync)
6. Danimarka uyumluluğu: CPR, GDPR, Bogføringsloven §10 (5 yıl saklama). ✅
7. İki monitörlü tezgâh düzeni: operatör + müşteri ekranı. ✅ Linux / ⚠️ Windows doğrulanmadı
8. **Modern satış modülü** — henüz yok; iş kuralları net değil. ⬜ DISCOVERY

## 5. Kapsam dışı (bu sistemin hedefi olmayanlar)

- `seroguld-priser` (fiyat panosu) ve `seroguld-webshops` (headless vitrin) ayrı projelerdir; bu CRM'in modülü değildir.
- E-posta pazarlama, sadakat programı, çok şube yönetimi — koddaki kapsam dışı.

## 6. AS-IS → hedef sistem özeti

**AS-IS (VERIFIED):** Desktop-first Tauri uygulaması; tek operatör; SQLite (dev) / Postgres (prod hedef); Alış→Log→Depolama/Eritme akışı çalışıyor; Woo + Uniconta entegrasyonu aktif; Excel artefaktları canlı dock ile bağlı.

**TO-BE (önerilen, henüz kararlaştırılmamış):** Windows'un first-class hedef olması (smoke + teşhis logu + gerçek çift monitör kabul testi), ayrı modern satış modülü (iş kuralları netleşince), açık tema dönüşümü, güvenlik audit maddelerinin kapatılması.
