import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsWorkspace } from '../SettingsWorkspace';
import type { ApiConfig } from '@/make/settings/types';

vi.mock('@/components/PasswordChangeForm', () => ({
  PasswordChangeForm: ({ variant }: { variant?: string }) => <div>password-form-{variant}</div>,
}));

const config: ApiConfig = {
  openai_api_key: '',
  openai_model: 'gpt-5.4',
  openai_max_tokens: '4096',
  opmc_api_url: '',
  opmc_api_key: '',
  opmc_webhook_secret: '',
  woo_store_url: '',
  woo_consumer_key: '',
  woo_consumer_secret: '',
  woo_webhook_secret: '',
  wp_site_url: '',
  wp_username: '',
  wp_app_password: '',
  uniconta_api_url: 'https://api.uniconta.com',
  uniconta_username: '',
  uniconta_password: '',
  uniconta_company_id: '',
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
};

describe.each(['modern', 'classic'] as const)('SettingsWorkspace %s', (variant) => {
  it('updates and saves the canonical live market-rate toggle', () => {
    const onUpdate = vi.fn();
    const onSave = vi.fn();
    render(
      <SettingsWorkspace
        variant={variant}
        config={{ ...config, market_rates_live_enabled: false }}
        saved={false}
        isSaving={false}
        confirmReset={false}
        apiStatus={[]}
        configuredCount={0}
        onUpdate={onUpdate}
        onSave={onSave}
        onReset={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        uiVariantSlot={null}
        languageSlot={null}
        monitorSlot={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Piyasa oranları/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Canlı piyasa fiyatlarını otomatik kullan/ }));
    fireEvent.click(screen.getByRole('button', { name: /Değişiklikleri kaydet/ }));

    expect(onUpdate).toHaveBeenCalledWith('market_rates_live_enabled', true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows both Uniconta purchase VAT code settings', () => {
    render(
      <SettingsWorkspace
        variant={variant}
        config={config}
        saved={false}
        isSaving={false}
        confirmReset={false}
        apiStatus={[]}
        configuredCount={0}
        onUpdate={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        uiVariantSlot={null}
        languageSlot={null}
        monitorSlot={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Entegrasyonlar/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Uniconta/ }));

    expect(screen.getByDisplayValue('Købsmoms')).toBeInTheDocument();
    expect(screen.getByDisplayValue('KøbBrugtmoms')).toBeInTheDocument();
  });

  it('shows the shared password change form in account and security', () => {
    render(
      <SettingsWorkspace
        variant={variant}
        config={config}
        saved={false}
        isSaving={false}
        confirmReset={false}
        apiStatus={[]}
        configuredCount={0}
        onUpdate={vi.fn()}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        uiVariantSlot={null}
        languageSlot={null}
        monitorSlot={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Hesap ve güvenlik/ }));

    expect(screen.getByText(`password-form-${variant}`)).toBeInTheDocument();
  });
});
