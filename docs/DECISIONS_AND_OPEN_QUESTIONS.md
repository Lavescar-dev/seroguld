# DECISIONS AND OPEN QUESTIONS — Sero Guld CRM

> **Son doğrulama:** 2026-08-09 · **Repo:** `seroguld-crm` · **Branch:** `build/seroguld-feedback-20260610-140000`

## 1. Kabul edilmiş kararlar (kod/doc'tan VERIFIED)

1. **Desktop-first:** Tauri masaüstü kanonik; web stack secondary (docker-compose yorumu).
2. **Kanonik frontend:** Vite + `src-v2/`; `legacy-next/` karantina (README: "new product work must not target it").
3. **Hash router:** Tauri custom protocol + SPA fallback sorunlarını çözmek için.
4. **Windows'ta `http://tauri.localhost`:** `tauri://` navigate WebView2'de çalışmadığı için (commit `24f86ee`).
5. **Para hesapları Decimal + ROUND_HALF_UP**, merkezi helper'lar.
6. **Tek worker uvicorn** (process-singleton cache'ler).
7. **AFG finalize idempotency** satır kilidi + 409 ile.
8. **CPR/kimlik AES-GCM + hash**, müşteri ekranı maskeli.
9. **5 yıl saklama** (Bogføringsloven §10) AFG belgeleri + melt lot + finansal defter.
10. **Uniconta hybrid sync:** finalize'ı bloklamaz; hata durumu belgeye yazılır.
11. **Hyprland'de X11 fallback** dev.js tarafından enjekte edilir (Wayland DMABUF siyah ekran).
12. **Rapor rotasyonu:** 00-LATEST / 99-ARCHIVE politikası (bkz. REPORT_ARCHIVE_POLICY.md).

## 2. Önerilmiş, henüz kabul edilmemiş (PROPOSED)

1. Release workflow'a Windows smoke + ana pencere smoke.
2. Release exe startup loglaması + safe mode.
3. Backend adresinin runtime yapılandırılması.
4. Müşteri ekranı monitör seçim ayarı.
5. Açık tema dönüşümü (token planı raporda).
6. Yedek şifreleme (GPG/openssl).
7. Rate-limit + CSRF + CSP sıkılaştırma + TLS.

## 3. Doküman ↔ kod çelişkileri (CONTRADICTED)

| # | Doküman iddiası | Gerçek | Kaynak |
|---|---|---|---|
| 1 | `docs/README.md:48-54`: `referans/` ve `docs/referans/` klasörleri | Repo'da YOK (yalnız Windows handoff paketinde) | find sonucu |
| 2 | `AGENTS.md` + AUDIT: ".env repo'da committed" | Bu kopyada `.env` hiç commit edilmemiş (`git log --all -- .env` boş) — iddia bayat veya tarih rewrite edilmiş (remote doğrulanamaz: UNKNOWN) | git |
| 3 | `package-wordpress-bridge.sh` PHP plugin paketler | `ops/wordpress/seroguld-crm-bridge/` YOK; script fail olur | ls |
| 4 | `docs/README.md`: HANDOVER "1300+ satır", System Guide "922 LOC" | Gerçek: 1474 / 1366 satır | wc -l |
| 5 | `DESKTOP_SMOKE_PREREQUISITES_TR.md:68` "Windows test edilmedi" | Haziran'da CI Windows smoke eklendi (kısmen aşılmış) | workflow |
| 6 | Root `README.md` | **Yok** — repo kökünde README bulunmuyor | ls |

## 4. Açık iş soruları (kullanıcıya)

### Satış (SALES-00)
1. Tezgâh satışı nasıl işleyecek: Depolama'dan ürün seç → fiyat → fatura mı? Teklif/marj politikası ne?
2. İade ve kredi notu (Kreditnota) akışı UI'da gerekli mi?
3. Web (Woo) satışı ile tezgâh satışı aynı belge serisini mi kullanacak?
4. Satışta KDV (moms) hesabı: mevcut `INVOICE_SALE_VAT_RATE_PERCENT` yeterli mi? (Danimarka'da kullanılmış kıymetli metal fark vergisi/margin scheme uygulanıyor mu?)
5. Satış sonrası stok durumu: SOLD ürün arşivleniyor mu, listede kalıyor mu?

### Depolama alanları (çözüldü — doğrulama sorusu)
6. İki alan **Depolama** (fiziksel envanter) ve **Log** (AFG defteri) olarak tespit edildi; kullanıcı onayı bekiyor. Excel'deki "ayrı depolama (satılacak mı belli değil)" bloğu `undecided` route'una mı karşılık geliyor?

### Excel / cutover (EXCEL-00)
7. Günlük operasyonda Excel hâlâ paralel dolduruluyor mu, yoksa CRM tek kaynak mı oldu?
8. Eski Excel'lerdeki tarihsel satırlar CRM'e toplu migrate edildi mi, edilecek mi?

### WordPress (WP-00)
9. Site-CRM iletişim hedefi mevcut kapsamın (ürün publish + GDPR köprüsü + webhook satış) ötesinde mi? (fiyat panosu canlı veri, randevu, müşteri hesabı?)
10. `seroguld-webshops` vitrin taslağı canlıya alınacak mı; seroguld.dk ile ilişkisi ne olacak?

### Operasyon
11. Aynı anda birden fazla operatör kullanacak mı? (Mimari tek operatör varsayıyor.)
12. Windows hedef makine kesin mi; Linux ana makine olarak kalacak mı?
13. OPMC kısaltmasının resmî açılımı nedir? (WC Anti-Fraud eklentisi bağlamı VERIFIED, harf açılımı UNKNOWN.)

## 5. Bu denetimde çözülen belirsizlikler

- **AFG = Afregningsbilag** (VERIFIED, çoklu kaynak).
- **İki depolama alanı** = Depolama + Log (VERIFIED kod + Excel).
- **demo_implementation.md / MASTER belgesi:** hiçbir yerde YOK (VERIFIED).
- **Monorepo yapısı:** tek aktif Git reposu + 2 tarihsel kopya + Git'siz yan projeler (VERIFIED).
