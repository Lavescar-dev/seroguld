# Sero Guld CRM 0.3.5 Müşteri Kabul Çalışma Planı

> Oluşturulma: 2026-08-13  
> Durum: Uygulama aşamasında  
> Kaynak: 13 Ağustos müşteri toplantısında gözlenen gerçek masaüstü akışları

Bu belge açık maddelerin sohbet içinde kaybolmaması için tek takip kaynağıdır. Her
madde ancak kaynak kodu, regresyon testi ve mümkünse paketli masaüstü smoke testi
birlikte geçtiğinde tamamlanmış sayılır.

## P0 — Veri bütünlüğü ve bloke eden hatalar

- [ ] **Depolama ürün oluşturma atomikliği:** `document_artifacts.updated_at`
  alanına yanlışlıkla metin gönderilmesi düzeltilir. Ürün + envanter workbook
  artefaktı tek veritabanı işlemi olarak tamamlanır; başarısız isteğin ürünü
  veritabanında bırakıp tekrar denemede çoğaltmasına izin verilmez.
- [ ] **Depoda görünmeyen kayıtlar:** Sol menü sayacı ile liste aynı veri kümesini
  kullanır. Aktif filtre yüzünden tüm kayıtlar gizleniyorsa filtre görünür biçimde
  sıfırlanabilir ve boş ekran nedenini açıklar.
- [ ] **Eski AFG importu:** Etiket hücreleri C/F, değer hücreleri D/G olan eski
  şablon algılanır. Satırlar hücre numarasından değil tür/ayar imzasından okunur.
  Kaynak belge numarası ve tamamlanmış tarihsel net/KDV/genel toplam korunur;
  tarihsel kayıt güncel fiyatlarla yeniden değerlenmez ve aynı dosya iki kez
  içe aktarılamaz.
- [ ] **Excel'de aç:** Gerçek Excel tespiti, çalışma kopyası ve bridge başlatma
  hataları kullanıcıya anlaşılır gösterilir; `.xlsm` VBA içeriği korunur.

## P1 — Müşteri, OCR ve alış deneyimi

- [ ] **Müşteri seçimi:** `Seç` kişiyi alış ekranına götürmez. Aynı müşteri
  ekranında sağ tarafta kişinin özeti, iletişim bilgileri, belgeleri, alış geçmişi
  ve toplamları açılır. Alış başlatmak ayrı ve açık bir eylemdir.
- [ ] **Müşteri metal özeti:** Altın, gümüş, platin, paladyum, bıçak ve hesaplayıcı
  kalemleri gösterilir. `Altın · Guld` / `Sølv · Sølv` gibi yinelenen adlar tek bir
  kullanıcı dostu ada indirilir; ham enum/kodlar doğrudan gösterilmez.
- [ ] **OCR gerçek fixture testi:** Mevcut test kimlik görselleri gerçek OCR
  hattından geçirilir. Ad, soyad, doğum tarihi, belge numarası, adres, posta kodu,
  şehir, telefon ve e-posta desteklendiği ölçüde doğru form alanlarına yazılır.
  Eksik/güvensiz değer sessizce uydurulmaz; confidence ve manuel düzeltme görünür.
- [ ] **Yeni alışta KDV yok:** Yeni müşteri alışlarında KDV seçeneği ve hesabı
  tamamen kaldırılır; net = ödenecek. Eski tamamlanmış KDV'li belgeler yalnız
  tarihsel kanıt olarak aynı tutarlarla korunur.
- [ ] **Piyasa fiyatı:** Manuel 24K oranı, altın saflık fiyatları ve alış birim
  fiyatı aynı kaynaktan ve doğru birimden üretilir. `382` girildiğinde eski `2850`
  değerinin kalması gibi snapshot/cache sapmaları engellenir.

## P1 — Workbook görünümü ve alan sözleşmesi

- [ ] Gold bar ve silver bar satırları eklenir; gümüş türleri `Finsølv 999`,
  `Sterling sølv 925`, `3 tårnet sølv 830`, `Plet` ve bar satırıyla açık eşlenir.
