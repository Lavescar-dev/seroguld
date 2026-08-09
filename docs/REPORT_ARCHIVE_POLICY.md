# REPORT ARCHIVE POLICY — Sero Guld CRM (00-LATEST / 99-ARCHIVE)

> **Son doğrulama:** 2026-08-09 · Kapsam: yalnızca Sero Guld CRM rapor paketleri

## 1. Amaç

Sero Guld CRM'e ait merkezî rapor klasöründe her zaman:

- tam olarak **bir** güncel `00-LATEST` paketi (+ `.sha256`),
- tam olarak **bir** kümülatif `99-ARCHIVE` paketi (+ `.sha256`)

bulunur. Kanonik dokümanların ana kopyası repo içindeki `docs/`'tur; `00-LATEST` yalnızca o çalıştırmanın kanıt/teslim paketidir — proje bilgisinin tek kaynağı değildir.

## 2. REPORT_ROOT

- Varsayılan konum: repo kökünün yanındaki `../reports/SeroGuldCRM/` (farklı makinelerde `REPORT_ROOT` ile değiştirilebilir).
- Ortak reports klasöründe başka projeler varsa Sero Guld yalnız kendi alt klasörüne yazar; **başka projelerin 00/99 dosyalarına asla dokunulmaz**.

## 3. Dosya adlandırma

- Güncel paket: `00-LATEST-seroguld-crm-<task-slug>.7z` (+ `.7z.sha256`)
- Kümülatif arşiv: `99-ARCHIVE-seroguld-crm-reports-through-YYYYMMDD.7z` (+ `.7z.sha256`)
- Arşiv içi düzen: `runs/<timestamp>-<slug>/` altında önceki 00 paketleri orijinal byte içeriğiyle + `INDEX.md` + `archive-manifest.json`.

## 4. Rotasyon kuralları

1. Yeni `00-LATEST` yalnızca mevcut çalıştırmayı içerir.
2. Önceki Sero Guld `00-LATEST` paketleri `99-ARCHIVE` içine `runs/` altına alınır (orijinal ad + SHA-256 + alınma zamanı + kaynak yol `archive-manifest.json`'da).
3. Güncel yeni `00-LATEST` **aynı çalıştırmada** `99-ARCHIVE`'e konmaz; sırası bir sonraki çalıştırmada gelir.
4. `99-ARCHIVE` kümülatiftir: mevcut içeriği staging'e açılmadan üzerine yazılmaz; içerik kaybedilmez.
5. Aynı paket SHA-256 ile duplicate eklenmez.
6. Dosya isminden emin olunamazsa iç manifest/içerik kontrol edilir; başka projeye ait paket arşivlenmez.
7. Hiç eski 00 yoksa bile `99-ARCHIVE` oluşturulur (boş manifest + açıklayıcı `INDEX.md`).

## 5. Güvenli rotasyon adımları (her çalıştırma)

1. REPORT_ROOT listele; Sero Guld paketlerini belirle; başka projeleri hariç tut.
2. Mevcut checksum dosyalarını `sha256sum -c` ile doğrula; checksum'suz eski pakete checksum üret ve "legacy" olarak işaretle.
3. Her eski 7z için `7z t` doğrulaması.
4. Disk boş alan kontrolü (staging + 2 paket).
5. Geçici staging klasörü: mevcut 99 içeriğini aç → önceki 00'ları `runs/` altına ekle → `INDEX.md` + `archive-manifest.json` güncelle.
6. Yeni 99'u **geçici adla** oluştur; `7z t` + `7z l` + SHA-256 üret + SHA-256 tekrar doğrula.
7. Yeni 00'ı oluştur (çalışma raporu + documentation-snapshot); aynı doğrulamalar.
8. **Her iki paket doğrulanmadan eski top-level paketlere dokunma.**
9. Doğrulama PASS ise atomik `mv` ile yerine koy; ancak ondan sonra eski top-level kopyaları kaldır.
10. Başarısızlıkta mevcut paketler olduğu gibi bırakılır; staging yalnızca güvenli olduğunda temizlenir.

## 6. Checksum biçimi ve manifest tasarımı

`.sha256` dosyaları `sha256sum -c` ile doğrulanabilir standart biçimdedir: `<hash>  <dosya-adı>`.

**Self-hash yasağı:** Bir 7z arşivinin nihai container SHA-256 değeri, arşivin **içindeki** manifest dosyasına yazılmaz. Manifest değişince arşivin hash'i de değişeceği için bu kararlı değildir. Kurallar:

- Nihai container hash'inin kanonik kaynağı yalnızca dış sidecar `<arsiv>.7z.sha256` dosyasıdır.
- İç `archive-manifest.json` nihai container hash'ini doğrulanmış değer gibi taşımaz; `archive_sha256` alanı `null` olur ve `archive_checksum_scope: "external-sidecar"` yazılır.
- İç manifest, payload dosyalarının ayrı SHA-256 değerlerini (`payload_files`) içerebilir.
- Hiçbir araç kendi arşiv hash'ini iç manifeste yazıp arşivi yeniden paketleme döngüsüne giremez.

Önerilen iç manifest şeması:

```json
{
  "project_name": "Sero Guld CRM",
  "project_slug": "seroguld-crm",
  "archive_checksum_scope": "external-sidecar",
  "archive_sha256": null,
  "payload_files": [{"path": "...", "sha256": "..."}]
}
```

## 7. Rapor içeriği kısıtları

Raporlara secret, token, şifre, `.env` değeri, gerçek müşteri adı/telefon/e-posta/adres, gerçek işlem tutarı ve gereksiz kişisel veri konmaz. Ortam değişkenlerinin yalnız adı ve amacı yazılır.

## 8. Yardımcı araç

Rotasyon `scripts/report-archive-rotate.sh` ile tekrar üretilebilir (repo-local, uygulama runtime'ına bağlı değil; `--dry-run` ve `--verify` destekli).
