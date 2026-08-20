import { describe, expect, it } from 'vitest';

import type { ApiConfig } from '../types';
import { buildSettingsApiStatus } from '../useSettingsMakeState';

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    openai_api_key: '',
    openai_model: 'gpt-5.4',
    openai_max_tokens: '4096',
    opmc_api_url: 'https://api.opmc.dk/v1',
    opmc_api_key: '',
    opmc_webhook_secret: '',
    woo_store_url: 'https://seroguld.dk',
    woo_consumer_key: '',
    woo_consumer_secret: '',
    woo_webhook_secret: '',
    wp_site_url: 'https://seroguld.dk',
    wp_username: 'crm',
    wp_app_password: '',
    uniconta_api_url: 'https://api.uniconta.com',
    uniconta_username: 'uniconta-user',
    uniconta_password: '',
    uniconta_company_id: '55606',
    uniconta_api_key: '',
    uniconta_purchase_vat_code_25: 'Købsmoms',
    uniconta_purchase_vat_code_0: 'KøbBrugtmoms',
    market_gold: '2850',
    market_silver: '8.5',
    market_platin: '280',
    market_palladyum: '335',
    market_rates_live_enabled: false,
    market_rates_live_fx_enabled: true,
    market_rates_live_platinum_enabled: true,
    market_rates_live_palladium_enabled: true,
    metals_dev_api_key: '',
    firma_adi: 'Sero Guld',
    firma_cvr: '',
    firma_telefon: '',
    firma_email: '',
    firma_adres: '',
    ...overrides,
  };
}

describe('settings secret status', () => {
  it('uses configured metadata while keeping secret input values empty', () => {
    const status = buildSettingsApiStatus(config({
      secret_fields_configured: [
        'openai_api_key',
        'opmc_api_key',
        'woo_consumer_key',
        'woo_consumer_secret',
        'wp_app_password',
        'uniconta_password',
      ],
    }));

    expect(status).toEqual([
      { name: 'OpenAI', ok: true },
      { name: 'OPMC', ok: true },
      { name: 'metals.dev', ok: false },
      { name: 'WooCommerce', ok: true },
      { name: 'WordPress', ok: true },
      { name: 'Uniconta', ok: true },
    ]);
  });

  it('marks OPMC ready from the URL alone and metals.dev from its secret', () => {
    // OPMC anahtarı opsiyonel: modül yapım aşamasında, URL doluysa hazır.
    const status = buildSettingsApiStatus(config({
      secret_fields_configured: ['metals_dev_api_key'],
    }));

    expect(status.find((item) => item.name === 'OPMC')?.ok).toBe(true);
    expect(status.find((item) => item.name === 'metals.dev')?.ok).toBe(true);
    expect(buildSettingsApiStatus(config({ opmc_api_url: '  ' })).find((item) => item.name === 'OPMC')?.ok).toBe(false);
  });

  it('does not treat a Uniconta API key as a replacement for the login password', () => {
    const status = buildSettingsApiStatus(config({
      secret_fields_configured: ['uniconta_api_key'],
    }));

    expect(status.find((item) => item.name === 'Uniconta')?.ok).toBe(false);
  });
});
