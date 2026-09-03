# Identitets-Scanner Runbook / Kimlik Tarayıcı Runbook (DK + TR)

> **Sidst opdateret / Son güncellenme:** 2026-09-03
> **Gælder / Geçerli:** v0.3.31+ desktop (Windows), Epson ET-3850 (netværk)
> **Primær sprog: Dansk. Tyrkisk udgave følger i del 2.**

Kunde-scanneren Epson ET-3850 hænger på netværket, og WIA-dialogen er den
problematiske vej i marken. Appen har derfor **to veje** til identitets-OCR,
og denne runbook beskriver begge plus fejlkoderne.

---

## Del 1 — Dansk

### 1.1 To skanningsveje

| Vej | Knap | Vej gennem appen | Kræver |
|---|---|---|---|
| A. WIA-dialog | **Tarayıcıdan** (Fra scanner) | WIA CommonDialog → JPEG → samme read+OCR-blok | WIA-driver + enhed synlig på PC'en |
| B. Mappeovervågning | **Klasörden** (Fra mappe) | Epson-profil skriver JPEG i overvåget mappe → samme read+OCR-blok | Epson-software (Scan 2 / ScanSmart) med skan-til-mappe-profil |

Begge veje bruger **præcis samme** sikkerhedsblok (maks. 10 MB + magic-byte
JPEG/PNG/TIFF/BMP-tjek) og samme lokale Windows OCR. Vej B er den anbefalede
omvej, når WIA-dialogen ikke svarer.

### 1.2 Epson ET-3850 netværks-WIA-installation (Windows)

1. **Netværk:** Printeren skal være tændt og tilsluttet samme netværk som PC'en
   (Ethernet eller Wi-Fi). Notér IP-adressen (menu på enheden: Indstillinger >
   Netværksindstillinger > Netværksstatus).
2. **Driver:** Installér **Epson Scan 2** (og gerne Epson ScanSmart) fra Epsons
   supportside til ET-3850. Installatøren tilføjer WIA-driveren, så enheden
   vises i *Indstillinger > Printere og scannere* som "Epson ET-3850 Series"
   med "Scanner" blandt funktionerne.
3. **WIA-tjeneste:** Kontrollér at tjenesten *Windows Image Acquisition (WIA)*
   kører (`services.msc`). Genstart den, hvis den har lagt sig.
4. **Test uden appen:** Åbn *Windows Fax og scan* (eller Paint > Indsæt fra
   scanner) og lav en prøveskanning. Virker dette, virker knappene i appen også.

Kunne enheden ikke findes her, er det et Windows/driver-problem — ikke en
app-fejl (se fejlkoden `SCANNER_UNAVAILABLE` i 1.5).

### 1.3 Scannerprofil (vej A — WIA-dialog)

- Appen beder WIA om **JPEG**-format; falder enheden tilbage til sit foretrukne
  format (f.eks. BMP), opdager appen det automatisk (magic-byte) og læser alligevel.
- Vælg **ét ark** ad gangen i dialogen. MRZ/OCR-læsningen kører på én side.

### 1.4 Mappeflow (vej B — anbefalet ved WIA-problemer)

1. Opret profilen i Epson-softwaren (Epson Scan 2 Utility > Scan til mappe,
   eller ScanSmart > Skaningsindstillinger > Destination):
   - **Mappe:** `%USERPROFILE%\Pictures\SeroGuld-Scan` — appens standardmappe
     (knappen opretter den selv, hvis den mangler; en anden mappe kan vælges ved
     behov via integrationen).
   - **Format: JPEG** (ikke PDF, ikke flersidet TIFF — de afvises).
   - **Sider: Én side pr. fil** — ét dokumentkort = én JPEG.
   - **Opløsning: ca. 300 dpi.**
2. Tryk **Klasörden** i kundefeltet. Badge'et "Klasör izleme açık" (appens
   tyrkiske UI-tekst; mappen vises ved siden af) bekræfter overvågningen.
   Tryk **Durdur** for at stoppe.
3. Skan kortet med Epson-profilen. Når filen er færdigskrevet (app'en venter
   ca. 1 sekund på, at filstørrelse og tidspunkt er stabile), fylder
   OCR-felterne sig automatisk — præcis som ved en dialogskanning.
4. **Kildefilen slettes IKKE.** Det er en bevidst beslutning: skanningerne
   forbliver i mappen til evt. gendlæsning og efterbehandling. Ryd selv op i
   mappen med jævne mellemrum (den er uden for appens GDPR-område).

Konfigurationen (mappe + tilstand) gemmes i
`%APPDATA%\<app>\identity-watch.json` og huskes mellem sessioner.

### 1.5 Fejlkodetabel

Fejlkoden vises i kundefeltet som `Hata kodu: <kode>` under fejlmeddelelsen —
den er meningen, du læser højt, når du ringer til support.

