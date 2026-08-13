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
      { name: 'WooCommerce', ok: true },
      { name: 'WordPress', ok: true },
      { name: 'Uniconta', ok: true },
    ]);
  });

  it('does not treat a Uniconta API key as a replacement for the login password', () => {
    const status = buildSettingsApiStatus(config({
      secret_fields_configured: ['uniconta_api_key'],
    }));

    expect(status.find((item) => item.name === 'Uniconta')?.ok).toBe(false);
  });
});
