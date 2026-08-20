# SERO GULD CRM 0.3.8 — Teslimat Raporu (2026-08-20)

`Adsız doküman (1).docx` (29 ekran görüntülü saha geri bildirimi) kapanış sürümü.

## Installer

- Dosya: `C:\Users\Lavescar\Downloads\SERO-GULD-CRM-FULL-SETUP.exe`
- SHA256: `(build sonrası doldurulacak)`
- Sürüm pinleri (7 konum, hepsi 0.3.8); alembic tek head `0036_product_woo_categories`.

## Kapsam (aşama → commit)

| Aşama | İçerik | Commit |
|---|---|---|
| 0 | CI dakika önlemi: `ci.yml` yalnız elle tetiklenir (workflow_dispatch) — Actions kotası %90 dolmuştu | e6845f7 |
| 1 | **P0 Alış zinciri kökten:** bar/Pt/Pd satırları autosave + canlı önizlemeye dahil (TOPLAM=0 ve "AFVENTER VARELINJER" bitti); önizleme sunucu satırlarını asla silmez; klasik toplamlara bar/ptpd; finalize'daki sessiz atlama kalktı ("3 hata" toast'ları bitti) | ce537eb |
| 2 | **Uniconta:** 2xx + düz metin hata gövdesi artık gerçek hata olarak yüzeye çıkar (`ArgumentMissing` ham metniyle); 3 deneme bayrağı default KAPALI (aşağıda); "GuldbarreK"→"Guldbarre" | 6a4d947 |
| 3 | **Firma adı mojibake:** Settings kaydı artık dosya + çalışan süreç env'ini birlikte günceller (restart beklemeden düzelir); UTF-8/BOM toleransları | 9b7fb83 |
| 4 | **Foto önizleme + drag&drop:** medya URL'leri mutlak (paketli Tauri'de 404 bitti); `dragDropEnabled:false` ile HTML5 drop serbest — tüm dropzone'lar çalışır; wizard foto adımı + tarihsel içe aktarma drop alanları | 6a3cc30 |
| 5 | **GDPR 14 gün = yalnız bilgi:** yayın/satış/eritme/durum geçişi engelleri kalktı (7 backend + 9 frontend nokta); sarı bilgi chip'i kaldı | 8a2343f |
| 6 | **Alış UX:** tek Müşteri butonu + Mevcut/Yeni menüsü; Yeni müşteride kimlik fotoğrafı/OCR alanı; Belge ülkesi ve CPR format yazısı kalktı; Kniv beregner ayrı sheet + gümüş "Aktar" anahtar eşlemesi düzeltildi | 7dec51d |
| 7 | **Woo:** WP'den kategori seçici (yayın paneli + sihirbaz, ürün başına kalıcı); spec şeridi "Vare nr. : X, Vægt: Yg Diameter: Zmm" hem kısa hem uzun açıklamada; katalog ürünleri tıklanabilir → SEO/açıklama/görsel detay paneli + CRM bağla/yayından kaldır; **Etiket butonları şimdilik gizli** | 27b1130 |
| 8 | **Ayarlar:** canlı fiyatta alan bazlı seçim (kur/platin/palladyum ayrı ayrı otomatikte bırakılabilir); metals.dev API kartı; OPMC kartı URL doluysa hazır ("API anahtarı opsiyonel — modül yapım aşamasında") | 40d38fe |
| 9 | Sürüm pinleri + gate'ler + release | (bu commit) |

## Gate sonuçları (release öncesi son koşu)

- Backend: **269 passed, 1 skipped** (skip: 20-dosya tarihsel import manuel kabulü)
- Frontend: typecheck 0 hata; vitest **180 passed (42 dosya)**
- Alembic tek head `0036_product_woo_categories`

## Uniconta `ArgumentMissing` — hedefte bayrak bayrak deneme

Kök: Uniconta bazı hataları 2xx + düz metin gövdeyle dönüyor; 0.3.8 bunu artık
ekranda ham metniyle gösterir. Gövde sözleşmesi için 3 aday düzeltme **default
KAPALI** bayraklarla geldi. Hedef makinede `runtime.env`'e sırayla ekleyip
(her denemeden sonra CRM'i yeniden başlat, bir fatura senkronu dene):

1. `UNICONTA_ORDERNUMBER_IN_ORDER=true` — OrderNumber'ı kök seviyeye taşır.
2. Olmadıysa ek olarak `UNICONTA_OMIT_NULL_ITEM=true` — null `Item` alanını gövdeden çıkarır.
3. Olmadıysa ek olarak `UNICONTA_ACCEPT_JSON=true` — `Accept: application/json` ister.

Hangi kombinasyon tutarsa o bayraklar kalıcı bırakılır; log'da
`GenerateDebtorInvoice gövdesi:` satırı hangi bayrakların açık olduğunu gösterir.

## OPMC açıklaması

OPMC modülü yapım aşamasında: ekrandaki OPMC verileri sitedeki webhook/manuel
kayıtlardan gelir, `opmc_api_key` henüz hiçbir canlı çağrıda kullanılmıyor.
Bu yüzden kart URL doluysa "hazır" sayılır ve anahtar alanı "(opsiyonel)"
işaretlidir. Entegrasyon durumu artık 6/6 gösterebilir.

## Hedef makinede smoke listesi (kurulum sonrası)

1. `http://127.0.0.1:8100/health` → `{"status":"ok","version":"0.3.8"}`.
2. **Alış (P0):** bar + platin + palladyum satırlı bir alış → TOPLAM'lar anında dolu, müşteri ekranı "AFVENTER VARELINJER" demiyor, finalize TEK tıkta bitiyor (409/400 toast yok).
3. **Foto:** Depolama/Woo kartlarında ürün fotoğrafları görünür (404 yok); Woo sihirbaz foto adımına ve tarihsel içe aktarmaya dosya sürükle-bırak çalışıyor.
4. **Firma adı:** Ayarlar'da firma adını (ø/æ/å'lı) kaydet → belge başlığında anında doğru.
5. **GDPR:** 14 gün penceresindeki ürün satılabilir/yayınlanabilir/eritilebilir; yalnız sarı bilgi chip'i görünür.
6. **Alış UX:** tek Müşteri butonu → Mevcut/Yeni menüsü; Yeni'de kimlik foto/OCR alanı; Kniv beregner'de gümüş "Aktar" satırları alışa taşıyor.
7. **Woo:** yayın panelinde kategori seçici WP kategorilerini listeliyor (Yenile çalışır); yayınlanan üründe açıklamaların başında "Vare nr. : …, Vægt: …g" şeridi; katalog satırına tıklayınca SEO detay paneli açılıyor.
8. **Ayarlar:** Piyasa oranlarında master açıkken kur/platin/palladyum tek tek otomatikten çıkarılabiliyor (çıkarılan alan çekmecede elle düzenlenebilir); metals.dev kartı var; OPMC satırı URL doluyken yeşil.
9. **Uniconta:** senkron hâlâ `ArgumentMissing` derse yukarıdaki bayrak denemesi uygulanır — hata artık ham metniyle görünür.

## Notlar

- Etiket yazdırma butonları gizlendi (backend ucu duruyor); yazıcı köprüsü ileriki sürümde.
- Kategori seçicide hiçbir şey seçilmezse eski davranış (Ayarlar'daki karat→kategori haritası) aynen geçerli; seçim yapılırsa ürün başına hatırlanır.
- metals.dev anahtarı yalnız `runtime.env`'de saklanır, ekrana/log'a geri dönmez.
