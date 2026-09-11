# Kimlik OCR yerel motor — benchmark ve ROI ayar runbook'u (0.3.39)

Bu belge yerel PP-OCRv6 (RapidOCR) motorunun **ölçülmeden canlıya alınmaması** kuralının
uygulama adımlarını tanımlar. Arka plan ve mimari kararlar için plan notuna ve
`IDENTITY_SCANNER_RUNBOOK_DK_TR.md`'e bakınız.

## Altın kural

**Gerçek kart görüntüsü ve ham OCR çıktısı ASLA repoya girmez.** Fotoğraflar ve truth
dosyaları repodan bağımsız MUTLAK bir yolda durur (önerilen: `~/card-photos/`).
`ocr_benchmark.py --images` ve `--roi-dump` bu yüzden repoya yazmayı reddeder.
Belgeye işlenen skorlarda CPR yalnız ilk 6 haneyle maskelenir (`_mask_cpr` kuralı).

## Hazırlık

1. 5–10 gerçek kart fotoğrafı/taraması toplanır (sundhedskort + kørekort karışık; ideally
   parlama/açı varyasyonlarıyla). Her birinin yanına truth dosyası yazılır:

   ```json
   // ~/card-photos/kort-01.truth.json — DEĞERLER SENTETİK ÖRNEKTİR; gerçek
   // kişi verisi bu belgeye ASLA işlenmez (skor tablosu da maskeli gelir).
   {
     "document_type": "koerekort",
     "full_name": "Anders Testesen",
     "cpr_first6": "010190",
     "document_number": "12345678"
   }
   ```

   (sundhedskort için `address`/`postal_code`/`city` de girilebilir; alanlar kartta ne
   basılıysa o kadar.)

2. Dev VDS'te backend venv'i hazır olmalı (`rapidocr`, `opencv-python-headless` kurulu;
   `requirements.txt` yorumundaki cv2 düzeltmesi uygulanmış).

## Adım 1 — ROI kalibrasyonu

```bash
cd ~/Clients/Recai_Demir/seroguld-crm/backend
.venv/bin/python tests/ocr_benchmark.py --engine local --roi-dump ~/roi-tune/
```

`~/roi-tune/` altına her fotoğraf için: algılanan dörtgenin bindirilmiş kopyası, alan
başına ROI kırpımları ve motorun ham okuduğu metinler düşer. Kırpımlar yanlış yerden
kesiyorsa `backend/.env`'e ROI override yazılır (normalize koordinatlar, mevcut tablonun
üzerine derin birleşimle biner):

```
IDENTITY_OCR_ROI_OVERRIDES_JSON={"koerekort": {"cpr_4d": {"x": 0.30, "y": 0.56, "w": 0.52, "h": 0.09}}}
```

