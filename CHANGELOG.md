# Changelog

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
