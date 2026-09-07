# Yazıcı Test Matrisi (TR) — 0.3.35

> **Durum:** Matris hazır; **sonuç kolonları BOŞ** — saha testi bekleniyor
> (hp/Windows saha makinesi bu oturumda çevrimdışıydı). Testler yapılıp
> sonuçlar bu tabloya işlenir.

## Önkoşullar (ET-3850, saha makinesi)

1. **Sürücü:** Epson Scan 2 (ve ScanSmart) kurulu; cihaz *Yazıcılar ve
   tarayıcılar* altında görünür.
2. **A4 varsayılan:** Yazıcı tercihlerinde kağıt boyutu **A4**; FedEx/letter
   değil (Danimarka ofis standardı).
3. **Microsoft Print to PDF kuru koşu:** Gerçek yazıcıya gitmeden önce her
   belgeyi bir kez "Microsoft Print to PDF" ile basıp @page/kenar boşluğu
   davranışını gözlemle (çevrimdışı doğrulama).
4. **Test verisi:** æøå + Türkçe karakter içeren sentetik müşteri adı
   (ör. "Pınar Sørensen Üğü") — font/baskı kaybı görülüyorsa not edilsin.
   **Gerçek müşteri verisi KULLANMA** (GDPR).

## Matris

| # | Belge | Kaynak / yol | Beklenen | Sonuç (saha) |
|---|---|---|---|---|
| 1 | AFG önizleme (workspace print) | Alış çalışma alanı → Yazdır (Tauri) | Tek diyalog, A4, tablo tek sayfaya sığar, başlık tekrarı yok | ☐ |
| 2 | AFG önizleme (tarayıcı modu, `?auto_print=true`) | URL ile | Sayfa açılır açılmaz tek print diyaloğu | ☐ |
| 3 | AFG önizleme (Tauri, script yok) | Devtools/network: `<script` yok | Çift diyaloğu imkânsız | ☐ |
| 4 | POS fiş (alım makbuzu, admin) | Müşteri detayı → Yazdır | A4, tablo bölünmüyor, thead üstte tekrar eder | ☐ |
| 5 | POS fiş (müşteri kopyası) | Aynı, audience=customer | PII maskeli, A4 | ☐ |
| 6 | AFG PDF (renderlab hattı) | Finalize sonrası PDF | A4 12mm (mevcut davranış DEĞİŞMEDİ) | ☐ |
| 7 | Uzun fiş (çok satır, 15+ kalem) | Sentetik çok satırlı oturum | Sayfa taşınca satır bölünmez, thead yeni sayfada tekrar eder | ☐ |
| 8 | æøå + Türkçe ad baskısı | Test verisiyle | Karakterler doğru basılır | ☐ |
| 9 | Microsoft Print to PDF kuru koşu (1–7) | PDF çıktısı inceleme | Kenar boşlukları 14mm, taşma yok | ☐ |

## Bilinen kısıtlar

- `@page` kuralları yalnız print görünümündedir; ekran CSS'ine dokunulmadı.
- AFG resmi PDF'i (`afg_document_renderer.py`, A4 12mm) 0.3.35'te bilinçli
  olarak değiştirilmedi — PDF hattı zaten doğruydu.
- PdfViewerModal'da yazdırma düğmesi yoktur (yalnız `print:hidden` CSS) —
  kapsam dışı.
