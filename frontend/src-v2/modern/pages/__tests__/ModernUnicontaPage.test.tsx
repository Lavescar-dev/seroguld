import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModernUnicontaPage } from '../ModernUnicontaPage';
import type { ModernUnicontaPageProps } from '../types';

function invoice(id: string) {
  return {
    id,
    fakturanummer: id,
    ordrenummer: id,
    type: 'Salgsfaktura' as const,
    fakturadato: '2026-08-09',
    konto: 'CRM-1',
    kunde: { id: '1', navn: 'Test' },
    kalemler: [],
    subtotal: 10,
    momsTotal: 0,
    total: 10,
    valuta: 'DKK' as const,
  };
}

const baseProps: ModernUnicontaPageProps = {
  connectionStatus: 'bagli_degil',
  config: {
    companyId: '55606',
    username: 'demo',
    env: 'production',
    apiUrl: 'https://api.uniconta.com',
    connectionStatus: 'bagli_degil',
    configured: true,
    passwordConfigured: true,
    apiKeyConfigured: false,
    sendEmailOnFinalize: false,
    sendXmlOnFinalize: false,
  },
  connectionDraft: {
    companyId: '55606',
    username: 'demo',
    password: '',
    env: 'production',
    sendEmailOnFinalize: false,
    sendXmlOnFinalize: false,
  },
  connectionSettingsOpen: false,
  invoices: [],
  invoicesLoading: false,
  invoicesError: null,
  invoicesTruncated: false,
  syncSummary: null,
  failedSyncs: [],
  health: null,
  connectAvailability: { state: 'available' },
  retryAvailability: { state: 'readonly', title: 'Retry kuyruğu boş' },
};

describe('ModernUnicontaPage', () => {
  it('opens the connection sheet and submits the current draft', () => {
    const onConnect = vi.fn();
    render(<ModernUnicontaPage {...baseProps} onConnect={onConnect} onOpenConnectionSettings={() => undefined} connectionSettingsOpen />);

    fireEvent.change(screen.getByLabelText(/yeni parola/i), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /test et ve kaydet/i }));

    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ companyId: '55606', password: 'new-secret' }));
  });

  it('emits modern list filter changes', () => {
    const onSearchChange = vi.fn();
    const onTypeFilterChange = vi.fn();
    render(<ModernUnicontaPage {...baseProps} onSearchChange={onSearchChange} onTypeFilterChange={onTypeFilterChange} />);

    fireEvent.change(screen.getByPlaceholderText(/fatura, müşteri/i), { target: { value: '8803' } });
    fireEvent.change(screen.getByDisplayValue('Tüm tipler'), { target: { value: 'Kreditnota' } });

    expect(onSearchChange).toHaveBeenCalledWith('8803');
    expect(onTypeFilterChange).toHaveBeenCalledWith('Kreditnota');
  });

  it('disables the active single retry action while its sequence is in flight', () => {
    render(
      <ModernUnicontaPage
        {...baseProps}
        failedSyncs={[{ sequence_no: 42, document_number: 'AFG-42', uniconta_sync_error: 'timeout' }]}
        retryingSingleSeq={42}
        onRetryFailed={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /outbox/i }));
    expect(screen.getByRole('button', { name: /deneniyor/i })).toBeDisabled();
  });

  it('keeps connection settings usable while remote invoice pagination is loading', () => {
    render(
      <ModernUnicontaPage
        {...baseProps}
        invoicesLoading
        onRefresh={() => undefined}
        onOpenConnectionSettings={() => undefined}
        onConnect={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /^Yenile$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Ayarlar$/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Bağlantıyı test et$/ })).toBeEnabled();
  });

  it('paginates large invoice lists while preserving the total count', () => {
    render(<ModernUnicontaPage {...baseProps} invoices={Array.from({ length: 55 }, (_, index) => invoice(`I-${index}`))} onSelectInvoice={() => undefined} />);

    expect(screen.getAllByRole('button', { name: /^Aç$/ })).toHaveLength(50);
    expect(screen.getByText('Faturalar 1–50 / 55')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Sonraki$/ }));

    expect(screen.getAllByRole('button', { name: /^Aç$/ })).toHaveLength(5);
    expect(screen.getByText('Faturalar 51–55 / 55')).toBeInTheDocument();
  });
});
