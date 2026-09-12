# Changelog

## [0.3.43] — 2026-09-13

### Gerçek kartlarda kimlik-OCR alan düzeltmeleri

Saha teşhisi: OCR motoru metni DOĞRU okuyordu — bozuk olan satır→alan
eşlemesiydi. Pencereler SPECIMEN fixture'ına kalibreydi; gerçek kartta
læge bloğu satırları aşağı kaydırıyordu (ad CPR'ın altında, SPECIMEN'ın
tersine). Belirtiler: ad yerine "g: Sik." (çöp, DOĞRULANDI rozetiyle),
adrese CPR satırı sızmış, şehir ad+sokak birleşmiş, kørekortta soyad hiç
dolmuyordu. Gerçek kart kapısı (`~/card-photos/real`, repo dışı):
sundhedskort ad/CPR/adres/postal/şehir 5/5, kørekort ad/CPR/belge-no 3/3.

- **Sundhedskort çapa taraması:** CPR satırı bulunur → posta satırı
  (dddd+şehir) altında aranır → ad ve adres postadan YUKARI taranır (CPR
  satırı atlanır). Tekil kural hem SPECIMEN hem gerçek düzeni çözer;
  pencere yolu yedek kalır. CPR artık çapa satırından gelir (pencereden
  değil); posta penceresi çok satırlıysa şehir yalnız posta desenli
  satırdan gelir ("Paris Recai Demir Boulevard 47" birleşmesi biter).
