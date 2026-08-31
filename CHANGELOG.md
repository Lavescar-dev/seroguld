# Changelog

## [0.3.26] — 2026-08-31

### Eklendi

- i18n kataloğu tamamlandı: 248 eksik anahtar tr/en/da için dolduruldu, i18n doğrulama adımı yeşile döndü.
- Alış çalışma alanında müşteri detach: `POST /alis/workspace/{id}/customer/detach` ile taslaktan müşteri bağlantısı sökülebiliyor (modern ve klasik UI'da "Seçimi kaldır"; onay diyaloglu). Metal satırları, oranlar ve notlar korunur.

### Düzeltildi

- Modern müşteri drawer'ında seçili müşteri alanları ile yeni müşteri formu/aramanın alt alta yığılması giderildi: panel görünümleri `resolveCustomerPanelView` ile karşılıklı dışlanan "Mevcut müşteri / Yeni müşteri" segmentine taşındı; drawer design-system `ModernDrawer`'a migrate edildi (focus trap + scroll lock).
- Otomatik kayıt onaylarının (autosave ack) operatörün aktif müşteri panel görünümünü ve yazılan yeni müşteri formunu ezmesi düzeltildi.
- Kimlik OCR'ı onarıldı: `OcrEngine.MaxImageDimension`'ı aşan görüntüler artık ölçekleniyor (büyük tarama/fotoğrafta "4 satır okudu" semptomu), MRZ satırlarındaki «/boşluk bozulmaları ICAO check digit doğrulamasıyla onarılıp okunuyor (arka yüz taramaları), Danca OCR paketi önceliklenip seçilen dil ve görüntü ölçek bilgisi arayüze raporlanıyor; tanınamayan belgede maskeli ham satır önizlemesi gösteriliyor. Tarama JPEG formatı WIA'ya açıkça isteniyor, gelen format otomatik tespit ediliyor.

- UI denetiminin 1.–4. gruplarındaki 16 bulgu kapatıldı: sessizce yutulan hatalar, ölü/etkisiz kontroller, `alert()`–toast tutarsızlıkları, raporlar (Reports) navigasyonu, müşteri relink akışı, AI onay adımı ve Ar-2026 kaydı.

### Güvenlik

- `.env.example` git geçmişinden tamamen temizlendi; sızma riski taşıyan JWT sırları döndürüldü (rotasyon).
- `xlsx` bağımlılığı 0.18.5'ten SheetJS CDN üzerinden 0.20.3'e taşındı (CVE-2023-30533, CVE-2024-22363).

### Altyapı

- Frontend'de testi olmayan 6 alan kapatıldı: +96 test (toplam 305); coverage eşiği tanımlandı.
- ESLint 9 + Prettier kurulumu yapıldı.
- CI, push ve pull request tetikleyicileriyle yeniden devreye alındı.
- Python sanal ortamı (venv) sıfırdan yeniden kuruldu.
- Updater v2 imzalama zinciri, signtool hook'u ve release otomasyonu kuruldu.

## [0.3.25] — 2026-08-29

### Eklendi

- 22K-2 "Satır Ekle" dropdown'u: alışta hem 22K hem 22K-2 kalemi seçilebiliyor.
- Kimlik belgesi yüklemeye modern dropzone (sürükle-bırak) ve cihaz meşgul ipucu eklendi.

### Düzeltildi

- WordPress'ten çekilen veriler artık açık çekmecede bulunan alanları da güncelliyor (R2-06 takibi).
- Müşteri panelinde overlay izolasyonu düzeltildi; mutex testleriyle koruma altına alındı.

### Altyapı

- Köprü (bridge) testleri genişletildi.

## [0.3.24] — 2026-08-29

### Düzeltildi

- WP Priser çekimi gerçek sayfa formatına uyarlandı (R2-06).
- R2-13: Yazdırma Tauri içinde artık gizli iframe + WebView2 print diyaloguyla çalışıyor.
- Belge görüntüleme Tauri'de modal penceresi içinde açılıyor.

## [0.3.13] – [0.3.23] — 2026-08-29 (checkpoint)

### Eklendi

- WP Priser otomatik fiyat çekme servisi.
- AFG tamamlanınca müşteriye otomatik e-posta gönderimi.
- RelinkCustomerModal ve toplu e-posta/ad/telefon eşleştirme.
- Kimlik OCR panelinde sürükle-bırak.
- Woo katalog içerik güncelleme ve kategori seçici.
- POS satır fiyatlama matrisi, fiş/Afregningsbilag renderer ve customer display snapshot.
- Oran editöründe makulluk (sanity) bantları.
- İkinci 22K kalemi desteği.

### Düzeltildi

- Alış fiyatlaması artık global market rate profilini tek canlı kaynak olarak kullanıyor.
- Migration 0039 ile saflık normalizasyonu (14K = 0.585, 22 ayar = 0.916).

### Altyapı

- Depolama seed'i güncellendi.
- Test sayısı 299 backend + 190 frontend'e çıkarıldı.

## [0.3.12] — 2026-08-21

### Düzeltildi

- Log modülünde route tuşları anında çalışır hale getirildi; modül modern UI yenilemesi aldı.

## [0.3.11] — 2026-08-21

### Eklendi

- Foto yükleme alanlarına sürükle-bırak.
- Depolama satırlarında satır fotoğrafı.
- Woo SKU toplu bağlama.
- Modern UI yeniden tasarımı.

### Düzeltildi

- Depolama veri kalitesi (tarih ve kod alanları).

## [0.3.10] — 2026-08-21

### Düzeltildi

- İçe aktarma merkezi (import merkezi) hataları giderildi.
- Depolama seed ve market rate veri akışları düzeltildi.
- OpenAI bağlantısı, firma profili ve harici URL açılış sorunları giderildi.

## [0.3.9] — 2026-08-21

### Eklendi

- Modern UI parite blokları 1–4 tamamlandı:
  - Woo: yayın sekmesi, CPR maskesi, lot silme koruması, OPMC filtreleri.
  - Depolama: düzenle-sil, alt-tip sekmeleri, fiyat paneli.
  - Log: lot alanları, satır sınıfı, not, ayrıştırma özeti.
  - GDPR aksiyonları, Uniconta kreditnota, AFG resmi bloğu.
- Yedekleme zamanlayıcı arayüzü.
- Woo/AI vision foto yolu, `gpt-5.6-luna` modeli, spec şeridi, HEIC + AVIF push.
- JSON schema structured output ve AI önerileri.
- Ürün tipine duyarlı Woo yayın profilleri.
- AFG içe aktarma onay listesi.
- Depolama durum filtresi.
- OPMC v2 override ucu.

### Düzeltildi

- Yüksek öncelikli denetim bulguları kapatıldı.
- Office/Excel UX iyileştirmeleri.
- Log import geçmiş-yıl kaybı düzeltmesi.
- Referans/ürün numarası satır kilidi (P0).

### Güvenlik

- Migration öncesi DB yedeği Alembic head'e göre alınıyor (P0).
- Woo webhook imza doğrulaması fail-closed yapıldı.
- Yedek ZIP'ine yalnızca kurtarma için zorunlu config giriyor.

### Altyapı

- Depolama seed foto havuzu.

## [0.3.8] — 2026-08-20

Baz sürüm. Ayrıntılı teslimat raporu: `docs/RELEASE_0.3.8_TR.md`.