| Kode | Betydning | Handling |
|---|---|---|
| `SCANNER_UNAVAILABLE` | WIA fandt ingen enhed (udgang 3). **Ikke** en annullering. | Tjek: enhed tændt, samme netværk, WIA-driver installeret (1.2), WIA-tjeneste kører. Brug evt. mappevejen (1.4). |
| `SCAN_CANCELLED` | Brugeren lukkede WIA-dialogen. | Ingen fejl — appen er tavst om det. |
| `ACQUISITION_FAILED` | Skanningen startede men fuldførte ikke. | Enheden kan være optaget/uklar; prøv igen, evt. genstart WIA-tjenesten. |
| `INVALID_IMAGE` | Filen er ikke et gyldigt JPEG/PNG/TIFF/BMP. | Sæt Epson-profilen til JPEG, én side (1.4). PDF understøttes ikke. |
| `FILE_TOO_LARGE` | Filen er over 10 MB. | Sænk opløsningen (300 dpi er nok) eller skan én side. |
| `FILE_READ_FAILED` | Filen kunne ikke læses. | Er filen låst/under skrivning? Prøv igen; ved mappevejen venter app'en normalt selv. |
| `OCR_UNAVAILABLE` | Windows lokal OCR mangler. | Installér Windows OCR-funktionen (Valgfrie funktioner). |
| `OCR_FAILED` | OCR kørte, men resultatet kunne ikke tolkes. | Prøv igen; tjek at dansk sprogpakke findes (advarsel vises i panelet). |
| `TEMP_CLEANUP_FAILED` | Midlertidig skanningsfil kunne ikke slettes. | Harmløst for data; mappen `identity-scans` i cache kan tømmes manuelt. |
| `WATCH_FOLDER_UNAVAILABLE` | Mappen kunne ikke overvåges/oprettes. | Tjek stien og rettighederne (1.4). Kan prøves igen. |
| `WATCH_ALREADY_ACTIVE` | Overvågning kører allerede. | Tryk **Durdur** først. |
| `UNSUPPORTED_PLATFORM` | Funktion findes kun i Windows-appen. | Brug desktop-appen (ikke browseren). |
| `BRIDGE_UNAVAILABLE` / `INTERNAL_ERROR` | Appens interne bro svarede ikke. | Genstart appen; medtag koden i support-sagen. |

### 1.6 Rul-ud af fejlkoder i marken (support)

Når kunden ringer: få koden læst op (`Hata kodu: …`). Koden adskilder
"enhed væk" fra "annulleret" — det var netop forvekslingen, der gjorde, at
skanne-fejl tidligere lød som bruger-annulleringer.

---

## Del 2 — Türkçe

### 2.1 İki tarama yolu

| Yol | Düğme | Akış | Gereksinim |
|---|---|---|---|
| A. WIA diyaloğu | **Tarayıcıdan** | WIA CommonDialog → JPEG → aynı read+OCR bloğu | WIA sürücüsü + cihazın PC'de görünmesi |
| B. Klasör izleme | **Klasörden** | Epson profili izlenen klasöre JPEG yazar → aynı read+OCR bloğu | Epson yazılımı (Scan 2 / ScanSmart) scan-to-folder profili |

İki yol da **birebir aynı** güvenlik bloğunu (maks. 10 MB + magic-byte
JPEG/PNG/TIFF/BMP kontrolü) ve aynı yerel Windows OCR'ı kullanır. WIA diyaloğu
yanıt vermediğinde B yolu önerilen alternatiftir.

### 2.2 Epson ET-3850 network WIA kurulumu (Windows)

1. **Ağ:** Yazıcı açık ve PC ile aynı ağda olmalı (Ethernet veya Wi-Fi). IP'yi
   not edin (cihaz menüsü: Ayarlar > Ağ Ayarları > Ağ Durumu).
2. **Sürücü:** Epson'un ET-3850 destek sayfasından **Epson Scan 2** (ve
   mümkünse Epson ScanSmart) kurun. Kurulum WIA sürücüsünü ekler; cihaz
   *Ayarlar > Yazıcılar ve tarayıcılar*'da "Epson ET-3850 Series" olarak,
   özelliklerinde "Tarayıcı" ile görünür.
3. **WIA servisi:** *Windows Image Acquisition (WIA)* servisi çalışıyor
   olmalı (`services.msc`). Takıldıysa yeniden başlatın.
4. **Uygulama dışı test:** *Windows Faks ve Tarama* (veya Paint > Tarayıcıdan
   ekle) ile deneme taraması yapın. Bu çalışırsa uygulamanın düğmeleri de
   çalışır.

Cihaz burada bulunamıyorsa sorun Windows/sürücü katmanındadır — uygulama hatası
değildir (bkz. `SCANNER_UNAVAILABLE`, 2.5).

### 2.3 Tarayıcı profili (yol A — WIA diyaloğu)