- **Dev kelime kutusu filtresi:** filigran artıkları ('ECIMEN', dikey
  'SUNDHEDSKORT', foto bölgesi çöpü) kelime yüksekliği tuvalin ~%20-43'ü
  ölçüp satır gruplamasında KÖPRÜ kurarak alakasız satırları tek satırda
  birleştiriyordu. Yüksekliği %15'i aşan kutular satır seçimine girmez
  (ocr_text'te kalır — belge tipi kokusu onlardan gelir).
- **Semantik kapılar:** ad/adres penceresine CPR/tarih/kısa-çöp sızmışsa
  alan ÜRETİLMEZ. Çöp-DOĞRULANDI yerine boş alan → nofields tetiği →
  kalite kipinde VLM kurtarma yolu açılır. VLM'siz ortamda operatör boş
  görür (bilinçli takas: dürüstlük > yanlış dolu).
- **Bulanık etiket düşürme:** yanlış okuma ailesi ('Sik.', 'frac',
  'Gyldigt'…) Levenshtein ≤1 ile etiket sayılır; kısa gerçek kelimeler
  ('Frk', 'From') bilinçli olarak düşmez.
- **Kørekort yapışık çapa:** '1.Demir' tek token'ında çapa değerden
  bölünür ('l.' okuması 1'e onarılır); '4b.2055-04-20' / '4d.200485-2985'
  alan-no önekleri ayıklanır; CPR ardışık 6+4 çiftiyle çıkar; belge-no
  penceresine sızan CPR örüntüsü süpürülür. Tek parçalı ad artık mevcut
  parçaların minimum güveniyle needs_review'a düşer (yapay yüksek güven
  kalktı). Çapasız tek alfa satırı yuvalara yazılmaz.
- **Merge superset:** yerel ad eksik parçalıysa (needs_review) + VLM tam
  adı validated getirdiyse + yerel token kümesi VLM'inkinin katı alt
  kümesiyse ("Recai" ⊂ "Recai Demir") VLM değeri alınır
  (`vlm_superset:full_name`). Doğrulanmış yerel değer asla ezilmez.
- **Bench:** `address` (truth `street`/`address` anahtarı) artık
  skorlanıyor; `--images` gerçek taramaları `run_vlm`'de de truth yan
  dosyasıyla skorlanır. Fixture as-is 52/55 ölçülen alan (adres alanı bu
  sürümde ilk kez ölçülüyor; fail: pas_05_glare taban davranışı ×2,
  sund_03_blur adres — filigran harfi satıra karışmış).

### 0.3.42'den taşan denetim düzeltmeleri (7c35dba)

- CPR-yokluk kör noktası: barkod çözülemediğinde CPR'ın hiç üretilmemesi
  de nofields tetiğidir (pas muaf — pasaportta CPR basılı değildir).
- Arka yüz: kalite kipinde DK kartlarının arkasında çekirdek alan olmadığı
  için VLM hiç denenmez (faydasız ücretli çağrı); `always` muaf değildir.
- expiry yüzyılı geleceğe çözülür (yy ≤ 69 → 20xx) — VLM 2 haneli okumada
  sahte çelişki üretmiyor.
- `max_tokens` parametre adı model ailesine göre seçilir (gpt-5*/o-serisi
  `max_completion_tokens` ister; 400 unsupported_parameter kalkar).
- ai_service ölü `max_tokens` ayarı yalnız reasoning boşken payload'ta;
  bench pimi doğrudan atamayla setdefault tuzağından çıktı; slow-seconds
  ayarı gt=0 doğrulaması; runbook/yorum düzeltmeleri.

## [0.3.42] — 2026-09-12

### Kimlik OCR hiyerarşisi — yerel birincil + kalite-tetikli VLM yedeği

- **Hiyerarşi:** yerel (RapidOCR) katman birincil okuyucu; VLM yalnız kalite
  tetiklendiğinde çağrılır (`IDENTITY_VLM_TRIGGER_MODE=quality`, default) ve
  birleşimde yalnız BOŞ alanları doldurur. Tetik yoksa VLM hiç çağrılmaz —
  kaynak=local, usage yok, maliyet sıfır. `always` kipi eski koşulsuz
  davranışı geri getirir (bench modu; merge politikası iki kipte ortak).
- **Tetikler (1→4 öncelik, tek neden döner):** (1) no_fields — full_name
  boş; ya da doc_number boş ve belge sundhedskort değil (sundhedskortta
  basılı belge no yok); (2) lowconf — roi_low_confidence veya çekirdek alan
  güveni eşik altı; (3) ndet/glare — card_not_detected / glare_detected;
  (4) slow — yerel gecikme > 5 sn (`IDENTITY_VLM_LOCAL_SLOW_SECONDS`).
- **Merge:** öncelik barkod > yerel > VLM. Çekirdek alanlarda yerel ile VLM
  kanonik biçimde çelişirse YEREL KORUNUR, alan needs_review'a düşer ve
  `vlm_conflict:{field}` uyarısı yazılır — koşulsuz ezme kalktı (Mistral
  bench'inde beş modelin de yereli bozması tam buydu). Kanonik karşılaştırma
  biçim farkını çelişki saymaz; document_type yerel-öncelikli.
- **Telemetri:** `local_slow`, `vlm_triggered:{nofields|lowconf|ndet|glare
  |slow|always}`, `vlm_conflict:{field}` token'ları idscan.warn.* ailesine
  yazar (alan adı taşınır, alan değeri asla). local_slow'da tarama ekranında
  "Yerel okuma çok uzun sürdü, bulut doğrulaması denenecek" ikazı görünür.
- **Capabilities:** `vlm_trigger_mode` additive alan (eski frontend
  bilinmeyeni yok sayar). VLM model fallback tek yardımcıdan beslenir
  (boşsa `gpt-4.1-mini`); Azure'da bu ayar DEPLOYMENT adıdır.
- **Bench:** resmi VLM bench artık always kipte koşar (quality kipte
  tetiksiz taramalarda VLM çağrılmayınca ölçüm totolojikleşir); vlm kanal
  kapısı identity anahtarını da kabul eder. Sentetik taban 43/65 ve 48/50
  alan doğruluğu birebir korunur.

## [0.3.41] — 2026-09-11

### Kimlik telemetri + VLM yedeği aday bench'leri

- **idscan.warn telemetri:** extract yanıtının makine uyarı token'ları
  (glare_detected, roi_low_confidence, card_not_detected, cpr_mod11_failed_soft,
  vlm_failed:*) `idscan.warn.{side}.{type}.{token}` kodlarıyla
  ui-diagnostics.jsonl'e yazılır — saha arıza oranları jsonl'den okunur;
  atom kısıtı [A-Za-z0-9-_.:+] ≤64 karakteri üretici garantiler.
- **VLM max_tokens tavani:** `_call_vlm` payload'ına `max_tokens: 1024` —
  OpenRouter modelin tam tavanını krediye rezerve edip 402 döndürüyordu;
  fix maliyet üst sınırını da garantiler.
- **Mistral ailesi kapıyı GEÇEMEDİ** (sentetik bench, 5/5 model yereli
  bozdu: Small 3.2/2603 37, Medium 3/3.1 36-38, Large 40 vs taban 43) —
  hesap açılmadı; merge politikası gerilemenin ana nedeni olarak belgelendi.
- **Azure adayları (OpenRouter dağıtımıyla):** gpt-4.1-mini / gpt-5-mini /
  gpt-5-nano tabanla BİREBİR parite (43/65), llama-4-maverick 44/65.
  Üretim adayı **gpt-4.1-mini** (parite + ~1 sn + Azure EU Data Zone
  teyitli + ~$1/ay); küçük katmanlar (4.1-nano, 5.6-luna, 5.4-nano)
  clean fixture'da bile adı bozuyor.
- Belgeler: `docs/IDENTITY_LOCAL_OCR_BENCHMARK_TR.md` bench bölümleri +
  `~/Clients/Recai_Demir/vlm-yedegi-etkinlestirme.md` runbook.

## [0.3.40] — 2026-09-10

### Flatbed / eğik / portre tarama OCR düzeltmesi

- **Portre (dikey) tarama:** kadraj-önceliği + ortogonal sonda — dik kart
  manzara kadrajda en fazla %36'lık pencere alıyordu; portre 0/50 → 41/50.
  Satır-bant istatistiği flip-değişmez; foto-sol asimetrisi satır bantlarına
  taşınır.
- **Eğik tarama:** 180° ters aday ≥2 alan şartıyla; çapa token taraması;
  deskew izdüşüm + sıkı kapı + 200 kelime tavanı.
- **Warp tam çözünürlükten:** küçültülmüş tuvalden değil, full-res kaynaktan
  warp (satır yüksekliği korunur).
- Sim katmanı benchmark'ta ölçülmez (asis koşul gerçek taramada değerlidir).

## [0.3.39] — 2026-09-09

### Kimlik OCR — yerel PP-OCRv6 motoru + barkod bayraktan ayrıldı

- **Kök neden (0.3.38 saha dersi):** üç katmanlı mimari müşteri makinesinde
  HİÇ çalışmadı — `identity_extract_enabled` kapalıydı, frontend
  capabilities'a bakıp isteği hiç atmıyor, backend bayrak kapalıyken
  barkoda girmeden 503 atıyordu. Tezgah hep eski Windows-OCR zincirinde
  kaldı ("tamamen birebir aynı" sonucu bu yüzden).
- **Barkod bayraktan ayrıldı:** `POST /alis/identity/extract` artık VLM
  bayrağı arkasında DEĞİL — Tier 0 barkod (Code 128, checksum'lı tam-10
  CPR) HER ZAMAN koşar; yerel motor `IDENTITY_LOCAL_OCR_ENABLED`
  bayrağıyla, VLM bayrak+anahtarla katılır. Bayrak kapalıyken 503 YOK.
- **Yerel motor (RapidOCR / PP-OCRv6, offline):** görüntü dükkân
  PC'sinden hiç çıkmaz. Ön-işleme yeni: kart dörtgen algılama +
  perspektif düzeltme (ID-1 tuvaline warp), CLAHE kutup düzeltme,
  parlama algılama (çift kapı), ROI kırpımları 2.5× büyütme. Modeller
  wheel package-data olarak installer'a gömülür — runtime indirme YOK.
- **`local_engine` uygunluk göstergesi oldu:** capabilities'teki
  `local_engine` bayraktan BAĞIMSIZ motor-kurulu sinyalidir; frontend
  buna bakarak extract isteğini atar (bayrak kapalıyken de barkod
  katmanı koşabilsin diye — 0.3.38 tuzağına dönülmez). Capabilities
  GET auth'u `require_password_change_complete`'e gevşedi (yalnız
  bool/etiket döner, PII yok); extract POST admin kaldı.
- **Frontend birleşim zinciri:** backend alanları > RapidOCR tam-kart
  metni (`ocr_text` regex) > Windows-OCR metni — `mergeParsedIdentity`
  geriye doğru zincirle. Barkod CPR'ı ROI CPR okunamazsa doldurur (tam
  10 hane, KIRPMA YOK). Motor rozeti ("Yerel motor" / "Windows OCR
  (yedek)" / "VLM") üç diyalog yüzeyinde + tanı koduna `.LOC/.VLM/.WIN`
  etiketi. Parlama uyarısı + yakalama rehberi + da-DK paket kontrolü.
- **Parse quick-win'leri:** DK kørekortunda basılı OLMAYAN
  adres/posta/şehir araması kaldırıldı (yalnız hata üretiyordu);
  sundhedskort isim penceresi 5→7 satır + tek bozuk satır atlama;
  ülke beyaz liste (ISO-3 + takma adlar); `identity_doc_type`
  validated ancak ad+numara birlikte okunduysa.
- **Benchmark kapısı (canlıya ALMA koşulu):** gerçek kart fotoğrafları
  repodan BAĞIMSIZ `~/card-photos/` + truth yan dosyası;
  `ocr_benchmark.py --engine local --roi-dump` ROI kalibrasyonu,
  `IDENTITY_OCR_ROI_OVERRIDES_JSON` env override. Kapı: doğruluk ≥
  vitest taban çizgisi VE barkodlu her fotoğrafta tam-10 CPR VE p95
  < 2 sn — üçü sağlanmadan bayrak açılmaz
  (`docs/IDENTITY_LOCAL_OCR_BENCHMARK_TR.md`).
- Paketleme: requirements +`rapidocr==3.9.2` +
  `opencv-python-headless` (GUI cv2 tuzağı build script'te fixup +
  assertion); PyInstaller spec `collect_all` +rapidocr/onnxruntime/cv2;
  paketli smoke'a capabilities `local_engine` denetimi eklendi.

## [0.3.38] — 2026-09-08

### WooCommerce foto sürükle-sıralama — 4 yüzeyde tek etkileşim

- **Tutup taşıma birincil etkileşim oldu:** fotoğraf kartlarını sürükleyip
  bırakarak sıralama artık 4 Woo yüzeyinde birden çalışır — modern
  PhotosTab, klasik ürün detayı, klasik sihirbaz adım 4, modern sihirbaz
  adım 4 (5. yüzey: DepolamaPage aynı ortak yardımcıya geçirildi,
  davranış değişmedi). İlk görsel Birincil olur; yayında `images[0]`,
  AI betimlemesi aynı sıradan beslenir.
- **Ortak yardımcı:** `photoReorder.ts` — `moveId` + `usePhotoReorder`
  + `photoCardDragProps` (kart üstü drop'un dropzone'a köpürmesi
  `stopPropagation` ile kesilir; kart düşürmek dosya yüklemez).
- **Backend ucu:** `PUT /api/v2/woocommerce/products/{id}/photos/order`
  (mevcut legacy reorder mantığına v2 köprüsü; optimistik güncelleme
  yok — invalidate + refetch). Sıralama kalıcı yüzeylerde anında PUT,
  sihirbazlarda yerel dizide tutulur (ağ çağrısı yok, kayıtta korunur).
- Kalıcı yüzeyde hata: "Fotoğraf sırası kaydedilemedi" toast'ı; i18n
  kataloğu genişletildi.

### CPR 6/10 düzeltmesi — "6 haneli girilemiyor" rezilliği bitti

- **6 hane = yalnız doğum tarihi, meşru giriş:** `classify_cpr`
  (EMPTY/BIRTH/FULL/INVALID) ile 6 haneli CPR (dd 01-31, mm 01-12)
  kabul edilir; 7-9 hane 422 "6 veya 10 haneli olmalı" verir. POS
  hızlı-kayıt dahil tüm müşteri oluşturma yüzeylerinde geçerli.
- **Doğum-bölümü hash'i:** `cpr_birth_hash` kolonu (ilk 6 hanenin
  `"cpr-birth:"` domain-önekli HMAC'i; tam-CPR hash'iyle asla çakışmaz)
  + `cpr_is_partial` bayrağı. Migration 0042; backfill migration İÇİNDE
  DEĞİL — idempotent CLI aracı 200'lük batch'lerle doldurur, bozuk
  satırı atlar (decrypt edilemeyen kayıt asla patlamaz).
- **Yumuşak dup:** aynı doğum bölümünde ikinci kayıt → 409
  `cpr_birth_conflict` + aday listesi (ad + maskeli CPR); operatör
  onayı (`confirm_cpr_conflict`) ile geçilir, onay kayda yazılmaz.
  Tam-CPR çakışması eskisi gibi kesin 409 — onayla aşılamaz.
- **Arama/eşleme canlandı:** 6 haneli arama `cpr_birth_hash` üzerinden
  bulur, 10 hane hash OR birth_hash, 4 hane last4; customer-match
  `match_kind: "birth"` döner, frontend normalize whitelist'i taşıyor.
- **Form tarafı:** `CprInput` müşteriler sayfasına bağlandı (kayıt
  butonu 6/10 hanede açılır — geç 422 biterdi); alış klasik+modern
  yüzeylerde 6 hane kabulü + "Yalnız doğum tarihi girildi — kalan 4
  hane sonradan tamamlanır" ipucu; 409 soft-dup diyalog akışı
  (`cprConflict.ts`) alış ve müşteri kayıt mutasyonlarına sarıldı.

### Kimlik OCR — üç katmanlı mimari (hardcore CPR rezilliğinin sonu)

- **Tier 0 — Barkod (yeni, offline, maliyet 0):** sarı sundhedskorttaki
  Code 128 barkodu zxing-cpp ile decode edilir; CPR **check-character
  doğrulamalı** gelir — checksum'lı kaynak. Görüntü bellek içi işlenir,
  diske ASLA yazılmaz. VDS'te ölçüm: 0,5 ms/görüntü.
- **Tier 1 — Doğrulama katmanı (lokal):** `identity_validate.py` —
  Danca CPR soft doğrulama (mod-11), TCKN (mod 10/11 + O/0-I/1-B/8
  OCR onarımı), kørekort no biçimi, doğum tarihi-CPR tutarlılığı,
  æøå/ğış transliterasyonu. Güven eşiği altı veya checksum bozuk →
  `needs_review` (sessiz yazım yok).
- **Tier 2 — Vision-LLM (flag'li, opt-in):** `POST
  /api/v2/alis/identity/extract` — strict json_schema ile serbest metin
  yasak; barkod CPR'ı VLM değerini ezer, doğum tarihi birleşim sonrası
  FİNAL CPR'a göre yeniden değerlendirilir. `identity_extract_enabled`
  default KAPALI; model `identity_extract_model` (min-max: gpt-5-mini
  hedefi, benchmark onaysız canlıya alınmaz); base_url boşsa
  openai_base_url devralır (AB-residency; Çin ucuna kimlik verisi ASLA).
  Maliyet `AIUsageLog`'a (product_id=None) yazılır.
- **Frontend motor seçimi:** taramada önce yerel regex zinciri (SİLİNMEZ,
  fallback); VLM flag'i açıksa arka planda çıkarım → VLM birincil +
  regex eksik-doldurucu birleşir; VLM hatası yerel sonucu EZMEZ, görünür
  "kontrol edin" uyarısı üretir. `plausibleCprSix` 6-hane kırpması yalnız
  regex dalında; VLM/barkod CPR'ı tam 10 hane taşır (R1-C doğrultusu).
- **Benchmark:** `backend/tests/ocr_benchmark.py` (pytest toplamaz;
  `--engine barcode|vlm`, canlı VLM yalnız `SERO_OCR_BENCH_LIVE=1` ile).
  Barkod kanalı sentetik roundtrip 20/20. PaddleOCR-VL gibi lokal modeller
  bu ölçüm hattına sonra eklenebilir (bkz. DPIA notu).
- **GDPR notu:** `docs/IDENTITY_VLM_DPIA_NOTE_TR.md` — görüntü saklanmaz,
  AB ucu + Art. 28 DPA, hvidvaskloven/kontantforbud bağlam notu, risk
  tablosu.

### Testler

- Backend: +65 test (CPR 27+backfill 4+uçlar; kimlik 29+uç 4, toplam 692
  passed). Frontend: +22 test (photoReorder + cprConflict + classifyCpr +
  identityScan VLM eşleme/motor seçimi); tsc/lint/i18n kapıları yeşil.

## [0.3.37] — 2026-09-08

### Piyasa oranları (WP) — tam otomatik + operatör kontrolü

- **WP Priser zamanlanmış otomatik çekim:** FastAPI lifespan içinde
  scheduler döngüsü başlatıldı (`MARKET_RATES_WP_AUTO_PULL_ENABLED`,
  varsayılan açık; `MARKET_RATES_WP_AUTO_PULL_MINUTES`, varsayılan 60,
  en az 15). Açılışta gereksiz ağ atışı yok (ilk tick'ten önce interval
  beklenir); çekim hatası loglanıp sessizce devam eder, AFG fiyatları
  asla sıfırlanmaz. Manuel "WP'den çek" butonu ile scheduler AYNI merge
  yolunu (`apply_wp_priser_rates`) kullanır.
- **"Otomatik çekmeyi durdur" onay kutusu:** GlobalMarketRatesDrawer'da
  işaretlendiğinde tamamen manuel moda geçer — uygulamadan hemen önce
  yeniden denetleme sayesinde bekleme penceresinde işaretlenen checkbox
  bile o turdaki otomatik çekimi iptal eder (manuel fiyatlar WP ile
  ezilmez). Ayarlar `.env`'e kalıcı yazılır, restart'ta korunur.
- **22k-2 (`22b`) asla otomatik güncellenmez:** WP'de bu satır hiç
  olmadığı için operatör değeridir; kaynak yanıtı bu anahtarı taşısa bile
  merge savunması profile yazmaz.
- **22K-2 satırı 22K'nın altında:** alış çalışma alanında extra satırlar
  (22K-2, kniv, çeyrek) grubun en sonuna değil, karat rütbesine göre
  taban satırın yanına düşer (`extraRowOrder.ts` — kararlı sıralama,
  '22b' → 22). "+ Satır ekle" suni 22K-2 satırı da 22K'nın altına
  yerleşir.
- **Çeküm saydamlığı:** drawer'da "Son WP çekimi" damgası + bayat
  "metals.dev/ECB" metni gerçek kaynakla (WordPress guldpriser/
  soelvpriser + Stooq) değiştirildi. WP'den gelen platin/paladyum değeri
  Stooq oto bayrağını bilinçli olarak kapatır (dükkân fiyatı kaynağı).

### Kimlik OCR — saha smoke'undan geçen üç düzeltme

- **Ehliyet Ad Soyad artık düşüyor:** tr/da OCR "1."/"2." numara
  ön eklerini yuttuğunda ("1. Demir" → "1 Demir") ayırıcı-toleranslı
  etiket eşleşmesi + tek satırda ad-soyad tamamlama + başlık bloğundan
  ("KØREKORT / Demir / 21 / Recai") kurtarma devrede. Müşteri formu
  varyantında OCR'ın boş bıraktığı alanlar ('') artık eski elle girişle
  üst üste binmez.
- **Yeniden taramada alan sıfırlama:** hatalı taramadan sonra yeni
  tarama önceki parse'ı tamamen sıfırlar — `applyConfirmedIdentityResult`
  OCR'a ait alanları (ad, adres, CPR, belge no/türü/ülkesi) mevcut
  değerden bağımsız olarak yazar; belge türü/kişi değişince karşı yüz
  temizlenir. "Üst üste biniyor, komple bozuluyor" bitti.
- **Sarı kart çıktı vermeye başladı:** WIA taraması item properties
  6146/6147 ile 300 DPI'ya çekiliyor (önceki ~125 DPI → 419×288 görüntü,
  parser hiçbir çapa bulamıyordu); `identity_ocr.ps1` büyütme eşiği
  adaptif ≤4× / 1600px hedefe çıkarıldı; düşük çözünürlüklü taramada
  panel rehber mesajı gösterir. OCR kod/yorum/fixture'larındaki gerçek
  kart değerleri tamamen sentetiğe çevrildi (CPR dahil).

### Alış geçmişi — 500 ve "sorunlu belgeler"

- **Müşteri geçmişi endpoint 500'ü:** `PosDocumentListItemOut` şeması
  zorunlu `vat_rate_percent` alanı olmadan kuruluyordu — en az bir bağlı
  belgesi olan müşteride GET /customers/{id}/history 500 atıyordu (boş
  müşteride `[]` döndüğü için smoke'ta görünmüyordu).
- **Oturum-bağlı belgeler listeye giriyor:** document_count UNION ile
  hem işlem-bağlı hem oturum-bağlı (içe aktarılan) belgeleri sayar;
  listede görünmeyen "sorunlu belgeler" artık geçmişte görünür.
- **UI hata dalları:** CustomerWorkspacePanel üç sorguda da hata bandı +
  "Tekrar dene" + "!" sayaçları + boş-durum metinleri; sessiz "Belgeler
  0" yanılsaması bitti.

### WooCommerce yayını — şablona sadakat + AI fotoğraf onayı

- **Fotoğrafsız AI üretimi onaya bağlandı:** ürün fotoğrafı yoksa
  (veya AI hiç fotoğraf analiz etmediyse `images_analyzed` uyarısı)
  üretim öncesi "emin misiniz?" onay diyaloğu açılır; AI yalnız
  özelliklerden üretim yapacağını bildirir.
- **Site alan denetimi:** canlı Woo ürün sayfalarından tür-bazlı spec
  şeridi + SEO slot haritası çıkarıldı → `docs/WOO_SITE_FIELD_AUDIT.md`
  (kolye → Længde/Bredde vb. eşleme, AI alan uyduramaz).

### Test altyapısı

- Yeni süitler: WP auto-pull scheduler (11), müşteri geçmişi endpointi
  (5), CustomerWorkspacePanel hata dalları (5), ai-describe fotoğraf
  onayı, extraRowOrder sıralaması (7). AFG render testi yerel `.env`
  override'larından bağımsız hale getirildi (hermetik footer ayarı).

## [0.3.36] — 2026-09-08

### Düzeltildi (Excel'de aç — saha raporu: hiçbir şey olmuyor)

- **Paylaşılan `onOpenExcel` akışında saha teşhisi + kendini onarma:** tüm
  "Excel'de aç" yüzeyleri (alış çalışma alanı, AFG belgeleri, depolama, log,
  office dock) tek ortak yolu kullanıyor ve başarısızlık yalnız 10px'lik
  bantta yaşadığı için saha "hiçbir şey olmuyor" raporluyordu. Üç katman:
  (1) her başarısız çıkışta aşama kodlu `writeUiDiagnostic` kaydı
  (`excel-open:conflict`, `excel-open:bridge-failed`,
  `excel-open:working-copy:<status>`, `excel-open:tauri-missing`) —
  müşteri makinesindeki `ui-diagnostics.jsonl` tek satırı hangi aşamanın
  düştüğünü kesin söyler; (2) 409 dışındaki başarısızlıklar artık toast ile
  de görünür; (3) Rust açılış penceresinden (1.2 sn) sonra köprü süreci
  ölürse yoklama bunu görüp backend oturumunu DELETE ile serbest bırakır —
  eski davranışta oturum TTL'e (1 saat) kadar açık kalıyor ve her yüzey
  409 çakışmasıyla kilitleniyordu. Temiz kopyada slot anında açılır,
  kirli kopyada sonraki açma bilinçli olarak 409 + kurtarma bandı üretir.

### Düzeltildi (kimlik OCR — gerçek saha kartı değerlendirmesi)

- **Gerçek kart fotoğrafıyla parser değerlendirmesi:** müşterinin kendi
  sundhedskort + kørekort fotoğrafı (Google Drive'dan, repo dışında)
  VDS-üzeri OCR ile incelendi; gözlemlenen satır desenleri sentetik
  fixture'larla modele edildi (gerçek veri repoya girmez). Dört
  sağlamlaştırma: (S1) læge bloğu artık hasta bloğunu gölgelamiyor —
  posta çıpası CPR'nin altındaki bloğu seçiyor; (S2) tek/iki harflik OCR
  döküntüsü ad/sokak penceresini kırmıyor; (S3) posta satırına taşan
  etiket artığı şehiri kirletmiyor; (L1) kørekort 4d etiketi bozuk
  okunduğunda CPR gövdedeki 6+4 düzeninden kurtarılıyor. En iyi saha
  varyantında sundhedskort 2/6 → 6/6 alan.
- **Danca fixture kaydı artık CI'dan geliyor (D1+D2):** GitHub
  windows-latest runner'ında da-DK OCR capability kurulumu ve üretim
  harness'ı çalıştırılarak `raw_ocr_da.json` üretildi (run 34173433109).
  Eski `raw_ocr.json` → `raw_ocr_tr.json` oldu; sözleşme testi iki kayıtla
  koşar (da = üretim motoru ana sözleşme, tr = regresyon gövdesi).
  Harness'a cp1252 dersi gömüldü: BOM'suz .ps1'de string literal'ler ASCII
  kalmalı, aksi halde çift-kodlanmojibake üretir (OCR satırları
  etkilenmez — runtime WinRT'den gelir; regresyon testi eklendi).

### Güvenlik (sertleştirme)

- **runtime.env DACL'ı yazım noktasında geri uygulanıyor:** `os.replace`
  dosyayı yeniden yarattığı için açık Windows DACL'ı her açılışta
  sıfırlanıyordu (0.3.34'te kontrol config dizinine taşınmıştı). Python
  tarafı artık yazım sonrası kurulum/Rust ile birebir aynı kısıtlı icacls
  grant'ını (SYSTEM + Administrators + etkileşimli kullanıcı) best-effort
  yeniden uyguluyor; icacls yoksa başlatma çökmez, Rust tarafı yine
  fail-closed doğrular.

### Operasyon

- **wp-bridge canlıya alındı:** seroguld.dk'daki `seroguld-crm-bridge`
  eklentisi aktif (repo kopyasıyla md5 birebir), `seroguld_crm_bridge_secret`
  option'ı ile CRM seed secret'ı hash ile doğrulanarak eşleştirildi,
  `SEROGULD_CUSTOMER_RUNTIME_ENV_B64` GitHub secret'ına köprü anahtarları
  eklendi. §11.2 canlı smoke kanıtlandı: 200 + `{"sent":true}` (e-posta log
  result=1), 401 `seroguld_bridge_forbidden`, 413 `seroguld_bridge_too_large`,
  429 `seroguld_bridge_rate_limited`. Not: düz `http://` isteği Simply
  kenarında 301 ile https'e yönleniyor — eklentinin 403 katmanı ikinci
  savunma hattı olarak kalıyor.

## [0.3.35] — 2026-09-08

### Düzeltildi (kimlik OCR)

- **İsim çıkarımı kök neden paketi:** 30 commit'e rağmen kimlik OCR isimleri
  çıkarmıyordu; 6 kök neden üst katmanlarda bulundu ve kapatıldı: (B2) etiket
  regex'leri iki nokta/aynı-satır değerini tanımıyor, (B3) `Adresse` gibi
  etiket kelimeleri isim alanına dolabiliyordu, (B1) sundhedskort yolu
  diğer alanlar dolunca isme bakmadan erken dönüş yapıyordu (0.3.30 saha
  imzası: diğer alanlar dolu, isim boş), (B4) harf-aralıklı dikey başlıklı
  kartlar ve sygesikring kartları `unknown` düşüyordu, (B5) kørekort'ta tek
  isim alanı eksikken blok tamamlaması yoktu, (B6) 300 dpi tarama büyütme
  eşiğini (1000→1400 px) aşıyordu.
- Merge yönü yasası: blok sezgisi adayı etiketli değerleri ASLA ezmez;
  bozuk tek-kelime etiketler (ör. tr-OCR "Athesse") 2 düzenleme mesafesi
  karılamasıyla atlanır.

### Eklendi

- **OCR dil yoklaması tri-state:** `danishAvailable: Option<bool>` + probe
  durumu + DISM capability state; probe başarısızlığı artık sessiz
  "paket var" varsaymıyor. UI'da iki ayrı uyarı: paket yok → kurulum mesajı;
  probe doğrulanamadı → log yoluyla birlikte "doğrulanamadı" mesajı (yalnız
  Windows'ta; eski çift kilit kaldırıldı).
- **Kopyalanabilir teşhis kodu:** tarama sonrası panelde atomik `idscan.…`
  kodu (PII içermmez) monospace olarak gösterilir — destek kaydına eklenir.
- Docs: runbook'a da-DK OCR paketi online/çevrimdışı kurulumu + teşhis
  rehberi; HANDOVER'a Kimlik OCR bölümü (mimari, kök nedenler, bekleyen
  saha işleri); yeni `docs/PRINTER_TEST_MATRIX_TR.md`.

### Düzeltildi (yazıcı hazırlığı)

- POS fişi ve alış çalışma alanı print HTML'ine `@page A4/14mm` + satır
  bölme kuralları (`tr` bölünmez, `thead` tekrar eder) — AFG resmi PDF hattı
  bilinçli olarak değiştirilmedi.
- Workspace print `auto_print` query param'ına bağlandı (hardcoded true
  kaldırıldı): Tauri'de inline script gömülmez (CSP ile zaten engelli),
  tarayıcı modunda `?auto_print=true` opt-in ile tek diyalog açılır.

### Altyapı

- **CI release hattı yeşile çekildi (`windows-desktop-release.yml`):** tag tetiklemeli hat artık temiz GH runner'ında build → imza/hash doğrulama → Defender gerçek zamanlı istisnaları → installer cleanup provası → sessiz kurulum (900 sn bütçe + çıkarma ilerleme probu) → kurulu uygulamada kabul testi → artifact upload → GitHub release yayını (setup.exe, .sha256, .sig, latest.json, release-manifest.json) zincirini uçtan uca koşturuyor; ilk yeşil koşu 2026-09-07. Ayrıntı: `docs/WINDOWS_RELEASE_RUNBOOK_TR.md` §12.
- **Installer cleanup Docker stderr toleransı:** PS 5.1'de script-bazlı `ErrorActionPreference=Stop` altında docker.exe'nin rutin "No such container" stderr'ı terminating NativeCommandError'a dönüşüp temizliği öldürüyordu; `Remove-SeroGuldDockerResources` artık fonksiyon-lokal `Continue` ile çalışır. Docker kurulu müşteri makinelerinde kalıntılar zaten temizken kurulumun düşmesi kapatıldı (yerel dockerless build makinesinde görünmeyen gerçek ürün hatası).
- **Sessiz kurulumda fail-fast:** installer cleanup hatası `/S` kurulumunda MessageBox'a bakmaz — headless/uzaktan kurulumlar görünmez dialog'da asılı kalmak yerine cleanup çıkış koduyla hızla düşer; interaktif kurulumda davranış değişmedi.
- **Cleanup teşhis logu:** her terminating temizlik hatası `CLEANUP-FAIL` (ve kaynak konumu `CLEANUP-FAIL-AT`) olarak `%ProgramData%\SeroGuldCRM\logs\installer-cleanup.log`'a yazılır; runtime ACL uygulaması da `userSid` ile loglanır.
- **Kabul testinde ACL sınırı düzeltildi:** `runtime.env` koruma kontrolü dosyanın kendi protected-DACL bayrağından (uygulama her açılışta tmp+os.replace ile dosyayı yeniden yarattığı için sıfırlanır) kilitli config **dizinine** taşındı; kontrol CI'da adım-hesabı SID'ini de kabul eder, hatalar tam metinle raporlanır.

Bu kalemler bir sonraki installer build'iyle müşteriye ulaşır (teslim edilmiş 0.3.34 installer'ında yoktur).

