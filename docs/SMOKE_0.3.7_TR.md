# SERO GULD CRM 0.3.7 — Canlı Smoke Rehberi

> Sıra önemli: her faz bir öncekinin üzerine kurulur. Bir adım kırmızıysa
> ekran görüntüsü + (varsa) toast/uyarı metnini not al, sonraki adıma geç —
> akışı kesme. Faz 0–4 CRM makinesinde, Faz 5 siteye erişimi olan bilgisayarda.

## Faz 0 — Kurulum ve açılış

1. **Kur:** CRM'yi tamamen kapat → `Downloads\SERO-GULD-CRM-FULL-SETUP.exe`
   (SHA256 `96721d01…e339e2`) çalıştır. Veriler korunur; 0035 migration ilk
   açılışta otomatik uygulanır.
2. **Aç:** Dashboard hatasız yüklenmeli. (Hata çıkarsa artık uç nokta + HTTP
   kodu + uygulama/runtime sürüm karşılaştırması gösterir — o metni not al.)
3. **Sürüm:** Tarayıcıda `http://127.0.0.1:8100/health` →
   `{"status":"ok","version":"0.3.7"}`.

## Faz 1 — Depolama / Lager

4. **Liste dolu:** Depolama açılışında ürünler görünüyor; sol menü rozeti ile
   liste sayısı tutarlı. Kategori sekmeleri (Guldbarrer/Guldsmykker/…) artık
   gerçek sayı gösteriyor, seçince liste boşalmıyor.
5. **Tümü sekmesi (klasik):** Klasik arayüzde ilk sekme "Tümü" — tüm ürünleri
   listeliyor.
6. **Ölçü alanları:** Bir ürünü modern editörde aç → Uzunluk / Genişlik (mm) /
   Kalınlık (mm) / **Çap (mm)** / Üretici alanları var ve kaydediliyor.
   Bir değeri boşaltıp kaydet → tekrar açınca gerçekten silinmiş olmalı.

## Faz 2 — Alış, AFG ve müşteri ekranı

7. **Oranlar:** Fiyat ayar çekmecesi DKK/g; fx/Pt/Pd rozetlerinde kaynak
   (metals.dev/ECB) ve tazelik görünüyor; manuel altın/gümüş alanları
   düzenlenebilir. Platin/Palladium DKK/g değerlerinin dolu olduğundan emin ol
   (Pt/Pd satır fiyatları buradan gelir).
8. **Altın satırı:** Yeni alış → 14K'ya gram gir → müşteri ekranında tek kelime
   **GULD** başlığı altında satır ("GULD · ALTIN" ve "SØLV · SØLV" yok artık).
9. **Bar satırı:** Guldbarre'ye gram gir → müşteri ekranında GULD bloğunda
   Guldbarre satırı; taslak workbook'ta satır 29.
10. **Pt/Pd satırı:** Platin (tip 8) ve Palladium (tip 9) satırlarına gram gir →
    müşteri ekranında **PLATIN** bloğu; birim fiyat = oran × (1 − avance).
11. **Kniv:** Kniv beregner'e adet gir → müşteri ekranında **KNIV** kırılımı
    (`Kniv 17,54 g × 3 = 52,62 g` gibi) + hedef gümüş satırında gram.
12. **Excel'de aç (taslak):** Excel gerçekten açılıyor; satır 35 Platin / 36
    Palladium; `Variable værdier` J17/J18'de Pt/Pd oranları; VBA/formüller
    sağlam. Excel'de F35 gramını değiştir → CRM'ye senkron olmalı.
13. **Finalize → kompakt belge:** Yalnız dolu satırlar, 22'den ardışık; sıra
    altın → bar → gümüş → Pt/Pd. Kontrol: 22K satırı **916 / 91,60**; Plet
    saflıksız; CPR alanında **yalnız ilk 6 hane**; footer'da yalnız
    **Sero Guld** kalın; adres `Postnr.` satırında "2500 Valby" biçiminde;
    yanlış yerde yıldız/işaret kalmamış (göz kontrolü).
14. **Depoya akış:** Finalize sonrası Depolama'da bar → `Guldbarrer`,
    Platin/Palladium → `Platin & Pd` kategorisinde.

## Faz 3 — Müşteriler ve OCR

