import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ModernSettingsPage } from '../ModernSettingsPage';
import type { ModernSettingsPageProps } from '../types';

const baseProps: ModernSettingsPageProps = {
  config: {
    openai_api_key: '',
    openai_model: 'gpt-5',
    openai_max_tokens: '4000',
    opmc_api_url: 'https://opmc.example.test',
    opmc_api_key: '',
    opmc_webhook_secret: '',
    woo_store_url: 'https://shop.example.test',
    woo_consumer_key: '',
    woo_consumer_secret: '',
    woo_webhook_secret: '',
    wp_site_url: 'https://site.example.test',
    wp_username: 'admin',
    wp_app_password: '',
    uniconta_api_url: 'https://uniconta.example.test',
    uniconta_username: 'demo',
    uniconta_password: '',
    uniconta_company_id: '123',
    uniconta_api_key: '',
    market_gold: '610',
    market_silver: '7',
    market_platin: '220',
    market_palladyum: '180',
    firma_adi: 'Sero Guld',
    firma_cvr: '12345678',
    firma_telefon: '+45 00 00 00 00',
    firma_email: 'info@seroguld.dk',
    firma_adres: 'Kobenhavn',
  },
  runtime: [{ label: 'Backend', value: 'Hazır', tone: 'success' }],
};

describe('ModernSettingsPage', () => {
  it('renders the variant slot on the appearance tab and disables save when unavailable', () => {
    render(
      <ModernSettingsPage
        {...baseProps}
        uiVariantSlot={<div>Varyant slotu</div>}
        saveAvailability={{ state: 'unavailable', title: 'Kaydetme kapalı' }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Görünüm' }));

    expect(screen.getByText('Varyant slotu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kaydet/i })).toBeDisabled();
  });

  it('emits field changes for editable inputs', () => {
    const onFieldChange = vi.fn();
    render(<ModernSettingsPage {...baseProps} onFieldChange={onFieldChange} />);

    fireEvent.change(screen.getByDisplayValue('Sero Guld'), {
      target: { value: 'Sero Guld CRM' },
    });

    expect(onFieldChange).toHaveBeenCalledWith('firma_adi', 'Sero Guld CRM');
  });
});