## [0.3.34] — 2026-09-07

### Güvenlik

- **Belge renderer'larında stored-XSS kaçışı:** POS fişi ve AFG belgesi renderer'larında müşteri kaynaklı TÜM serbest metin (navn/adresse/tlf/e-mail/kørekort/belge no) HTML kaçışlı gömülür — '<img onerror=…>' içeren müşteri adı artık e-posta eki/önizleme HTML'inde etiket olarak parse edilemez; reportlab Paragraph'ı da '<' içeren adda düşmez.
- **Şifre değişimi tüm eski oturumları düşürür:** parola değişiminde mevcut refresh token'ları geçersiz kılınır (çalıntı token ile yeniden giriş kapısı).
- **Kimlik doğrulama sertleştirmesi:** parola politikası, giriş rate-limit, env değer kodlaması ve yedek hata eşlemesi medium bulguları kapatıldı; `/settings` ucu admin-guard'lı, env yazımı parse-gate'ten geçer, yükleme hatası maskelenmez.
- **POS PII ve token kapsamı:** plaintext PII kalıcı yüzeyden düşürüldü; müşteri ekranı token kapsamı daraltıldı; kur oranı kaynağı yarış koşulu kapatıldı.

### Düzeltildi

- **Alış:** filtre durumları şeffaf, yeniden bağlama (relink) ve çift-gönderim koruması düzeltildi; market oranı editörü ve belge ülke alanı medium bulguları kapatıldı; hata yüzeyleri ve iptal onayı eklendi; AFG finalize e-posta akışı event loop'u bloklamaz.
- **Müşteriler:** modülün 8 yüksek öncelikli hatası + taslak korunumu, canlı mükerrer kayıt kontrolü, OCR alan paritesi ve maskeli liste düzeni; GDPR durum makinesi, SLA görünürlüğü, rıza kanıtı, pseudonymize kurtarılabilirliği, public uç abuse guard'ları ve ön onay diyaloğu düzeltildi.
- **Stok/Depolama:** manuel fiyat profili, projeksiyon senkronu, terminal guard, dirty guard, alıcı seçici, filtre debounce'u ve durum rozetleri; Woo tarafında hata sanitizasyonu, sayfalama sınırı ve arama debounce'u.
- **OPMC/Market/Log/Rapor:** OPMC önbelleği LRU+single-flight, skor override denetimi, 'none' sipariş görünürlüğü; market canlı zincir paraleli, tek-uçuş kilidi, WP hata sınıflandırması, pletsølv bandı; log artifact senkron disiplini, Log Excel import UI, lot taslak tazeliği ve atomik apply zincirleri; rapor popülasyonu, dönem semantiği ve export yüzeyi.
- **POS belge akışı:** confirm_session atomik ve yarış-güvenli; müşteri ekranı önizleme matematiği backend paritesine alındı, extra satırlar görünür, snapshot hafifledi; klasik pano API hatası artık yutulmaz; ayarlarda üç durumlu entegrasyon rozeti ve yedek paneli dürüstleştirildi.
- Excel apply zinciri sıkılaştırma ve embedded workbook durumları; display kapanış sahnesi ve sessiz except logları; dashboard/log ekran erişim hataları.

