import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ apiRequest: apiRequestMock }));

import { fetchRemoteInvoices } from '../useUnicontaMakeState';

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
    signedTotalAmount: 10,
    amountDirection: 'income' as const,
    valuta: 'DKK' as const,
  };
}

describe('fetchRemoteInvoices', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('forwards the real skip and stops after a short page', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => invoice(`I-${index}`));
    apiRequestMock
      .mockResolvedValueOnce({ source: 'uniconta_remote', generatedAt: '2026-08-09T00:00:00Z', invoices: firstPage, hasMore: true })
      .mockResolvedValueOnce({ source: 'uniconta_remote', generatedAt: '2026-08-09T00:00:01Z', invoices: [invoice('I-500')], hasMore: false });
    const signal = new AbortController().signal;

    const result = await fetchRemoteInvoices(signal);

    expect(result.invoices).toHaveLength(501);
    expect(apiRequestMock).toHaveBeenCalledTimes(2);
    expect(apiRequestMock.mock.calls[0][0]).toContain('skip=0');
    expect(apiRequestMock.mock.calls[1][0]).toContain('skip=500');
    expect(apiRequestMock.mock.calls[0][1]).toEqual({ signal });
  });

  it('stops immediately when the backend repeats a full page', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => invoice(`I-${index}`));
    apiRequestMock
      .mockResolvedValueOnce({ source: 'uniconta_remote', generatedAt: '2026-08-09T00:00:00Z', invoices: firstPage, hasMore: true })
      .mockResolvedValueOnce({ source: 'uniconta_remote', generatedAt: '2026-08-09T00:00:01Z', invoices: firstPage, hasMore: true });

    await expect(fetchRemoteInvoices()).rejects.toThrow('aynı fatura sayfasını tekrar');
    expect(apiRequestMock).toHaveBeenCalledTimes(2);
  });
});
