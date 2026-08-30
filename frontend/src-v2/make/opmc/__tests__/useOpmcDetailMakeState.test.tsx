import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A3 standart api-mock deseni + A5 router deseni. Hook `error instanceof ApiError`
// ve `error instanceof TransportError` kontrolü yaptığı için stub sınıflar hem mock
// modülde hem testte aynı sınıf kimliğiyle yaşar.
const { apiRequestMock, ApiErrorMock, TransportErrorMock, toastMocks } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    requestId?: string;
    url?: string;

    constructor(status: number, message: string, requestId?: string, url?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.requestId = requestId;
      this.url = url;
    }
  }

  class TransportError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TransportError';
    }
  }

  const toastMocks = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  return {
    apiRequestMock: vi.fn(),
    ApiErrorMock: ApiError,
    TransportErrorMock: TransportError,
    toastMocks,
  };
});

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  ApiError: ApiErrorMock,
  TransportError: TransportErrorMock,
  localizeApiError: (error: unknown) => String(error),
  downloadAuthedDocument: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ useToast: () => toastMocks }));

import { ApiError, TransportError } from '@/lib/api';
import type { AntiFraudOrder } from '@/types';
import { useOpmcDetailMakeState } from '../useOpmcDetailMakeState';

function order(overrides: Partial<AntiFraudOrder> = {}): AntiFraudOrder {
  return {
    order_id: 3,
    order_number: '1003',
    status: 'completed',
    total: '480.00',
    currency: 'DKK',
    date_created: '2026-08-30T12:00:00Z',
    payment_method: 'bank_transfer',
    customer_name: 'Detay Müşteri',
    customer_email: 'detay@example.com',
    customer_id: 9,
    ip_address: null,
    billing_country: 'DK',
    billing_city: null,
    shipping_country: null,
    shipping_city: null,
    risk_level: 'medium',
    risk_score: 45,
    ai_risk_score: null,
    opmc_risk_score: null,
    risk_score_source: 'opmc',
    raw_risk_score: null,
    requires_manual_review: true,
    risk_meta: [],
    risk_reasons: [],
    notes: [],
    notes_human: [],
    ai_explanations_human: [],
    risk_meta_human: [],
    ...overrides,
  };
}

function createWrapper(initialEntry = '/opmc/3') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/opmc/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

function renderDetail(initialEntry = '/opmc/3') {
  return renderHook(() => useOpmcDetailMakeState(), { wrapper: createWrapper(initialEntry) });
}

async function renderLoadedDetail(initialEntry = '/opmc/3') {
  apiRequestMock.mockResolvedValue(order({ order_id: 3, risk_level: 'medium', risk_score: 45 }));
  const utils = renderDetail(initialEntry);
  await waitFor(() => expect(utils.result.current.isLoading).toBe(false));
  return utils;
}