### Eklendi

- i18n katalog dalgaları (M1–M3 + gdpr public sayfalar): ayarlar, müşteriler, stok, rapor, OPMC ve kurtarma paneli yüzey metinleri kataloğa alındı.
- Test kapsamı büyüdü: backend 398 → 590 (+192), frontend 596 test.

### Altyapı

- Release hattı (diğer makine serisi): kaynak fingerprint'ten tauri gen/schemas artık hariç (yanlış kapı düşüşleri kalktı); git provenance çağrısında PS5.1 stderr yerel hatası giderildi; runtime build'e açık Python yorumlayıcısı pinlendi; installer smoke satır sonu agnostik doğrulamaya geçti; `data/archive/` gitignore'a alındı (müşteri verisi public-repo bariyeri).

## [0.3.33] — 2026-09-04

### Eklendi

- **Kimlik tarayıcı klasör izleme:** Windows notify tabanlı izleme komutları eklendi — tarayıcının bıraktığı klasör yeni görüntü aldığında tarama otomatik tetiklenir; tarayıcı hata kodları arayüzde ayrışık gösterilir ve teşhis kodu yazılır. Epson network WIA kurulumu için DK+TR runbook (`docs/`) eklendi.
- **WP Priser kapsamı genişledi:** çekim artık bar, platin, palladium ve plet satırlarını da okuyor; plet fiyatı 4 haneye taşındı, bar fiyatı için 24k fallback kaldırıldı (gerçek bar satırı yoksa fiyat yazılmaz). WP kaynaklı platin/palladium otomatik akışı kapatıldı — skaler ayarlar uygulanır. Dashboard ve envanter güncel oranları etkin market profilinden okur.
- **Ayarlarda AFG e-posta köprüsü alanları** (DB destekli) eklendi.

