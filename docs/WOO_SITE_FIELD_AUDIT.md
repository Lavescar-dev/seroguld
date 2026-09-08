# Canlı site alan-denetimi — seroguld.dk (WooCommerce)

Tarih: 8 Eylül 2026 · Denetleyen: CRM 0.3.36 ağacı (HEAD `85b784b`) · Kaynak: Woo REST v3 (`WOOCOMMERCE_BASE_URL` + consumer key/secret, `.env`)

Denetim yöntemi: `wp-json/wc/v3` üzerinden tür başına 2-3 yayınlanmış ürün çekildi
(kategori filtresiyle), alanlar (description / attributes / meta_data / yoast_*) kaydedildi
ve aynı ürünün ölçüleri CRM'in `_spec_strip_text` + `_build_attributes` koduna verilerek
çıktı birebir karşılaştırıldı. Sırlar ve kimlik bilgisi bu rapora girmedi; kullanılan
veri yalnız ürün/fiyat verisi (kişisel değil). Ölçü örnekleri rapor için yeniden
kurulmuş (sentetik) ürün kayıtları üzerindendir.

## 1. Kategori haritası (tür → canlı kategori)

| CRM türü / profil | Canlı kategori (id) | Örneklem |
| --- | --- | --- |
| jewelry (Smykke) | Guld → Guldsmykker (82), Smykker → Guldsmykker (106) | sku 1611-1613, 1624-1628 (publish) |
| bar (Barre) | Guld → Guldbarrer (78), Sølv → Sølvbarrer (138) | Gbar096/098, Bmom095-097 |
| coin (Mønt) | Guld → Guldmønter (109), Sølv → Sølvmønter (395), Mønter (108) | Gmoent055-1/-2, Bmom091-093 |
| platinum | Platin (904) | Plat003, Bmom032-1, Bmom071 |
| üretici | Producent (79) → PAMP (1188), Umicore (110), Valcambi (976)… | bar örnekleriyle birlikte |

Ek kategoriler: `Nyhed` (779 — rozet/“yeni”), `Pre-owned` (707), `SOLGT` (708),
`Uncategorized` (43), karat kategorileri Guld altında (58/83/86/87/84/60/85).
Karat alt kategorisi CRM'in `_resolve_categories` karat haritasına karşılık gelir;
örneklenen yeni smykkelerde **`14 kt. guld` (58) + `Guld` (76) + `Guldsmykker` (82/106) +
`Smykker` (105)** birlikte gönderilmiş (4-5 kategori/ürün).

## 2. Tür → hangi alan hangi sırada (canlı convention)

### Smykke (jewelry) — 1611-1628, en güncel ve en kalabalık grup
`description` içindeki sıra: **paragraf → şerit satırı → “Karakterfuld/eksklusiv …” gövde
paragrafları → Størrelsesguide bloğu → “Få hjælp” + iç link kapanışı.**