- Uygulama WIA'dan **JPEG** ister; cihaz kendi tercih ettiği formata (ör. BMP)
  dönerse uygulama bunu magic-byte ile anlar ve yine de okur.
- Diyaloğda **tek sayfa** seçin. MRZ/OCR okuması tek sayfa üzerindedir.

### 2.4 Klasör akışı (yol B — WIA sorunlarında önerilen)

1. Epson yazılımında profili oluşturun (Epson Scan 2 Utility > Klasöre tara,
   veya ScanSmart > Tarama ayarları > Hedef):
   - **Klasör:** `%USERPROFILE%\Pictures\SeroGuld-Scan` — uygulamanın
     varsayılanı (düğme yoksa klasörü kendisi oluşturur; gerekiyorsa başka
     klasör de verilebilir).
   - **Biçim: JPEG** (PDF değil, çok sayfalı TIFF değil — reddedilir).
   - **Sayfa: Dosya başına tek sayfa** — bir kimlik kartı = bir JPEG.
   - **Çözünürlük: ~300 dpi.**
2. Müşteri panelinde **Klasörden** düğmesine basın. "Klasör izleme açık"
   rozeti (yanında klasör yolu) izlemeyi doğrular. Durdurmak için **Durdur**.
3. Kartı Epson profiliyle tarayın. Dosya yazımı bitince (uygulama boyut ve
   zaman damgasının sabitlenmesini ~1 saniye bekler) OCR alanları otomatik
   dolar — diyalog taramasıyla birebir aynı.
4. **Kaynak dosya SİLİNMEZ.** Bilinçli karar: taramalar yeniden işleme ve
   denetim için klasörde kalır. Klasörü düzenli aralıklarla elle temizleyin
   (uygulamanın GDPR alanının dışındadır).

Yapılandırma (klasör + durum) `%APPDATA%\<app>\identity-watch.json` içinde
saklanır ve oturumlar arasında hatırlanır.

### 2.5 Hata kodu tablosu

Hata kodu, hata mesajının altında `Hata kodu: <kod>` olarak görünür — destek
aradığınızda bu kodu okuyun.

| Kod | Anlam | Yapılacak |
|---|---|---|
| `SCANNER_UNAVAILABLE` | WIA cihaz bulamadı (exit 3). İptal DEĞİL. | Kontrol: cihaz açık, aynı ağda, WIA sürücüsü kurulu (2.2), WIA servisi çalışıyor. Gerekirse klasör yolunu kullanın (2.4). |
| `SCAN_CANCELLED` | Kullanıcı WIA diyaloğunu kapattı. | Hata değil — uygulama sessiz kalır. |
| `ACQUISITION_FAILED` | Tarama başladı ama tamamlanmadı. | Cihaz meşgul/yanıtsız olabilir; tekrar deneyin, WIA servisini yeniden başlatın. |
| `INVALID_IMAGE` | Dosya geçerli JPEG/PNG/TIFF/BMP değil. | Epson profilini JPEG + tek sayfa yapın (2.4). PDF desteklenmez. |
| `FILE_TOO_LARGE` | Dosya 10 MB üzeri. | Çözünürlüğü düşürün (300 dpi yeterli), tek sayfa tarayın. |
| `FILE_READ_FAILED` | Dosya okunamadı. | Dosya kilitli/yazılmakta olabilir; tekrar deneyin — klasör yolunda uygulama normalde kendisi bekler. |
| `OCR_UNAVAILABLE` | Windows yerel OCR eksik. | Windows OCR özelliğini kurun (İsteğe bağlı özellikler). |
| `OCR_FAILED` | OCR koştu ama sonuç çözülemedi. | Tekrar deneyin; Danca dil paketini kontrol edin (panelde uyarı görünür). |
| `TEMP_CLEANUP_FAILED` | Geçici tarama dosyası silinemedi. | Veri için zararsız; cache'teki `identity-scans` klasörü elle boşaltılabilir. |
| `WATCH_FOLDER_UNAVAILABLE` | Klasör izlenemedi/oluşturulamadı. | Yolu ve erişim izinlerini kontrol edin (2.4). Tekrar denenebilir. |
| `WATCH_ALREADY_ACTIVE` | İzleme zaten açık. | Önce **Durdur**'a basın. |
| `UNSUPPORTED_PLATFORM` | Özellik yalnız Windows uygulamasında. | Masaüstü uygulamasını kullanın (tarayıcı değil). |
| `BRIDGE_UNAVAILABLE` / `INTERNAL_ERROR` | Uygulama içi köprü yanıt vermedi. | Uygulamayı yeniden başlatın; destek kaydına kodu ekleyin. |

### 2.6 Saha notu (destek)

Müşteri aradığında ekrandaki kodu okutun (`Hata kodu: …`). Kod, "cihaz yok" ile
"iptal edildi"yi ayırır — eskiden cihaz hataları kullanıcı iptali sanılıyordu;
bu paketin ana düzeltmesi tam olarak budur.