describe('useOpmcDetailMakeState', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
    toastMocks.warning.mockClear();
    toastMocks.info.mockClear();
  });

  it('geçerli id için detayı getirir', async () => {
    const { result } = await renderLoadedDetail();

    expect(result.current.requestedId).toBe('3');
    expect(result.current.hasData).toBe(true);
    expect(result.current.detail?.order_id).toBe(3);
    expect(result.current.errorKind).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.isNotFound).toBe(false);
    expect(apiRequestMock).toHaveBeenCalledWith('/api/v2/opmc/orders/3');
  });

  it('geçersiz id not_found döner ve istek atmaz', async () => {
    for (const entry of ['/opmc/abc', '/opmc/0', '/opmc/-2']) {
      apiRequestMock.mockResolvedValue(order());
      const { result } = renderDetail(entry);

      await waitFor(() => expect(result.current.errorKind).toBe('not_found'));

      expect(result.current.isNotFound).toBe(true);
      expect(result.current.isError).toBe(false);
      expect(result.current.detail).toBeNull();
      expect(result.current.hasData).toBe(false);
      // sorgu enabled: false — hiç istek atılmaz
      expect(apiRequestMock).not.toHaveBeenCalled();
      expect(result.current.errorMessage).toBe('OPMC detay verisi alınamadı.');
    }
  });

  it('ApiError 404 not_found olarak ayrıştırılır ve retry edilmez', async () => {
    apiRequestMock.mockRejectedValue(new ApiError(404, 'Sipariş bulunamadı'));
    const { result } = renderDetail();

    await waitFor(() => expect(result.current.errorKind).toBe('not_found'));

    expect(result.current.isNotFound).toBe(true);
    // not_found, isError kapsamına girmez — sayfa ayrı "bulunamadı" akışı izler
    expect(result.current.isError).toBe(false);
    expect(result.current.hasData).toBe(false);
    expect(result.current.errorMessage).toBe('Sipariş bulunamadı');
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('ApiError 500 upstream olur ve retry edilmez', async () => {
    apiRequestMock.mockRejectedValue(new ApiError(500, 'Sunucu hatası'));
    const { result } = renderDetail();

    await waitFor(() => expect(result.current.errorKind).toBe('upstream'));

    expect(result.current.isError).toBe(true);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.errorMessage).toBe('Sunucu hatası');
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('TransportError transport olur ve iki kez yeniden dener', async () => {
    apiRequestMock.mockRejectedValue(new TransportError('Yerel backend bağlantısı kurulamadı.'));
    const { result } = renderDetail();

    await waitFor(() => expect(result.current.errorKind).toBe('transport'));

    expect(result.current.isError).toBe(true);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.errorMessage).toBe('Yerel backend bağlantısı kurulamadı.');
    // ilk deneme + 2 retry = 3 çağrı
    expect(apiRequestMock).toHaveBeenCalledTimes(3);
  });

  it('override başarılı: cache güncellenir, opmc sorguları invalidate edilir ve toast.success atılır', async () => {
    // Not: renderLoadedDetail burada kullanılmaz — kendi mockResolvedValue'u
    // testin Once/rejected zincirini ezer.
    const initial = order({ order_id: 3, risk_level: 'medium', risk_score: 45 });
    const overridden = order({ order_id: 3, risk_level: 'high', risk_score: 88, has_manual_override: true });
    apiRequestMock.mockResolvedValueOnce(initial).mockResolvedValue(overridden);

    const { result } = renderDetail();
    await waitFor(() => expect(result.current.hasData).toBe(true));
    expect(result.current.detail?.risk_level).toBe('medium');

    act(() => {
      result.current.onOverride('high', 'Şüpheli grafik deseni');
    });

    await waitFor(() =>
      expect(toastMocks.success).toHaveBeenCalledWith('Risk seviyesi güncellendi', 'Yeni seviye: high'),
    );

    expect(apiRequestMock).toHaveBeenCalledWith('/api/v2/opmc/orders/3/override', {
      method: 'POST',
      body: JSON.stringify({ level: 'high', reason: 'Şüpheli grafik deseni' }),
    });
    // onSuccess setQueryData ile yazılan cache verisi — structural sharing
    // yeni referans ürettiği için derin eşitlik doğrulanır
    expect(result.current.detail).toEqual(overridden);
    expect(result.current.detail?.risk_level).toBe('high');
    // invalidateQueries({ queryKey: ['opmc'] }) aktif detay sorgusunu yeniden getirir
    await waitFor(() => expect(apiRequestMock.mock.calls.at(-1)?.[0]).toBe('/api/v2/opmc/orders/3'));
    expect(result.current.overriding).toBe(false);
  });

  it('override hatası: toast.error ile mesaj gösterilir', async () => {
    const initial = order({ order_id: 3, risk_level: 'medium' });
    apiRequestMock.mockResolvedValueOnce(initial);
    apiRequestMock.mockRejectedValue(new ApiError(500, 'Override reddedildi'));

    const { result } = renderDetail();
    await waitFor(() => expect(result.current.hasData).toBe(true));

    act(() => {
      result.current.onOverride('high', 'neden');
    });

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('Override yapılamadı', 'Override reddedildi'),
    );

    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(result.current.detail?.risk_level).toBe('medium');
    expect(result.current.overriding).toBe(false);
  });

  it('onRefresh detayı yeniden getirir', async () => {
    const { result } = await renderLoadedDetail();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onRefresh();
    });
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
    expect(apiRequestMock.mock.calls.at(-1)?.[0]).toBe('/api/v2/opmc/orders/3');
    expect(result.current.hasData).toBe(true);
  });
});
