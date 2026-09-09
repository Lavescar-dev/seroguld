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

<!-- Buraya tarih + skor tablosu (maskeli) işlenir. -->
