import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnicontaPageView } from '../UnicontaPage';
import type { Fatura, UseUnicontaMakeStateResult } from '../types';

function invoice(id: string, signedTotalAmount: number): Fatura {
  return {
    id,
    fakturanummer: id,
    ordrenummer: id,
    type: signedTotalAmount < 0 ? 'Kreditnota' : 'Salgsfaktura',
    fakturadato: '2026-08-13',
    konto: 'CRM-1',
    kunde: { id: '1', navn: 'Test' },
    kalemler: [],
    subtotal: signedTotalAmount,
    momsTotal: 0,
    total: signedTotalAmount,
    signedTotalAmount,
    amountDirection: signedTotalAmount > 0 ? 'income' : signedTotalAmount < 0 ? 'expense' : 'neutral',
    valuta: 'DKK',
  };
}

function pageState(invoices: Fatura[]): UseUnicontaMakeStateResult {
  return {
    config: null,
    kimlik: { companyId: '', username: '', password: '', env: 'production' },
    setKimlik: vi.fn(),
    ayarlarAcik: false,
    setAyarlarAcik: vi.fn(),
    secilenFatura: null,
    setSecilenFatura: vi.fn(),
    aramaQ: '',
    setAramaQ: vi.fn(),
    tipFiltre: 'Tümü',
    setTipFiltre: vi.fn(),
    mailFiltre: 'tümü',
    setMailFiltre: vi.fn(),
    eFaturaFiltre: 'tümü',
    setEFaturaFiltre: vi.fn(),
    tarihFiltre: 'tümü',
    setTarihFiltre: vi.fn(),
    sortKey: 'fakturadato',
    sortDir: 'desc',
    filtrePanelAcik: false,
    setFiltrePanelAcik: vi.fn(),
    faturalar: invoices,
    filtrelenmis: invoices,
    invoicesLoading: false,
    invoicesError: null,
    invoicesTruncated: false,
    baglantiDurumu: 'bagli',
    yukleniyor: false,
    sonYenileme: null,
    stats: {
      toplam: invoices.length,
      toplamKredit: invoices.reduce((sum, item) => sum + item.signedTotalAmount, 0),
      mailGonderildi: 0,
      eFakturaGonderildi: 0,
    },
    activeFilters: 0,
    baglan: vi.fn(),
    yenile: vi.fn(),
    sort: vi.fn(),
    syncSummary: null,
    syncSummaryLoading: false,
    failedSyncs: [],
    failedSyncsLoading: false,
    pendingSyncCount: 0,
    onRetryAll: vi.fn(),
    retryingAll: false,
    lastBulkRetryResult: null,
    health: null,
    healthLoading: false,
    onRetryFailed: vi.fn(),
    retryingSingleSeq: null,
  };
}

describe('UnicontaPageView', () => {
  it('shows date and signed TotalAmount with income, expense and neutral semantics', () => {
    document.documentElement.lang = 'tr';
    const invoices = [invoice('I-INCOME', 1250), invoice('I-EXPENSE', -1000), invoice('I-NEUTRAL', 0)];

    render(<UnicontaPageView {...pageState(invoices)} />);

    expect(screen.getAllByText('13.08.2026')).toHaveLength(3);
    expect(screen.getByText('Gelir')).toHaveClass('text-emerald-700');
    expect(screen.getByText('Gider')).toHaveClass('text-red-700');
    expect(screen.getByText('Nötr')).toHaveClass('text-slate-600');
    expect(screen.getByRole('columnheader', { name: /Tutar/ })).toBeInTheDocument();
  });
});
