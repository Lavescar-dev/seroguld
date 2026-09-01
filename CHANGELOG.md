# Changelog

## [Unreleased]

### Eklendi

- **OPMC düzeltmesi — güven/risk semantiği:** OPMC (WC Anti-Fraud 7.2.2) `wc_af_score`'u **kalan güven puanı** olarak yazıyor; CRM bunu risk sanıp gösteriyordu ("güvenilir müşteriye 90 risk"). Artık `risk = 100 − güven` normalizasyonu uygulanıyor (`opmc_wc_af_score_mode="trust"`), eşikler resmi OPMC bantlarına çekildi (25-75 orta, ≥76 yüksek), skor kaynağı "OPMC Güven Skoru" olarak etiketleniyor. Güvenilir müşterinin 90 güven skoru artık 10 risk olarak görünüyor.
- OPMC ekranına skor tutarlılık denetimi (OPMC riski vs kural puanları), bozuk JSON meta kurtarma, aktif/geçmiş inceleme ayrımı (tamamlanan siparişler kuyruğa girmez), AI uyarısının ayrıştırılması ve Woo sipariş çekiminde tüm-sayfa gezme (eski tek-sayfa davranış dönem listelerini kesiyordu) eklendi.
- OPMC listesine `force_refresh` parametresi (5 dk önbelleği bypass eden Yenile butonu).

### Düzeltildi

- OPMC CRM görünümü yeniden düzenlendi: kalıcı "Yapım aşamasında" bandı ve nav "YAPIM" etiketi kaldırıldı; İngilizce/ham enum etiketler Türkçeleştirildi (Kaynak/Durum/Müşteri geçmişi); sahte "Kural görünümü" sekmesi ve uydurma "Owner" alanları temizlendi; dev risk sayıları küçük rozetlere çevrildi (0-100 ölçek ipucu); make/ ekranındaki ş/ı atılmış Türkçe metinler düzeltildi; pencere odağı değişiminde sürekli yeniden istek atan agresif refetch kapatıldı (Yenile butonu + force_refresh kaldı).

## [0.3.26] — 2026-08-31

### Eklendi

- **AFG belgesi orijinal düzeninde (AFG-P1):** Müşteri kopyası (POS ekranındaki "Müşteri PDF" önizlemesi ve finalize e-postasının eki) artık POS fiş şablonundan değil, orijinal `Afregningsbilag` Excel şablonunun print düzeniyle aynı olan bağımsız bir reportlab renderer'ından üretiliyor (`afg_document_renderer.py`) — LibreOffice/Office bağımlılığı yok. İç marj, POS kodu ve kalem sayısı müşteri belgesine sızmaz; altın satırları şablon sarısı, gümüş satırları şablon grisiyle basılır; yalnız dolu satırlar basılır (18705a9'daki Excel boş-satır gizleme davranışıyla aynı); tek sayfa garantisi 15 sabit slot + KeepInFrame ile mühürlenir; CPR yalnız doğum tarihi bölümüyle yazılır (`cpr_birth_part`, Excel yoluyla aynı minimizasyon).
- **AFG e-posta WP-bridge transportu (AFG-P2):** `EMAIL_TRANSPORT=wp-bridge` seçildiğinde e-posta, seroguld.dk'daki yeni WordPress eklentisi (`ops/wordpress/seroguld-crm-bridge/`) üzerinden `wp_mail()` + WP Mail SMTP ile gönderilir — SMTP şifresi WordPress'te kalır, CRM'e asla girmez. Bridge başarısızsa ve SMTP yapılandırılmışsa bir kez SMTP fallback denenir; audit kaydına `transport` alanı eklendi. Bridge: token (`X-SeroGuld-Bridge-Token`, `hash_equals`, downtime'sız rotasyon), 10 MB gövde tavanı (413), saatte 10 istek (429), HTTPS zorunlu (403), geçici ek dosyası gönderim sonrası silinir.
- PDF font yedek yollarına Windows adayları (`arial.ttf`/`segoeui.ttf` + bold) eklendi — müşteri Windows kurulumunda DejaVu yokluğunda ø/æ/å bozulması giderildi (mevcut latent bug).

## [0.3.26] — 2026-08-31

### Eklendi

- i18n kataloğu tamamlandı: 248 eksik anahtar tr/en/da için dolduruldu, i18n doğrulama adımı yeşile döndü.
- Alış çalışma alanında müşteri detach: `POST /alis/workspace/{id}/customer/detach` ile taslaktan müşteri bağlantısı sökülebiliyor (modern ve klasik UI'da "Seçimi kaldır"; onay diyaloglu). Metal satırları, oranlar ve notlar korunur.
- Woo otomatik metal fiyatı: ürün sihirbazına Markup (%) + Min fiyat alanları ve canlı spotla **yayın öncesi fiyat önizlemesi** eklendi; yayında WP "Live Gold Price" eklentisinin meta sözleşmesi (`_metal_type/_metal_weight/_metal_purity/_markup_rate/...`) basılıp fiyatın WP tarafında da otomatik güncellenmesi sağlandı. Depo listesinde "Woo fiyatı" sütunu + eksik bilgi rozeti (`woo_markup_rate`/`woo_min_price_dkk` kolonları, 0040 migration).

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