### Düzeltildi

- **Alış finalize sağlamlaştırıldı:** matris dışı kalan satırlar finalize'da korunur ve uyarı döner (sessiz kayıp yok); API 422 doğrulama listeleri okunur Türkçe mesaja çevrilir; alış finalize Uniconta senkronu kapsam dışına alındı.
- **Woo saflık normalizasyonu:** metal purity g.999'e clamp'lenir; platin/palladium saflık çarpanı düzeltildi.
- **AI medya yolu:** POSIX mutlak yol `exists` denetimi — bulunmayan yol artık `None` döner (Windows yol denetimi yanlış pozitifi kalktı).
- **Fiyat kaynağı düşüşleri loglanır** (sessiz eski değere dönüş yok); Office keşfi httpx koruması ile çökmez.
- **AFG boş-satır görünümü iki makine serisi birleştirildi:** her iki yüzeyde de grid satırları boşken görünür; PDF 15 sabit slotu renkli bantlarıyla basar (0.3.32 şablon paritesi), Excel tarafında eski gizleme davranışı `hide_blank_rows` bayrağıyla geriye uyumluluk için korunur. Rebase çözümünde düşen 0.3.32 temizlikleri (Reg.nr./Kontonr. boş bırakma, Not alanına 'None' sızmaması) geri taşındı ve teste mühürlendi.
- i18n kataloğuna opmc/ocr ve WP Priser çekme düğmesi anahtarları (33+) eklendi; CI Playwright smoke spec'leri modern arayüzle hizalandı.

