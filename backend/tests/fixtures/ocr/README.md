# OCR Test Fixtures — Sero Guld CRM 0.3.5

20 sentetik belge görseli + `fixtures.json` ground-truth manifesti.

## Uyarı

Bu görsellerin tamamı sentetiktir. Gerçek kişiye ait veri içermez, belge numaraları
ve CPR'ler geçersizdir, hiçbir güvenlik özelliği (hologram, guilloche, mikroyazı,
UV, kinegram) taklit edilmemiştir ve her görselde silinemez `SPECIMEN` bandı vardır.
Yalnız OCR regresyon testi içindir; kimlik doğrulama, KYC veya başka bir sisteme
gerçek belge gibi sunulamaz.

## İçerik

| Tip | Adet | MRZ | Adres taşır | Not |
|---|---:|---|---|---|
| `pas` | 5 | TD3, 2×44 | hayır | Personnr. alanı yalnız CPR ilk 6 hane |
| `idkort` | 5 | TD1, 3×30 | hayır | — |
| `koerekort` | 5 | yok | hayır | EU model, kategori listesi, 12. betingelser |
| `sundhedskort` | 5 | yok | **evet** | Tam CPR + adres + postnr./by |

5 kişi (`P1`–`P5`) dört belge tipinde de tekrarlanır. Aynı kişinin pas + sundhedskort
kombinasyonu, gerçek kuyumcu akışını (kimlik belgesi + adres belgesi) birebir taklit
eder ve müşteri eşleştirme (dedup) testine doğrudan girdi olur.

### Çekim koşulları

Her tipin 5 örneği farklı bozulma altında üretilir:

| Dosya son eki | Koşul |
|---|---|
| `_01_clean.png` | temiz 300 dpi tarama |
| `_02_rotate.png` | ~3° eğik yerleşim |
| `_03_blur_noise.jpg` | telefon kamerası, bulanıklık + sensör gürültüsü, JPEG q72 |
| `_04_lowlight.png` | düşük ışık, tek taraflı gölge |
| `_05_glare.jpg` | flaş yansıması, sağ tarafta yıkanmış alanlar |

`_05_glare` örneklerinde sağ sütun (kart no, cinsiyet, son geçerlilik) kasten
okunması zor bırakıldı. Beklenen davranış bu alanların **doğru okunması değil**,
düşük confidence ile işaretlenip manuel düzeltmeye açılmasıdır.

## Ground truth

`fixtures.json` → `fixtures[]`, her kayıtta:

```
file                    images/ altındaki göreli yol
document_type           pas | idkort | koerekort | sundhedskort
person_id               P1..P5  (tipler arası eşleştirme anahtarı)
capture_condition       clean | rotate | blur_noise | lowlight | glare
carries_address         bool
expected_fields         belgede fiilen basılı olan alanlar
notes                   parser sözleşmesi notları
```

`expected_fields` yalnız o belge tipinde **gerçekten basılı olan** alanları içerir.
Bir alan yoksa OCR onu boş bırakmalıdır; doldurması testin başarısızlığıdır.

## Test sözleşmesi

Bu set üzerinde assert edilmesi gerekenler:

1. **Alan çıkarımı** — `expected_fields` içindeki her alan `clean` ve `rotate`
   örneklerinde birebir eşleşir.
2. **Uydurma yok** — `carries_address: false` olan 15 görselde `adres`,
   `posta kodu`, `şehir` alanları boş döner. Pas/kørekort taramasından adres
   "tahmin edilirse" test kırmızıya döner.
3. **CPR minimizasyonu** — `sundhedskort` görsellerinde kartta tam CPR basılıdır.
   OCR onu okuyabilir, fakat DB, AFG workbook, PDF ve log'a **yalnız ilk 6 hane**
   yazılmalıdır. Son 4 hanenin hiçbir persist edilen yüzeyde bulunmadığı ayrıca
   assert edilmeli (`grep` seviyesinde).
4. **MRZ ↔ basılı ad tutarsızlığı** — MRZ'de `Æ→AE`, `Ø→OE`, `Å→AA` translitere
   edilir. `SØRENSEN-ÅBERG` MRZ'de `SOERENSEN<AABERG` olur. Parser bu ikisini
   eşitlemeye çalışmamalı; basılı ad kanonik kabul edilmeli.
5. **MRZ check digit** — 10 MRZ'li görselin tamamında ICAO 9303 check digit'leri
   geçerlidir. Parser doğrulamayı yapıyorsa hepsi geçmeli; bilinçli bozuk bir
   negatif fixture gerekiyorsa bir karakter değiştirip ayrıca üret.
6. **Tarih formatı** — belgede `DD.MM.YYYY`; `expected_fields.birth_date_iso`
   ile normalize sonucu karşılaştır. `29.02.1992` (artık yıl) fixture'ı P3'tedir.
7. **Düşük kalite davranışı** — `blur_noise`, `lowlight`, `glare` örneklerinde
   alan yanlış okunabilir; kabul kriteri doğruluk değil, **confidence'ın eşiğin
   altında raporlanması ve alanın manuel düzeltmeye açılması**.

## Adres sorunu

`pas`, `idkort` ve `koerekort` belgelerinin hiçbirinde adres yoktur. `0.3.5`
çalışma planındaki "OCR adres, posta kodu, şehir alanlarını doldurur" kabul
kriteri bu üç tiple karşılanamaz. Adres yalnız `sundhedskort` üzerinden gelir.
İki seçenek var: ya OCR sözleşmesi belge tipine göre koşullu hale getirilir, ya
da alış akışında adres için ayrı bir belge taraması adımı tanımlanır.

## Üretim

`gen_fixtures.py` deterministiktir (`seed=20260813` / `4242`). Yeni kişi veya
belge tipi eklemek için `PEOPLE` ve `DOCS` sözlüklerini genişletip yeniden
çalıştırmak yeterlidir; `fixtures.json` otomatik güncellenir.

## Kayıtlı ham OCR çıktısı (`raw_ocr.json`) — CRM sözleşme testleri

`raw_ocr.json`, 20 görselin **gerçek Windows.Media.Ocr** satır çıktısıdır ve
`scripts/ocr-fixture-harness.ps1` ile üretilir (üretimdeki
`WINDOWS_OCR_SCRIPT` ile aynı WinRT çağrıları). Frontend sözleşme testi
`frontend/src-v2/make/alis/__tests__/identityScanOcrContract.test.ts` gerçek
motoru değil bu kaydı tüketir; böylece test deterministik ve CI'da koşulabilir.

Dikkat: bu kayıt geliştirme makinesinde **tr** dil paketiyle alındı (Danca
paketi kurulu değildi). Æ/Ø/Å harfleri E/O/Â gibi okunur; test bu yüzden ad ve
şehir karşılaştırmalarını harf-katlanmış yapar, rakam alanlarını birebir
eşitler. Hedef makinede (da paketi) harness yeniden koşulursa `raw_ocr.json`
tazelenir; sözleşme değişmez.

Kayıt sırasında bulunan ve düzeltilen iki üretim hatası (main.rs):
1. `[System.WindowsRuntimeSystemExtensions]::AsTask($op)` PowerShell 5.1'de
   generic overload çözemeyip patlayabiliyor → reflection (`MakeGenericMethod`).
2. `powershell -Command <script> <arg>` biçiminde arg `$args`'a bağlanmaz,
   komut metnine yapıştırılır → tarama yolu artık `SEROGULD_SCAN_PATH` env
   değişkeniyle geçer.