15. **Seç:** Müşteriler'de "Seç" → **aynı sayfada** Seçili Müşteri paneli
    açılır ve sayfa panele kayar; Alış'a yönlendirme YOK. "Alış başlat" ayrı
    buton olarak çalışıyor.
16. **Özet:** Panelde AFG geçmişi + metal dağılımı (Pt/Pd gramları ve bıçak
    adedi/ağırlığı dahil) görünüyor.
17. **OCR:** Alış müşteri formunda kimlik taraması → sundhedskort test
    görseliyle: ad + adres + posta/şehir + **CPR ilk 6 hane** doğru alanlara,
    "inceleyin" rozetleriyle gelir. Pas görseliyle: adres alanları BOŞ kalmalı
    (uydurma yok). (0.3.6'daki onarımlardan sonra taramanın ilk gerçek testi.)
18. **Form sırası:** Müşteri formlarında **Posta kodu önce, Şehir sonra**.

## Faz 4 — Tarihsel import

19. `Desktop\import`'tan 2-3 gerçek dosya ile önizleme → hepsi "ready";
    belge no/tarih/toplamlar birebir (ör. 6852,30); şirket dosyasında KDV
    korunmuş. Uygula → belgeler geçmişte. Aynı dosyayı tekrar yükle →
    "already_imported".

## Faz 5 — Site tarafı (diğer bilgisayar)

20. **Servis hesabı:** WP'de "Sero Guld" kullanıcısı → Woo REST anahtarını bu
    kullanıcıya bağlı yeniden üret → CRM Ayarlar > Entegrasyonlar >
    WooCommerce'e gir. (Ürünlerin "Efe Aras" görünmesi bununla biter.)
21. **Probe:** Backend venv'de
    `.\.venv\Scripts\python.exe -m app.tools.probe_woocommerce_site --product-id 37844`
    → bastığı kategori haritası + StoneX/rozet şablon JSON'larını doldurup
    CRM Ayarlar > **WooCommerce Eşlemeleri**'ne yapıştır, kaydet.
    (Medya testi istersen `--test-upload C:\yol\foto.jpg`.)
22. **Yayın:** CRM'den fotoğraflı bir test ürünü yayınla → sitede kontrol:
    - Fotoğraflar geldi; **ilk foto öne çıkan görsel**; tekrar yayınla →
      medya kütüphanesinde kopya OLUŞMUYOR.
    - "Yderligere information": Karat/Renhed/Vægt/Længde/Bredde/Tykkelse/
      Diameter/Producent/Vare nr. dolu.
    - Kategoriler: takı → Smykker>Guldsmykker + karat kategorisi; yeni çöp
      kategori YARATILMADI.
    - "Ny vare" rozeti (30 gün zamanlamalı) + StoneX metal alanları dolu.
    - Açıklamanın altında sabit Danca blok (Vi garanterer altid pæne varer…).
    - Yoast SEO title dolu.
    - CRM'de uyarı çıktıysa toast'ta göründü (sessiz hata yok).
23. **Yayından kaldır:** CRM'den kaldır → sitede taslağa düştü, CRM'de durum
    "Depoda" oldu.
24. **Temizlik:** Eski "Test Bilezik" ürünleri ve çöp kategoriler
    ("Gult Guld", "Smykke") silinsin/birleştirilsin.

## Faz 6 — Entegrasyon turu

25. **Uniconta:** Fatura detayında satırlar dolu; Tarih kolonu var; tutarlar
    işaretli/renkli.
26. **Woo katalog:** Katalog sayfalamada tablo boşalmıyor; arama yazarken
    takılmıyor; önizleme → onayla akışı çalışıyor (önizleme 15 dk geçerli).
27. **Excel probe:** Ayarlar/gömülü workbook başlığında Excel durumu doğru;
    sorun halinde "Yeniden dene" bağlantısı var.

## Kırmızı adım protokolü

- Ekran görüntüsü + toast/uyarı metni + saat.
- Dashboard hatasıysa: gösterilen uç nokta + HTTP kodu + sürüm satırı.
- Woo yayın sorunuysa: yayın sonrası çıkan uyarı toast'larının tam metni
  (artık her medya/eşleme sorunu orada görünür).
- Log klasörü: `C:\ProgramData\SeroGuldCRM\logs`.
