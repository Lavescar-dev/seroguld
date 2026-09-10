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
