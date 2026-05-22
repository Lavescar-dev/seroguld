# WordPress GDPR Bridge

> **Son güncellenme:** 2026-05-18

## Amaç

- WordPress tarafında ayrı privacy/cookie/request sayfaları üretmek yerine **CRM public GDPR sayfalarını authoritative kaynak** yapmak.
- WordPress footer veya legal link alanları CRM public sayfalarına yönlenir.
- Cookie kategorileri gerektiğinde CRM `bridge-config` ve `cookie-config` endpoint'lerinden alınır.
- Single source of truth: GDPR metni değiştiğinde sadece CRM güncellenir, WordPress otomatik takip eder.

## Public CRM URL'leri (Routes)

Aşağıdaki route'lar CRM frontend tarafından `public` olarak (auth gerekmez) render edilir:

| Route | Kullanım |
|---|---|
| `/gdpr/privacy` | Privatlivspolitik (gizlilik politikası) |
| `/gdpr/cookies` | Cookie politikası + tercih panel |
| `/gdpr/request` | Yeni data subject request (export / delete / pseudonymize) |
| `/gdpr/request/:token` | Token-based request status takibi |

## Backend Bridge Config Endpoint

```
GET /api/v2/public/gdpr/bridge-config
```

Yanıt:
```json
{
  "privacy_policy_url": "https://crm.example.com/#/gdpr/privacy",
  "cookies_url": "https://crm.example.com/#/gdpr/cookies",
  "privacy_request_url": "https://crm.example.com/#/gdpr/request",
  "cookie_config_url": "https://crm.example.com/api/v2/public/gdpr/cookie-config",
  "policies": [
    { "key": "essential", "name_da": "Nødvendige", "name_tr": "Zorunlu", "required": true },
    { "key": "analytics", "name_da": "Analyse", "name_tr": "Analitik", "required": false },
    { "key": "marketing", "name_da": "Markedsføring", "name_tr": "Pazarlama", "required": false }
  ],
  "generated_at": "2026-05-18T10:00:00Z"
}
```

## WordPress Entegrasyon Modeli

- Footer veya menu linkleri **doğrudan CRM public sayfalarına** gider.
- Cookie banner veya legal footer snippet'i CRM `bridge-config` endpoint'inden URL/meta alır.
- Bu repo WordPress plugin veya theme otomasyonu **içermez**; v2 teslimat seviyesi `CRM Pages + Snippet`'tir.

## Hazır Asset Pack

`ops/wordpress/` klasöründe:
- `footer-links.html` — Static footer şablonu
- `bridge-snippet.js` — Dinamik bridge config fetch snippet'i

### Kullanım

1. CRM `bridge-config` endpoint URL'sini bulun:
   ```
   https://crm.example.com/api/v2/public/gdpr/bridge-config
   ```

2. WordPress tarafında `window.SEROGULD_GDPR_BRIDGE_CONFIG_URL` değerini bu endpoint'e ayarlayın:
   ```html
   <script>
     window.SEROGULD_GDPR_BRIDGE_CONFIG_URL =
       'https://crm.example.com/api/v2/public/gdpr/bridge-config';
   </script>
   ```

3. `bridge-snippet.js` içeriğini theme footer veya uygun bir custom HTML/JS alanına ekleyin (örn. WP Customizer → Custom CSS / Code Snippets eklentisi).

4. Yalnız statik footer gerekiyorsa `footer-links.html` içindeki placeholder alanları CRM URL'leriyle doldurun.

## Örnek Footer Snippet

```html
<ul class="seroguld-gdpr-links">
  <li><a href="https://crm.example.com/#/gdpr/privacy">Privatlivspolitik</a></li>
  <li><a href="https://crm.example.com/#/gdpr/cookies">Cookies</a></li>
  <li><a href="https://crm.example.com/#/gdpr/request">Anmod om dataindsigt</a></li>
</ul>
```

## Cookie Config (yapılandırılabilir)

```
GET /api/v2/public/gdpr/cookie-config
```

Yanıt: Tercih kategorileri + script template'leri.

## Copy Checklist

1. `bridge-config` endpoint'inden public URL'leri alın.
2. WordPress footer/menu linklerini bu URL'lere yönlendirin.
3. İsteğe bağlı cookie banner entegrasyonu için `cookie_config_url` kullanın.
4. GDPR public surface değiştiğinde WordPress'te ayrı içerik güncellemesi yapmayın; **kaynak CRM olsun**.
5. WordPress tarafında ayrı GDPR plugin (Complianz, GDPR Cookie Consent, vb.) yüklendiyse onları **devre dışı bırakın** veya CRM bridge ile koordine edin.

## İlgili dökümanlar

- `docs/PROJECT_SYSTEM_GUIDE_TR.md` §6.13 (GDPR modülü)
- `docs/GDPR_TAURI_SMOKE_TR.md` — GDPR smoke test akışı
- `backend/app/api/gdpr.py` — public endpoint'ler
- `ops/wordpress/footer-links.html` ve `ops/wordpress/bridge-snippet.js` — asset pack
