# WordPress GDPR Bridge

## Amaç
- WordPress tarafında ayrı privacy/cookie/request sayfaları üretmek yerine CRM public GDPR sayfalarını authoritative kaynak yapmak.
- WordPress footer veya legal link alanları CRM public sayfalarına yönlenir.
- Cookie kategorileri gerektiğinde CRM `bridge-config` ve `cookie-config` endpointlerinden alınır.

## Public Kaynaklar
- Privacy policy: `/api/v2/public/gdpr/bridge-config` içindeki `privacy_policy_url`
- Cookies: `/api/v2/public/gdpr/bridge-config` içindeki `cookies_url`
- Request center: `/api/v2/public/gdpr/bridge-config` içindeki `privacy_request_url`
- Cookie config JSON: `/api/v2/public/gdpr/bridge-config` içindeki `cookie_config_url`

## WordPress Entegrasyon Modeli
- Footer veya menu linkleri doğrudan CRM public sayfalarına gider.
- Cookie banner veya legal footer snippet’i CRM bridge-config endpoint’inden URL/meta alır.
- Bu repo WordPress plugin veya theme otomasyonu içermez; v2 teslimat seviyesi `CRM Pages + Snippet`tir.

## Hazır Asset Pack
- Footer şablonu: `ops/wordpress/footer-links.html`
- Bridge snippet: `ops/wordpress/bridge-snippet.js`

### Kullanım
1. `bridge-config` endpoint URL'sini bulun.
2. WordPress tarafında `window.SEROGULD_GDPR_BRIDGE_CONFIG_URL` değerini bu endpoint'e ayarlayın.
3. `bridge-snippet.js` içeriğini theme footer veya uygun bir custom HTML/JS alanına ekleyin.
4. Yalnız statik footer gerekiyorsa `footer-links.html` içindeki placeholder alanları CRM URL'leriyle doldurun.

## Örnek Footer Snippet
```html
<ul class="seroguld-gdpr-links">
  <li><a href="https://crm.example.com/#/gdpr/privacy">Privatlivspolitik</a></li>
  <li><a href="https://crm.example.com/#/gdpr/cookies">Cookies</a></li>
  <li><a href="https://crm.example.com/#/gdpr/request">Anmod om dataindsigt</a></li>
</ul>
```

## Copy Checklist
1. `bridge-config` endpointinden public URL’leri alın.
2. WordPress footer/menu linklerini bu URL’lere yönlendirin.
3. İsteğe bağlı cookie banner entegrasyonu için `cookie_config_url` kullanın.
4. GDPR public surface değiştiğinde WordPress’te ayrı içerik güncellemesi yapmayın; kaynak CRM olsun.
