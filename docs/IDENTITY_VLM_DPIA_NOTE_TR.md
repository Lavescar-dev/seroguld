# Kimlik OCR (R1-B) — GDPR/DPIA Teknik Notu

Kapsam: 0.3.38 ile gelen üç katmanlı kimlik çıkarımı — Tier 0 barkod
(zxing-cpp, offline), Tier 1 doğrulama (lokal, saf Python), Tier 2 vision-LLM
(flag'li, opt-in). Bu not teknik ekip ve veri sorumlusu içindir; hukuki
danışmanlık değildir.

## Veri akışı ve minimizasyon

```
Tarama/fotoğraf (Windows istemci)
  → bellek içi görüntü (diske YAZILMAZ)
  → Tier 0 barkod decode (lokal, ağ YOK)
  → Tier 1 alan doğrulama (lokal)
  → [yalnız identity_extract_enabled=true VE yerel katman kalite tetiği
     üretirse (0.3.42): boş çekirdek alan / düşük güven / kart-bulunamadı
     -parlama / gecikme aşımı] Tier 2 VLM isteği (görüntü data URL)
  → IdentityParseResult → operatör onayı → müşteri kaydı
  → görüntü bellekten atılır (saklanmaz)
```

- Görüntü **asla diske yazılmaz**, log'a girmez, veritabanına kaydedilmez.
  Backend `_decode_image_bytes` yalnız bellekte base64 çözer; ai_usage_log
  tabanına yalnız model/token/maliyet yazılır (`product_id=None`).
- Frontend teşhis günlüğü (ui-diagnostics.jsonl) maskeli satır önizlemesi
  taşır (rakamlar→9, harfler→a); ham OCR metni kalıcı yüzeye girmez.
- Form yuzeyi kuralı: kalıcı müşteri kaydına CPR **yalnız ilk 6 hane** ile de
  girilebilir (doğum-bölümü hash'i `cpr_birth_hash`); tam 10 hane AES-GCM ile
  şifreli saklanır, arayüzde maskelenir (??????1234).

## İşlem temeli ve amaç (Art. 5/6)

Amaç: müşteri kimlik ve adres bilgisinin **sahada doğru ve hızlı** kaydı
(veri minimizasyonuna ters düşen elle yeniden yazım hatalarını azaltma).
Yasal temel mevcut kayıt akışıyla aynıdır; OCR/VLM bu akışın bir aracıdır,
yeni bir amaç eklenmez.

## Hukuki çerçeve notları (Danimarka kuyumcu bağlamı)

- **Hvidvaskloven (kara para aklama) doğrudan kapsamaz**: kuyumcu sektörü
  yalnız nakit ≥ 50.000 DKK tekil işlemlerde hvidvaskloven mükelleftir.
  Bununla birlikte kimlik/adres kaydı tutma pratiği ticari gerekçelerle
  (garanti, iade, sigorta) meşrudur.
- **Kontantforbud (§ 5, 2020)**: işletmeler 15.000 DKK üzeri nakit ödemeyi
  kabul edemez — kimlik kaydı gerektiren senaryoları azaltan bir üst sınırdır.
- **Tam CPR saklama gerekçesi** belgelenmelidir: sistemde tam CPR yalnız
  şifreli saklanır ve doğum-bölümü hash'i ile arama/minimizasyon tercih edilir.
  Gerekçe ortadan kalkarsa (müşteri silme) `cpr_number_encrypted` ve türev
  hash'ler birlikte silinir.

## Sağlayıcı ve veri yerleşimi (Art. 28)

- VLM katmanı **varsayılan KAPALIDIR** (`identity_extract_enabled=False`).
  Açık olduğu durumlarda istek, OpenAI-uyumlu uç noktaya gider:
  `identity_extract_base_url` boşsa `openai_base_url` devralınır. Bu proje
  **AB-residency uç noktasıyla** çalışacak şekilde yapılandırılmalıdır
  (OpenAI DPF kapsamı + Art. 28 DPA; sub-işlemci listesi kontrol edilmelidir).
- **Z.AI / Çin kaynaklı herhangi bir uca kimlik verisi ASLA gönderilmez.**
  Bu kural config düzeyinde değil, operasyon kuralıdır: base_url Z.AI uçlarını
  göstermeyecek şekilde tutulur ve benchmark canlı koşumları öncesi uç
  doğrulanır.
- Barkod ve doğrulama katmanları %100 lokaldir (ağ trafiği yok) — flag kapalı
  üretim modunda kimlik verisinin işlemciye giden bir bileşeni yoktur.

## Azure OpenAI (AB) kurulumu — 0.3.39 sonrası

Müşteri kiracısında açılan Azure OpenAI kaynağı VLM katmanının hedefidir
(uç: `https://<kaynak>.openai.azure.com/openai/v1`, Bearer uyumlu — taşıma
kodunda değişiklik yok). Zorunlu kurallar:

- **Deployment tipi EU Data Zone (veya Regional/Sweden) olmalı; Global
  YASAK** — Global deployment veriyi bölge dışında işleyebilir, AB
  veri yerleşimi ihlal edilir.
- **Anahtar ayrımı**: `IDENTITY_EXTRACT_API_KEY` kimlik katmanının KENDİ
  anahtarıdır; global `OPENAI_API_KEY` (genel sohbet/GLM ucu) kimlik
  görüntüsünü asla görmez (config kalıbı: `opmc_api_key` gibi per-feature).
  Anahtar yalnız `.env`'de yaşar (gitignore'lu), repoya asla girmez; sızı
  şüphesinde portaldan regenerate + tüm makinelerde değiştirme.
- Model: `gpt-4.1-mini` (0.3.42 tabanı, sentetik bench 43/65 = yerel taban
  parite, ~1 sn/tarama, ~$1/ay üretim). Yedek aday `llama-4-maverick` (44/65)
  ve `gpt-5-mini` (parite ama 18-32 sn). Kalite-tetikli minimizasyon
  (0.3.42): VLM isteği yalnız yerel katman tetik ürettiğinde atılır — tipik
  dükkân gününde taramaların çoğu yerel dolu ve temizdir, görüntü sağlayıcıya
  hiç gitmez; bu, veri minimizasyonun operasyonel ifadesidir.
- Canlı açma (`IDENTITY_EXTRACT_ENABLED=true`) yine benchmark kapısına
  bağlıdır; bu belge uç değişikliğini değil, işlemcinin kimliğini
  günceller: işlemci = Microsoft (Azure OpenAI, AB bölgesi), veri
  aktarımı AB içi, aktarılan veri = tarama anındaki görüntü (kalıcılık
  yok, istek yaşam döngüsüyle silinir).

## Retention

- Görüntü: istek yaşam döngüsüyle silinir (saniyeler; kalıcılık yok).
- AIUsageLog: maliyet/muhasabe kaydı — kimlik verisi taşımaz, genel log
  tutma politikasına tabidir.
- Müşteri kaydı: mevcut müşteri saklama politikası (silme talebinde GDPR
  pseudonymization servisi `cpr_birth_hash`/`cpr_is_partial` dahil anonimleştirir).

## Kalıntı riskler ve tedbirler

| Risk | Tedbir |
|---|---|
| VLM'in yanlış okuması sessizce kayda girer | `review=needs_review` ihtiyatlı varsayılan; düşük güven + checksum hatası → operatör onayı olmadan geçmez |
| Barkod okunamaz | VLM/zincir düşer; uyarı görünür ("kontrol edin") — sessiz kalite kaybı yok |
| Görüntünün üçüncü tarafa sızması | flag default kapalı + AB ucu + 8 MB sınırı + diske yazmama |
| Aşırı veri toplanması | yalnız form alanları çıkarılır; birth_date/expiry_date kalıcı müşteri alanına yazılmaz |

## Benchmark ve doğrulama

`backend/tests/ocr_benchmark.py` (pytest toplamaz): barkod kanalı offline
ölçülür (0.5 ms/görüntü, sentetik roundtrip 20/20); VLM kanalı yalnız
`SERO_OCR_BENCH_LIVE=1` ile canlı ölçülür ve model seçimi bu ölçümle
kesinleşir (ucuz model önceliği: gpt-5-mini). Gerçek kart görüntüsü/çıktısı
repoya girmez.