### Altyapı

- İki makine serisi tek geçişte birleştirildi (rebase); `frontend`/`desktop` package-lock sürümleri paket sürümleriyle senkronlandı; git fetch refspec tüm branch'lere açıldı (diğer makine push'ları artık görünür).

## [0.3.32] — 2026-09-02

### Düzeltildi

- **Afregningsbilag artık orijinal şablon gibi (saha karşılaştırması üzerine):** CRM çıktısı yalnız dolu grid satırlarını gösteriyordu (1 Eylül'deki boş-satır gizleme kararı); mağazanın gerçek Prisberegneren şablonu ise tüm slot satırlarını renkli bantlarıyla boş halde bile basılı tutuyor. Excel çıktısı ve müşteri PDF'i artık şablon ızgarasıyla aynı: 7 turuncu guld karat slotu, Guldbarre/ayraç bandı ve gri sølv slotları boşken de görünür (PDF'te 15 slotun tamamı çizilir; tek sayfa garantisi korunur). Eski, gizli satırlı dosyaların yeniden üretiminde gizleme bayrakları temizlenir. Küçük temizlik: Reg.nr./Kontonr. artık boş bırakılıyor ('—' yerleşimi kaldırıldı), Not alanına geçmiş üretimden sızabilen 'None' metni yazılmıyor.

## [0.3.31] — 2026-09-02

### Düzeltildi

- **Yeni müşteri formunda her tuş vuruşunda imlecin kaçması:** ModernDrawer/ModernDialog'un odak tuzağı her render'da yeniden kuruluyordu — `onClose` çağrı yerinde her render'da yeni fonksiyon olduğu için forma her yazılan karakterde odak önce panel arkasına, sonra paneldeki ilk elemana atıyordu. Artık tuzak yalnız panel açılıp kapanırken kuruluyor; yazma sırasında odak alanda kalıyor.
- **Sundhedskortta Ad Soyad boş kalması (0.3.30 saha teshisiyle sınandı):** Danca OCR 9 satır okuyor, adres/posta kodu/şehir/CPR doluyordu ama isim düşüyordu. Üç gerçek düzen saptandı: ad ile c/o+sokak satırı arasına giren CPR satırı (eski kod yalnız posta bloğunun tam iki üstüne bakıyordu), ad satırının kenarında kalan madde imi/etiket kalıntısı ve "Soyad, Ad" virgüllü basım. Blok sezgisi artık 3 satır pencereyle yukarı tarıyor, kenar gürültüsünü kırpıyor, virgüllü düzeni düzeltiyor; ad hiç okunmazsa başlık kelimesinin ("Sundhedskort") isim olarak sızması da kapatıldı.

## [0.3.30] — 2026-09-02

### Eklendi

- **Kimlik OCR saha teşhisi (0.3.29 saha bildirimi üzerine):** 0.3.29'da bir taramada Ad Soyad yine boş kaldı; yerel çoğaltmada aynı fotoğraf (da motoru, 12 satır) parser'da isim dahil 5 alan üretiyor ve kurulu paketin kodu doğrulandı. Açıklanamayan durum, uygulama içi gözlemlenebilir teşhis olmadan kapatılamaz: her tarama artık (1) inceleme panelinde maskeli OCR teşhis satırı gösteriyor (OCR dili, satır sayısı, ölçek bilgisi, isim okunmadıysa "İSİM OKUNAMADI" uyarısı ve açılır maskeli ham satırlar — rakamlar 9'a harfler a'ya maskeli, ekran dışı kopya yok) ve (2) kişisel veri içermeyen atomik özeti (yüz, dil, satır sayısı, dolu alan harfleri — ör. `idscan.front.da-DK.12L.5F.S.NCDTU`) `ui-diagnostics.jsonl`'e yazıyor. Bir sonraki saha bildiriminde panel ekran görüntüsü OCR'ın ne okuduğunu ve parser'ın neyi kaçırdığını tek bakışta gösterecek.

## [0.3.29] — 2026-09-02

### Düzeltildi

- **Kimlik OCR — kørekort isim ve belge no dolumu:** Türkçe OCR motoru "1."/"2." numara öneklerini yuttuğunda ad-soyad hiç doldurulmuyordu; başlık bloğundan (etiketsiz ilk iki basılı isim satırı) ad okuma yedeği eklendi, sayı/gürültü satırları elenir. `4d.` öneki bozuk okunduğunda (`48.` vb.) CPR'nin kurtarılması için `4[db8]` toleransı eklendi. Danca motorda `5.` etiketi `-5. . ` önek gürültüsüyle düştüğünde belge no kaybolmasın diye satır içi bağımsız 8-9 haneli sayı taraması eklendi (tarih/CPR desenleri 8-9 bitişik hane üretmediğinden yanlış pozitif yok). Gerçek saha fotoğrafı satırlarıyla (tr + da motor kayıtları) regresyon testleri eklendi.
- **Kimlik OCR — danskart biçim denetimi (27 senaryoluk denetimle bulundu):** (1) Başlığın Ø→OE translitre okunduğu varyant (`KOEREKORT`) belgeyi `unknown`'a düşürüp tüm alanları kaybettiriyordu — başlık tetikleyicilerine `E?` toleransı eklendi. (2) Etiketli ve etiketsiz sundhedskortta `c/o` satırı gerçek sokağı yutuyordu — c/o satırları adrese birleştirilir (`c/o Jens Jensen, Testgade 1`). (3) EHIC/kart no gibi 10 haneli yabancı sayılar ve makul olmayan tarih bölümü (`999999-9999`) CPR sanılıp kalıcı yüzeye taşınıyordu — tüm CPR yollarına DDMMYY makuliyet kapısı + "Kort nr." satır eleme. (4) Çoklu taramada (ön+arka yüz) arka yüzün MRZ transliterasyon adı ön yüzün basılı adını eziyordu — birleşim artık yüz bazlı: ön yüz kanonik, arka yüz yalnız eksik anahtarları doldurur; aynı yüzün yeniden taraması o yüzün sonucunu günceller.
- **Updater artifact onarımı (release hattı):** 0.3.26'dan bu yana üretilen `latest.json` bozuktu — Authenticode bu makinede koşmadığı için release betiği `.run` altında eski build'den kalan **bayat .sig artığını** (0.3.26 imzası) "taze" sanıp okuyor ve `Get-Content`'in PowerShell ETS notları (`PSPath`/`PSChildName`) JSON'a sızarak `signature`'ı string yerine obje yapıyordu. Bu hâlde yayımlanan bir release'te mevcut kurulumlar güncellemeyi doğrulayamazdı. Artık kod imzası yoksa tauri'nin taze bundle imzası her zaman üzerine kopyalanır, imza ham string okunur ve imza gövdesindeki ürün sürümü doğrulanır (sürüm eşleşmezse release düşer). Teslim edilen SETUP.exe'ler etkilenmedi; GitHub release yayımlanmadan önce düzeltme zorunluydu.
- OCR rakam karışmalarının (3↔5) asıl kaynağı parser değil eksik dil paketiydi: makinede Danca paketi yokken Windows OCR Türkçe motorla okuyordu. Geliştirme makinesine `Language.OCR~~~da-DK` yeteneği kuruldu; üretim motoru seçimi zaten da-DK'yı öncelikliyor (kurulu müşteri makinelerinde değişiklik gerekmez).

## [0.3.28] — 2026-09-02

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