Override yaz → tekrar koş → kırpımlar oturana kadar yinele. Oturan değerler
`backend/app/services/identity_ocr_rois.py` tablosuna geri taşınır (yorumla: "gerçek
kartta kalibre edildi").

## Adım 2 — Skor

```bash
.venv/bin/python tests/ocr_benchmark.py --engine local --images ~/card-photos
.venv/bin/python tests/ocr_benchmark.py --engine barcode --images ~/card-photos
```

Çıktı: alan bazlı doğruluk (full_name, cpr_first6, document_number, postal_code, city),
durum bazlı kırılım, gecikme p50/p95, barkod vuruş sayısı, warp başarı oranı.

Windows-OCR/regex taban çizgisi (yerel motorun geçmesi gereken sayı) CI'da yaşar:
`frontend … identityScanBaselineScore.test.ts` — gerçek `parseIdentityScan` zincirinin
ham OCR kayıtları üzerindeki skoru.

## Adım 3 — Canlıya alma KAPISI (üçü de sağlanmadan `identity_local_ocr_enabled=True` YOK)

1. **Doğruluk:** gerçek klasörde alan bazlı doğruluk ≥ vitest taban çizgisi.
2. **CPR:** barkodlu her sundhedskort fotoğrafında tam 10 hane geri geliyor VE
   `review=validated`.
3. **Gecikme:** p95 < 2 sn (dükkân PC'si CPU'unda).

Kapı geçilirse skor tablosu (maskeli) bu belgeye işlenir ve bayrak default'a alınır.
Geçilmezse: motor flag'siz gem edilir, Windows fallback + barkod katmanı yine kazanım
sayılır (barkod CPR'ı bayraktan bağımsız açıktır), sonuçlar buraya not edilir.

## Sonuçlar

### 0.3.39 — canlıya alma kapısı GEÇİLDİ (10 Eyl 2026)

| Kapı | Ölçüm | Sonuç |
|---|---|---|
| Doğruluk | fixture as-is 48/50 (tek fail: pas_05_glare — parlama MRZ'yi silmiş, taban davranışı) + gerçek kartlar 70/70 → **118/120** | PASS |
| CPR | barkodlu kartlarda tam 10 hane + validated (cpr 25/25) | PASS |
| Gecikme | p95 ~1.0 sn (n=60) | PASS |

Bayrak `identity_local_ocr_enabled=True` default'a alındı (a40e2ca).

### 0.3.40 — dükkân taraması koşulları (flatbed/eğik/portre), 10 Eyl 2026

Saha geribildirimi: gerçek WIA flatbed A4 taramasında alanlar çöp çıkıyordu
(adrese başlık, ad yerine etiket, portre kart hiç okunmuyordu). Sim katmanı
(`--simulate flatbed|autocrop|portrait [--tilt N]`) bu dağılımı bench'e taşıdı —
as-is skor tarama koşulunu temsil ETMEZ, ayrı ölçülür.

| Sim koşulu | 0.3.39 taban | 0.3.40 | p95 |
|---|---|---|---|
| fixture as-is (regresyon) | 48/50 | 48/50 | 1,7 sn |
| gerçek kartlar as-is | 70/70 | 70/70 | 1,2 sn |
| flatbed A4 @300DPI gerçek boyut | — | 48/50 | 1,3 sn |
| flatbed + 3° eğim | — | 48/50 | 1,2 sn |
| autocrop ~%8 marj | — | 47/50 | 1,3 sn |
| portre (kart 90° dikey) | 0/50 | 41/50 | 1,2 sn |

Değişiklik zinciri (hepsi `git log 0.3.40` commit'lerinde):

- **Kadraj-önceliği**: kare ID-1±%10 kadrajındaysa SERBEST dörtgen aranmaz
  (iç foto/metin bloğu ~%29 yanlış dörtgen üretir); karenin ≥%50'sini dolduran
  dörtgen gerçek kart sınırı sayılır ve TAM ÇÖZÜNÜRLÜKLÜ kareden warp edilir
  (küçük kareden 2,8× büyütmek yerine 1,3× — tanınma belirgin iyileşir).
- **Kalıntı eğim (deskew)**: warp sonrası 2–6° kalan eğim kelime kutularından
  izdüşüm aramasıyla kestirilir (görüntü yeniden okunmaz). Sıkı kapı: warp'lı
  karede |açı| ≤ 5° VE skor ≥ 1,8× düz-hipotez (ölçüm: gerçek artık +2,75°/3,3×
  geçer; blur yanlış-pozitifi +9,0°/1,4× düşer). Punto filtresi: başlık↔gövde
  çiftleri (≥2,2× yükseklik farkı) taban hizası taşımaz, çift kurmaz.
- **Portre kurtarma**: dikey kart portre tuvale warp edilir, ±90° iki aday
  180° fark içerir — satır-bandı istatistiği yön ayırt ETMEZ. Danimarka
  kartlarında foto DİK karede soldadır: sol/sağ üçtebir kenar-yoğunluk
  asimetrisi (~20 ms) yönü seçer, kazanan yönde TEK motor atışı koşar
  (iki tam atış p95 ~2,8 sn tutuyordu); sonuç zayıfsa öbür yön denenir.

Kalan bilinen kuyruk (kabul): pas_05_glare (taban), blur/lowlight/glare +
rotate-baked marjinal ad kayıpları sim koşullarında, koerekort_02 portre
(tilt-baked fixture + portre + yeniden kodlama birikimi), idkort ad penceresi
koerekort geometrisiyle çalıştığından çifte-dönüşümde tarih satırı sızabilir
(sundhedskort/kørekort etkilenmez; idkort MRZ yedeği ayakta).

### 0.3.41 — VLM yedeği adayı bench'i: Mistral ailesi GEÇEMEDİ (11 Eyl 2026)

GDPR gerekçesiyle yalnız AB-uçlu VLM yedeği arayışında Mistral (Paris) tek onaylı
adaydı. Kapı: aynı modelin **OpenRouter** dağıtımıyla (sentetik fixture, maliyet
~$0.01) yerel tabanı geriletmeyecek parite. Sonuç — **aile üyelerinin üçü de
merge zincirini geriletir, kapı geçilmedi, Mistral hesabı açılmadı:**

| Kanal | full_name | cpr* | doc_number | postal+city | TOPLAM |
|---|---|---|---|---|---|
| Taban (yerel+barkod, VLM yok) | **19/20** | 0/20* | 14/15 | 10/10 | **43/65** |
| Mistral Small 3.2 | 11/20 | 2/20 | 14/15 | 10/10 | 37/65 |
| Mistral Small 2603 | 7/20 | 5/20 | 15/15 | 10/10 | 37/65 |
| Mistral Medium 3.1 | 11/20 | 0/20 | 15/15 | 10/10 | 36/65 |
| Mistral Medium 3 | 12/20 | 1/20 | 15/15 | 10/10 | 38/65 |
| Mistral Large 2512 | 15/20 | 0/20 | 15/15 | 10/10 | 40/65 |

\* cpr, sentetik fixture'larda ölçülmez (barkod bölgesi çizilidir, zxing çözmez);
gerçek kart cpr'ı barkod katmanından gelir. Karar full_name/doc_number üzerinedir.

Üç teknik not:

- **Merge politikası gerilemenin ana nedeni**: `_merge_tiers` VLM alanını yerelin
  ÜZERİNE koşulsuz yazar — zayıf VLM, doğru yerel okumayı ezer (Small 3.2 8,
  Small 2603 12, Medium 3.1 8, Medium 3 7, Large 4 ad-regresyonu). VLM yedeği
  yeniden değerlendirilmeden önce "VLM yalnız yerel boşluğu doldurur + çelişki
  needs_review" politikası gerekir (0.3.42+ adayı).
- **Koşul kırılımı**: taban clean/blur/lowlight/rotate 9/13 iken Mistral varyantları
  6-9/13'te gezinir; VLM'in clean fixture'da bile hatası, modellerin küçük puntolu
  Danca serif adlarda zayıf olduğunu gösterir. Pahalı Medium katmanı Small'dan daha
  iyi DEĞİL — ailede model büyüklüğü ad-okumayı kurtarmıyor.
- **402 / max_tokens (12 Eyl)**: VLM isteği `max_tokens` göndermiyordu; OpenRouter
  modelin tam tavanını (65536) krediye rezerve edip düşük bakiyede 402 döndürdü —
  zincir yerel yola beklendiği gibi düştü (fallback tasarımı sahada doğrulandı).
  Fix: `_call_vlm` payload'ına `max_tokens: 1024` (maliyet üst sınırı da garantiler).

Runbook: `~/Clients/Recai_Demir/vlm-yedegi-etkinlestirme.md` (tetikleyici eşikleri,
.env şablonu, smoke/parite adımları; hesap açma kararı bu kapıya bağlı kalır).

### 0.3.41 — Azure adayları bench'i (OpenRouter): gpt-4.1-mini PARİTE (12 Eyl 2026)

Mistral kapıyı geçemeyince Azure EU Data Zone'da kullanılabilecek adaylar aynı
sentetik sette (OpenRouter dağıtımıyla) ölçüldü. **Üç model tabanla BİREBİR parite** —
tek fail yine bilinen pas_05_glare, ek kayıp sıfır:

| Kanal | full_name | doc_number | postal+city | TOPLAM | gecikme/kart | Azure EU DZ |
|---|---|---|---|---|---|---|
| Taban (yerel+barkod) | 19/20 | 14/15 | 10/10 | **43/65** | 0,6-1,5 sn | - |
| **gpt-4.1-mini** | 19/20 | 14/15 | 10/10 | **43/65** | **0,9-1,5 sn** | EVET (teyitli) |
| gpt-5-mini | 19/20 | 14/15 | 10/10 | **43/65** | 18-32 sn | EVET (teyitli) |
| gpt-5-nano | 19/20 | 14/15 | 10/10 | **43/65** | 10-18 sn | teyitsiz |
| gpt-4.1-nano | 8/20 | 14/15 | 10/10 | 33/65 | <1 sn | EVET (teyitli) |
| gpt-5.6-luna | 7/20 | 15/15 | 10/10 | 32/65 | ~2-4 sn | EVET (teyitli) |
| gpt-5.4-nano | 7/20 | 13/15 | 9/10 | 29/65 | ~2-5 sn | EVET (teyitli) |

Üç teknik not:

- **Küçük-katman çöküşü**: nano/luna katmanları (4.1-nano 33, 5.6-luna 32,
  5.4-nano 29) CLEAN fixture'larda bile adı bozuyor (7-8/20) - Mistral'da
  görülen aynı tablo; model küçüklüğü küçük puntolu Danca adlarda ölümcül.
- **Parite üçlüsünden üretim adayı gpt-4.1-mini**: parite + ~1 sn çağrı
  (muhakemesiz hızlı model; gpt-5 ailesi muhakeme tokenlarıyla 10-32 sn) +
  Azure EU Data Zone teyitli + ~$1/ay üretim maliyeti (50 kart/gün). gpt-5-mini
  yedek aday (parite ama yavaş). gpt-5-nano paritesi kayda değer ama Azure
  kullanılabilirliği teyitsiz.
- **Resmi uç paritesi hâlâ şart**: OpenRouter sonucu kapı ölçümüdür; açma
  kararı Azure ucu üzerinde aynı bench'in tekrarına bağlı (parite kuralı ±2).
  Ve `_merge_tiers` koşulsuz-ezme politikası aynen geçerli: parite sentetikte
  zararsız olsa da gerçek kartta VLM'in doğru yerel okumayı ezme riski durur
  (0.3.42+ merge politikası adayı).

## Saha telemetrisi nasıl okunur (0.3.41+)

Her tarama iki tür satır yazar: (1) tarama özeti — `idscan.{side}.{lang}.{n}L.{n}F[.S|.NS].{initials}.{engineTag}`
(mevcut, 0.3.30'dan beri); (2) **makine uyarı satırları — `idscan.warn.{side}.{type}.{token}`
(0.3.41)**. Uyarı token'ları backend'in makine kodlarıdır: `glare_detected`,
`roi_low_confidence`, `cpr_mod11_failed_soft`, `card_not_detected`, `vlm_failed:{code}`;
extract hiç yanıt vermezse `extract_unreachable`. Dosya:
`%APPDATA%\dk.seroguld.crm\logs\ui-diagnostics.jsonl` (metadata-only: görüntü,
OCR metni, alan değeri kodlara ASLA girmez — atom kısıtı `[A-Za-z0-9-_.:+]`, ≤64).

```bash
# Tarama özeti kodlarının kırılımı
jq -r '.errorCode | select(test("^idscan\\."))' ui-diagnostics.jsonl | sort | uniq -c | sort -rn

# Tam-başarısız tarama orani: L.0F. = 0 alan uretilen taramalar
TOTAL=$(grep -c '"errorCode":"idscan\.' ui-diagnostics.jsonl)
ZERO=$(grep -c 'L\.0F\.' ui-diagnostics.jsonl)
awk -v z=$ZERO -v t=$TOTAL 'BEGIN { printf "0F orani: %.1f%% (%d/%d)\n", 100*z/t, z, t }'

# Uyarı satirlarinin kirilimi (0.3.41)
jq -r '.errorCode | select(test("^idscan\\.warn\\."))' ui-diagnostics.jsonl | sort | uniq -c | sort -rn

# Gizlilik denetimi (journal basmadan once): gorsel/metin sizmasi = 0 satir
grep -ci 'base64\|data:image' ui-diagnostics.jsonl
```

Eşikler (VLM yedeği tetikleyicisi; tamamları runbook'ta):

| Sinyal | Eşik | Eylem |
|---|---|---|
| `L.0F.` satır oranı | > %5 / 2 hafta | VLM yedeği gündemi |
| `roi_low_confidence` oranı | > %15 / 2 hafta | VLM yedeği gündemi |
| `glare_detected` | > %20 | Kamera/parlama eğitimi |
| `extract_unreachable` | > %5 | Backend/servis teşhisi |