Yeşil şerit içeriği (düzyazı olarak paragraf 1'in içine yazılmış, canlı örnek):

```
Vare nr. : 1628 Vægt: 13,76g Længde: 41,20cm Bredde: 7,03/4,25mm Tykkelse: 1,85mm
```

`Yderligere information` attribute tablosu (pozisyon sırası korunur):

| pos | alan | örnek değer |
| --- | --- | --- |
| 0 | Karat | `18 Karat` |
| 1 | Renhed | `0,750` (kesir) |
| 2 | Vægt | `13,76g` |
| 3 | Længde | `41,20cm` (kolye burada; boşsa hiç yok) |
| 4 | Bredde | `1,54mm` |
| 5 | Tykkelse | `1,85mm` (yalnız doluysa) |
| 6 | Producent | `SSA` / `PH` / `Ukendt` |
| 7 | Vare nr. | `1628` (bazı eski satırlarda küçük harf `vare nr.`) |

SEO slotları: `_yoast_wpseo_focuskw`, `_yoast_wpseo_metadesc`,
`_yoast_wpseo_primary_product_cat` (=106), `_yoast_wpseo_content_score` / `_linkdex`
(Yoast'un kendi analizleri). **`_yoast_wpseo_title` yeni satırlarda YOK** — site, title'ı
Yoast şablonundan (`%title% - Seroguld`) alıyor.

### Barre / Mønt / Platin (investment)

| profil | attribute sırası (canlı) | şerit |
| --- | --- | --- |
| barre | Vægt (`50 gram` / `1/2oz (15,55175g)`), Karat (`24`), Renhed (`999,9 promille (99,99%)`), Producent | yok (yalnız gövde) |
| sølvbarre | Renhed (`0,999`), Vægt (`1000g`), Producent — **Renhed önce** | yok |
| mønt | Karat (`21 Karat` / `21,60 Karat`), Renhed (`0,875` ya da `900` — tutarsız), Vægt (`7,2g`), Diameter, (bazen) Producent + Årstal | yok |
| platin | Ædelmetal (`Platin`), Renhed (`999,5`), Vægt (`31,1g`), Producent | yok |

Yatırım satırlarında description içinde şerit yok; format satırdan satıra değişiyor
(oz/gram karışık, Renhed kesir/promille karışık).

## 3. CRM kodu (HEAD) vs canlı — karşılaştırma tablosu

Aynı ölçüler CRM koduna verildiğinde çıkan sonuç:

| tür | CRM attribute sırası | CRM şerit (`_spec_strip_text`) | Fark |
| --- | --- | --- | --- |
| jewelry | Karat, Renhed, Vægt, Længde, Bredde, Tykkelse, Producent, Vare nr. | `Vare nr. : 1613 Vægt: 9,16g Længde: 50,30cm Bredde: 4,11mm` | **YOK — alan adları, sıra ve format birebir** |
| coin | Vægt (`7,20 gram`), Karat (`21` çıplak), Renhed (`875,0 promille (87,50%)`), Diameter, Tykkelse, Producent, Årstal | `Vare nr. : … Vægt: 7,20 gram` | canlı mücevher-tarzı tablo (Karat `21 Karat`, Renhed kesir) — ama canlı satırlar kendi aralarında da tutarsız |
| bar | Vægt (`15,55 gram`), Karat, Renhed (promille), Producent | `Vare nr. : … Vægt: 15,55 gram` | canlı oz/notasyon serbest; CRM tek tip gram |
| platin | Vægt, Ædelmetal, Renhed (promille), Producent | `Vare nr. : … Vægt: 31,10 gram` | aynı içerik, sıra/format CRM'de tutarlı |

SEO slotları: CRM `_yoast_wpseo_title` + `_yoast_wpseo_metadesc` (+ `rank_math_*`,
`crm_meta_description`, `_yoast_wpseo_primary_product_cat`) yazar; canlı satırlarda
title meta yok, metadesc + primary cat var → **uyumlu** (title meta fazlalığı zararsız:
Yoast şablonuyla aynı son eki üretir, `test_seo_title_suffix_skipped_when_title_long`
uzun başlıkta eki atlar).

## 4. Bulgular ve kararlar

1. **Smykke hizalaması tam — kod değişikliği gerekmedi.** `_jewelry_attributes` ve
   `_spec_strip_text` çıktısı canlı convention ile alan-adı/sıra/format olarak birebir.
   Kolye (necklace) için `length_cm` doluysa `Længde` şeritte ve tabloda **ilk ölçü olarak
   kalır** (denetim doğruladı: `Vare nr. : X Vægt: Yg Længde: 45,00cm Bredde: … Tykkelse: …`).
   Kolye şikayeti kod hatası değil: `length_cm` boş bırakıldığında Længde hiç üretilmez
   (uydurma yok — doğru davranış) ya da operatör profili `bar` gibi weight-moduna
   alırsa şerit `Vare nr. + Vægt`'e düşer. Çözüm operatör tarafında: ölçüyü gir / profili
   `Smykke` seç. `backend/tests/test_woocommerce_profiles.py` bu ikisini kilitler
   (audit ile aynı senaryo için `test_jewelry_attribute_order_matches_live_site` eklendi).
2. **Canlıdaki en yeni S-serisi (1571-1628) CRM'den yayınlanmamış görünüyor.** Son 100
   ürünün hiçbirinde `crm_product_id` meta'sı ve `sg-spec-box` / `<!-- /sg-spec -->`
   marker'ı yok; ama CRM publish payload'ı ikisini de koşulsuz yazar (`woocommerce.py`
   publish). Şerit bu satırlarda paragraf 1'in **içinde düz metin** (CRM AI prompt'u
   buna açıkça izin vermez — “SKRIV IKKE numeriske specifikationer”). Muhtemel açıklama:
   bu ürünler mağaza tarafından elle/Woo tarafında üretildi; CRM'in convention'u zaten
   bu satırlardan türetildiği için çakışma yok. **Uyarı:** CRM'den gerçek bir yayın
   sonrası bu denetimin tekrar edilmesi gerekir — `_metal_*`, `_markup_rate*`,
   `backprice`, `base_price` gibi mağaza-eklentisi meta'ları CRM meta'larıyla
   yan yana yaşayabiliyor; `crm_product_id`'nin kaybolması (uzun vadede) izlenebilir
   bir sinyaldir.
3. **Yatırım türlerinde (barre/mønt/platin) canlı veri kendi içinde tutarsız; CRM'in
   investment tablosu bilinçli olarak tek tip.** Promille/kesir, gram/oz karışımı canlıda
   var; birebir kopyalamak hem imkânsız hem istenmez. Karar: **dokunma.** (Yeni alan
   uydurma yok, düzen bozulmadı.)
4. **Yeşil kutu formatı canlıda doğrulanamadı** (madde 2). `_apply_spec_strip`'in
   idempotent marker + inline-stil kutusu yaklaşımı olduğu gibi kaldı; canlı satırların
   düz-metin şeridi de CRM AI prompt kuralı sayesinde ikinci kez tekrarlanmıyor.
5. **Kategori/SEO slotları uyumlu:** karat alt kategorisi + Guld + Guldsmykker/Smykker
   zinciri CRM kategori haritasıyla aynı; primary term meta anahtarı
   (`woocommerce_primary_term_meta_key`, default `_yoast_wpseo_primary_product_cat`)
   canlı kullanımla aynı.

## 5. Sonuç

| Konu | Karar |
| --- | --- |
| Şerit/attribute sıra-ad uyumu (jewelry) | birebir — kod değişikliği yok |
| Investment profilleri | bilinçli tek tip — kod değişikliği yok |
| Kolye Længde | veri/profil meselesi; davranış testle kilitli |
| SEO slotları | uyumlu; `_yoast_wpseo_title` fazlası zararsız |
| CRM'den yayın izi (`crm_product_id`, yeşil kutu) | canlıda görülmedi — sonraki CRM yayını sonrası yeniden denetim önerilir |

## 6. Tekrar denetimi

Sırlar repoya girmez; denetim scriptleri geçici çalışma alanında durur
(`/home/lavescar/.claude/jobs/1a672599/tmp/woo_probe.py`, `woo_fetch.py`,
`woo_crm_marked.py`, `code_vs_live.py`). Aynı denetimi yinelemek için:

```bash
backend/.venv/bin/python /home/lavescar/.claude/jobs/1a672599/tmp/woo_fetch.py
backend/.venv/bin/python /home/lavescar/.claude/jobs/1a672599/tmp/code_vs_live.py
```