- [ ] Bıçak hesaplayıcı ve ikinci ağırlık/adet/toplam hesaplayıcı alış UI'sında ve
  workbook'ta aynı değerlerle bulunur.
- [ ] Müşteri alanları etiketin sağındaki hücreye yazılır. Adres yalnız sokak
  adresidir; `posta kodu şehir` birlikte doğru satırda yer alır. CPR'de yalnız
  doğum tarihi kısmı gösterilir/saklanır; gereksiz son haneler workbook'a yazılmaz.
- [ ] Yanlış yerde kalan yıldız/işaretler temizlenir ve gerekli sütuna taşınır.
- [ ] Belge alt bilgisi güncellenir; `Sero Guld` kalın, adres/posta/şehir/ülke,
  CVR, telefon, e-posta ve web bilgileri güncel şirket ayarlarından üretilir.

## P1 — WooCommerce fotoğraf deneyimi

- [ ] Fotoğraf alanı tıklayarak seçmenin yanında drag-and-drop kabul eder.
- [ ] Desteklenen dosya türü/boyutu istemci ve sunucuda aynı doğrulanır.
- [ ] Sürükleme vurgusu, yükleme durumu, hata mesajı ve başarılı yükleme sonrası
  galeri yenilemesi test edilir.

## P2 — Önceden bildirilen regresyonların kapanışı

- [ ] Dashboard `/api/v2/dashboard/overview` ve piyasa onay endpointleri paketli
  runtime'da bulunur; kaynak/runtime sürüm uyuşmazlığında yalnız `Not Found`
  göstermek yerine tanı bilgisi verilir.
- [ ] Manuel piyasa modu gerçekten düzenlenebilir ve Kaydet backend'e yazar;
  canlı mod yalnız açıkken alanları kilitler.
- [ ] Ayarlar → Hesap ve güvenlik içindeki parola değiştirme akışı aynı modern UI
  içinde çalışır.
- [ ] Woo katalog önizleme/uygulama 466 ürün gibi çok sayfalı kataloglarda kilitli
  kalmaz; uygulama sonrası kayıtlar görünür.
- [ ] Uniconta satırlarında tarih ve işaretli fiyat doğrudan görünür; gelir/gider
  rengi doğrudur.

## Doğrulama ve teslim kapıları

- [ ] İlgili backend pytest testleri ve tam backend gate geçer.
- [ ] Frontend typecheck ve tam Vitest paketi geçer.
- [ ] Alembic tek head ve temiz/kısmi-eski şema yükseltme testleri geçer.
- [ ] Desktop fingerprint doğrulanır; test edilen ekranın yeni kaynakla aynı runtime
  olduğu kanıtlanır.
- [ ] Temiz Windows kurulumunda Python, Docker, WSL, Node veya Rust gerekmez.
- [ ] Installer zlib/Deflate, UPX yok, Defender 0 tehdit, SG icon ve sidecar hash
  kontrolleri geçer.
- [ ] Veri koruma smoke testi: mevcut DB/belge/hashler kurulum öncesi/sonrası aynı,
  yalnız beklenen migration değişiklikleri oluşur.
- [ ] Commit ve push tamamlanır; sürüm notu ve `WINDOWS_RELEASE_RUNBOOK_TR.md`
  sonraki üretimin tek komutla tekrarlanabileceği şekilde güncellenir.
- [ ] Doğrulanmış installer, SHA-256 ve release manifesti Downloads'a atomik olarak
  alınır; önceki installer arşive taşınır.

## Uygulama sırası

1. Depolama 500/çoğaltma + görünürlük.
2. Müşteri seçim/özet/metal etiketleri.
3. OCR gerçek fixture sözleşmesi.
4. Woo drag-and-drop.
5. AFG/Excel şablon profilleri ve Excel bridge.
6. Yeni alış sıfır-KDV ve fiyat snapshot doğrulaması.
7. Tam test, desktop smoke, commit/push ve installer.
