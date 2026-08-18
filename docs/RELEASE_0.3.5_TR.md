# Sero Guld CRM 0.3.5 Windows Teslim Raporu

> Üretim tarihi: 2026-08-18
>
> Kaynak branch: `build/seroguld-feedback-20260610-140000`
>
> Migration head: `0034_market_rate_confirmation` (yeni migration yok)

## Teslim dosyası

```text
C:\Users\Lavescar\Downloads\SERO-GULD-CRM-FULL-SETUP.exe
Boyut: 268,256,049 byte
SHA-256: b042e04d8f38ae79cd99a9564f3335912ee3a6d1f04d249e57ac323ba321d6e4
```

Yan dosyalar: `SERO-GULD-CRM-FULL-SETUP.exe.sha256`, `SERO-GULD-CRM-FULL-SETUP.manifest.json`.
Önceki 0.3.4 installer `Downloads\SeroGuldCRM-archive\` altına arşivlendi.
Defender taraması: 0 tehdit. Üretim: `scripts\release-windows-launch.cmd`
(VS ortamını kurar ve `release-windows-native.ps1 -Finalize -RunDefenderScan` çağırır).

## Bu sürümde ne değişti

13 Ağustos müşteri toplantısı planından (`RELEASE_0.3.5_WORKPLAN_TR.md`) tamamlananlar:

- **Depolama atomikliği:** ürün + envanter workbook projeksiyonu tek transaction;
  `document_artifacts.updated_at` tip hatası düzeltildi; başarısız istek ürün
  çoğaltamaz.
- **Depolama görünürlüğü:** "Tüm ürünler" kategori kapsamı; boş ekran aktif
  filtreleri açıklar ve tek tıkla sıfırlanır; sol menü sayacı liste ile aynı
  aktif-stok kümesini sayar.
- **Müşteri akışı:** "Seç" alışa götürmez, sağ panelde özet/iletişim/belge/alış
  geçmişi açılır; "Alış başlat" ayrı ve açık eylemdir (`/?customer=<id>`
  workspace'e müşteriyi bir kez bağlar). Metal etiketleri Danca tekleşti
  (Guld, Hvidguld, Sølv, Platin, Palladium) + bıçak hesaplayıcı toplamları.
- **Woo fotoğraf:** tıkla-seç yanında sürükle-bırak; istemci doğrulaması sunucu
  kurallarının birebir aynısı (image/*, jpg/jpeg/png/webp/avif, 15 MB);
  vurgu, yükleme durumu, hata mesajı ve galeri yenileme.
- **Eski AFG importu:** etiket C/F, değer D/G legacy şablonu algılanır; satırlar
  tür/ayar imzasından okunur; belge no, tarih ve tamamlanmış net/KDV/genel
  toplam birebir korunur (yeniden değerleme yok); aynı dosya (hash/belge no)
  ikinci kez içe aktarılamaz.
- **Excel köprüsü:** çalışma kopyası ve köprü başlatma hataları gerçek nedenle
  ayrışmış mesajlar verir; `.xlsm` VBA korunumu regresyon testiyle sabitlendi.
- **Yeni alışta KDV yok:** seçenek ve hesap uçtan uca kaldırıldı, net = ödenecek;
  eski KDV'li belgeler kayıtlı tutarlarıyla aynen korunur.
- **Piyasa fiyatı:** oranların tek kaynağı backend profili + workspace payload;
  bayat localStorage snapshot'ı ("382 girildi, 2850 kaldı") okunmaz ve temizlenir.
- Menü sayacı için bootstrap `total_inventory` artık aktif statüleri sayar.

## Açık kalanlar (sonraki tur)

- OCR gerçek fixture testi — gerçek test kimlik görselleri bekleniyor.
- P1 workbook görünümü ve alan sözleşmesi (bar satırları, etiket sağına yazım,
  CPR kısaltma, alt bilgi).
- P2 regresyon kapanışları (dashboard tanı, manuel piyasa modu UI, parola
  değiştirme modern UI, Woo çok sayfalı katalog, Uniconta satır görünümü).
- Hedef bilgisayarda uçtan uca kabul testleri (AFG akışı, gerçek Excel import,
  fiziksel yazdırma, ikinci monitör).

## Test durumu

- Backend pytest: 203 test yeşil (yeni: bootstrap sayacı, legacy AFG, VBA
  korunumu, KDV varsayılanları, envanter atomikliği, müşteri özeti).
- Frontend: `tsc -b` temiz, Vitest 125 test yeşil (40 dosya).
- Alembic tek head: `0034_market_rate_confirmation`.
- Release gate'leri: kaynak fingerprint, tek taze NSIS, zlib/Deflate, UPX yok,
  SG ikon, Defender 0 tehdit, atomik Downloads yayını — tamamı geçti.
