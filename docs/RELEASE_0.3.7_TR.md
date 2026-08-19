# SERO GULD CRM 0.3.7 — Teslimat Raporu (2026-08-19)

13 Ağustos geri bildirim dokümanının (14 ekran görüntülü) kapanış sürümü.

## Installer

- Dosya: `C:\Users\Lavescar\Downloads\SERO-GULD-CRM-FULL-SETUP.exe`
- SHA256: (build sonrası eklenecek)
- Sürüm pinleri (7 konum, hepsi 0.3.7); alembic tek head `0035_product_dims_inventory`.

## Kapsam (aşama → commit)

| Aşama | İçerik | Commit |
|---|---|---|
| A | 0035 migration: `diameter_mm` + `inventory_category` backfill (tüm ürünlerde kolon NULL'du) | 59b16ed |
| B | **Lager boş liste kökten çözüldü:** kategori kolonu artık her kayıtta yazılır (tek kaynak `infer_inventory_categories`); klasik ekrana "Tümü" sekmesi; modern kapsam senkronu | 5c3b59d |
| C | Ölçü alanları uçtan uca: Çap (diameter) yeni alan; uzunluk/genişlik/kalınlık/üretici tüm kategorilerde + modern formda da; boş bırakılan değer artık silinir (clear bayrakları) | 95c4e84 |
| D | Ayarlar > WooCommerce Eşlemeleri: kategori ID / StoneX meta / rozet meta JSON haritaları + açıklama alt bloğu; installer allowlist'leri | ef1bad1 |
| E | **Woo foto push onarımı:** yanlış dosya adı/format eşleşmesi + sessiz hata yutma düzeltildi; uyarılar artık ekranda; medya tekrar yüklenmiyor (wc_media_id persist); ana foto öne çıkan görsel | 8378cad |
| F | Woo payload zenginleştirme: ölçü/karat/üretici attribute'ları ("Yderligere information"), karat bazlı kategori ID eşlemesi (**kategori yaratma kapatıldı**), Yoast/RankMath SEO title, StoneX + "Ny vare" 30 gün rozeti meta'ları, takı ürünlerine sabit Danca blok (Vi garanterer… + Størrelsesguide + Få hjælp) | e2d5a1a |
| G | `probe_woocommerce_site` keşif aracı (diğer bilgisayarda koşulur) | 8429298 |
| H | **Pt/Pd alış satırları uçtan uca** (tip kodları 8/9): Alış iki yüzeyde → AFG taslak 35/36 + VLOOKUP yedekleri → kompakt nihai belge → depoya `platin_pd`; müşteri ekranına PLATIN bloğu + bar satırları + KNIV kırılımı + **tek kelime GULD/SØLV başlıkları** ("SØLV·SØLV" bitti) | 7786ebc |
| J | Müşteri seçiminde panele kaydırma; `start` paramı temizliği; ölü dal temizliği. Not: "Seç → Alış'a atıyor" sorunu güncel kodda yok (eski build) | 6c7d19f |
| K | Sürüm pinleri + gate'ler + release | d9ed82c |

## Gate sonuçları (release öncesi son koşu)

- Backend: **253 passed, 1 skipped** (skip: 20-dosya tarihsel import manuel kabulü)
- Frontend: typecheck 0 hata; vitest **172 passed (40 dosya)**
- Rust: cargo check temiz; alembic tek head 0035

## Diğer bilgisayardan yapılacaklar (siteye erişim gerektirir)

1. **Servis hesabı** ("Efe Aras bağlıyor" düzeltmesi): WP'de "Sero Guld" kullanıcısı oluştur → Woo REST API anahtarını bu kullanıcıya bağlı yeniden üret → CRM Ayarlar > Entegrasyonlar > WooCommerce'e yeni consumer key/secret. Ürün "added by" kimliği API anahtarının kullanıcısından gelir.
2. **Probe aracı:** backend venv'de
   `.\.venv\Scripts\python.exe -m app.tools.probe_woocommerce_site --product-id 37844`
   → kategori ağacı ID'leri + referans ürünün StoneX/rozet meta key'leri dökülür ve
   yapıştırılmaya hazır JSON taslakları basılır → CRM Ayarlar > WooCommerce Eşlemeleri'ne yapıştır.
   Medya kanalını test etmek için `--test-upload C:\yol\foto.jpg` (siteye yazar, sonra siler).
3. **WP uygulama parolası kontrolü:** foto push artık hatayı ekranda gösterir; ilk yayında uyarı çıkarsa parolayı yenile.
4. **Eski kirlilik temizliği:** WP'deki "Test Bilezik" ürünleri ve eski push'ların yarattığı çöp kategoriler ("Gult Guld", "Smykke") silinsin/birleştirilsin.
5. **Hedef smoke:** aşağıdaki listeyle.

## Hedef makinede smoke listesi (kurulum sonrası)

1. `http://127.0.0.1:8100/health` → `{"status":"ok","version":"0.3.7"}`.
2. **Lager:** Depolama açılışında ürünler görünüyor; kategori sekmeleri doğru sayıyor; klasikte "Tümü" var.
3. **Pt/Pd alışı:** Alış'ta Platin/Palladium satırına gram gir → müşteri ekranında PLATIN bloğu → taslak workbook satır 35/36 → finalize → kompakt belgede Pt/Pd satırı → depoda `platin_pd` kategorisinde ürün. Oranlar fiyat ayar çekmecesindeki Pt/Pd değerlerinden gelir.
4. **Müşteri ekranı:** başlıklar tek kelime GULD/SØLV; bar alışında bar satırı; kniv hesaplayıcı kalemleri KNIV kırılımında.
5. **Woo yayını (eşlemeler yapıştırıldıktan sonra):** foto siteye gidiyor (ilk foto öne çıkan), "Yderligere information" tablosu dolu, kategoriler doğru (takı: Guldsmykker + karat; bar: Guldbarrer), "Ny vare" rozeti 30 gün, StoneX metal alanları dolu, takı açıklamasının altında sabit Danca blok. Uyarı çıkarsa toast'ta görünür.
6. **Müşteriler:** "Seç" aynı sayfada özeti açıyor ve panele kayıyor.

## Notlar

- Kategori/StoneX/rozet haritaları BOŞKEN yayın kırılmaz: ilgili özellik atlanır ve uyarı üretilir; probe çıktısı yapıştırılınca tam devreye girer.
- Sabit Danca blok yalnız takı ürünlerine eklenir (bar/sikke hariç), DB'deki AI açıklamasına yazılmaz, Ayarlar'dan kapatılabilir/değiştirilebilir.
