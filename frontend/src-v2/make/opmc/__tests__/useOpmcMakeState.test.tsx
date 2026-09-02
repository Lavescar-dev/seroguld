import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A3 standart api-mock deseni. Hook'lar `error instanceof TransportError` kontrolü
// yaptığı için ApiError/TransportError stub sınıfları hem mock modülde hem testte
// aynı sınıf kimliğiyle kullanılmalı — extend edilebilir stub'lar.
const { apiRequestMock, ApiErrorMock, TransportErrorMock } = vi.hoisted(() => {
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

  return { apiRequestMock: vi.fn(), ApiErrorMock: ApiError, TransportErrorMock: TransportError };
});

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  ApiError: ApiErrorMock,
  TransportError: TransportErrorMock,
  localizeApiError: (error: unknown) => String(error),
  downloadAuthedDocument: vi.fn(),
}));

import { ApiError, TransportError } from '@/lib/api';
import type { AntiFraudOrder, AntiFraudOrdersResponse } from '@/types';
import { useOpmcMakeState } from '../useOpmcMakeState';

function order(overrides: Partial<AntiFraudOrder> = {}): AntiFraudOrder {
  return {
    order_id: 1,
    order_number: '1001',
    status: 'completed',
    total: '250.00',
    currency: 'DKK',
    date_created: '2026-08-30T10:00:00Z',
    payment_method: 'card',
    customer_name: 'Test Müşteri',
    customer_email: 'musteri@example.com',
    customer_id: 7,
    ip_address: null,
    billing_country: 'DK',
    billing_city: null,
    shipping_country: null,
    shipping_city: null,
    risk_level: 'low',
    risk_score: 12,
    ai_risk_score: null,
    opmc_risk_score: null,
    risk_score_source: 'opmc',
    raw_risk_score: null,
    requires_manual_review: false,
    risk_meta: [],
    risk_reasons: [],
    notes: [],
    notes_human: [],
    ai_explanations_human: [],
    risk_meta_human: [],
    ...overrides,
  };
}

function ordersResponse(items: AntiFraudOrder[]): AntiFraudOrdersResponse {
  return {
    source: 'opmc',
    generated_at: '2026-08-30T10:00:00Z',
    summary: {
      total_orders: items.length,
      high_risk_count: 0,
      medium_risk_count: 0,
      low_risk_count: 0,
      unknown_risk_count: 0,
      manual_review_count: items.filter((item) => item.requires_manual_review).length,
      active_review_count: items.filter((item) => item.review_queue_status === 'active').length,
      historical_review_count: items.filter((item) => item.review_queue_status !== 'active').length,
      skipped_whitelist_count: 0,
      not_scored_count: 0,
      ai_alert_count: 0,
    },
    items,
  };
}

function createWrapper() {
  // retryDelay 0: hook'un kendi retry fonksiyonu (TransportError için <2) devrede kalır
  // ama testlerde bekleme olmasın; retry tanımı query başına olduğundan retry: false
  // default'u hook'u etkilemez.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderState() {
  return renderHook(() => useOpmcMakeState(), { wrapper: createWrapper() });
}

async function renderLoadedState(items: AntiFraudOrder[]) {
  apiRequestMock.mockResolvedValue(ordersResponse(items));
  const utils = renderState();
  await waitFor(() => expect(utils.result.current.isLoading).toBe(false));
  return utils;
}

const ids = (items: AntiFraudOrder[]) => items.map((item) => item.order_id);

// normalizeRiskLevel gerçek hali (mock'suz @/components/OpmcShared):
// 'High Risk' -> high, 'Yüksek' -> high, 'Orta' -> medium, 'Düşük' -> low, null/bilinmeyen -> unknown
const FILTER_ITEMS = [
  order({ order_id: 1, risk_level: 'High Risk', requires_manual_review: true, status: 'COMPLETED' }),
  order({ order_id: 2, risk_level: 'Orta', requires_manual_review: false, status: 'processing' }),
  order({ order_id: 3, risk_level: 'Düşük', requires_manual_review: true, status: 'completed' }),
  order({ order_id: 4, risk_level: null, requires_manual_review: false, status: '' }),
  order({ order_id: 5, risk_level: 'aciklama icermeyen', requires_manual_review: false, status: 'cancelled' }),
  order({ order_id: 6, risk_level: 'Yüksek', requires_manual_review: false, status: 'pending' }),
];

describe('useOpmcMakeState', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('varsayılan 30 gün ile siparişleri getirir ve listeyi açar', async () => {
    const { result } = await renderLoadedState([order({ order_id: 11 })]);

    expect(apiRequestMock).toHaveBeenCalledWith('/api/v2/opmc/orders?days=30&per_page=40&detail_mode=true&force_refresh=false');
    expect(result.current.days).toBe(30);
    expect(result.current.hasData).toBe(true);
    expect(result.current.source).toBe('opmc');
    expect(result.current.generatedAt).toBe('2026-08-30T10:00:00Z');
    expect(result.current.summary?.total_orders).toBe(1);
    expect(result.current.errorKind).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(result.current.filteredOrders).toHaveLength(1);
  });

  it('riskFilter normalizeRiskLevel semantiğiyle eler', async () => {
    const { result } = await renderLoadedState(FILTER_ITEMS);
    expect(ids(result.current.filteredOrders)).toEqual([1, 2, 3, 4, 5, 6]);

    act(() => {
      result.current.onRiskFilterChange('high');
    });
    expect(result.current.riskFilter).toBe('high');
    expect(ids(result.current.filteredOrders)).toEqual([1, 6]);

    act(() => {
      result.current.onRiskFilterChange('medium');
    });
    expect(ids(result.current.filteredOrders)).toEqual([2]);

    act(() => {
      result.current.onRiskFilterChange('low');
    });
    expect(ids(result.current.filteredOrders)).toEqual([3]);

    act(() => {
      result.current.onRiskFilterChange('unknown');
    });
    expect(ids(result.current.filteredOrders)).toEqual([4, 5]);

    act(() => {
      result.current.onRiskFilterChange('all');
    });
    expect(ids(result.current.filteredOrders)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('manualOnly yes/no seçimini uygular', async () => {
    const { result } = await renderLoadedState(FILTER_ITEMS);

    act(() => {
      result.current.onManualOnlyChange('yes');
    });
    expect(result.current.manualOnly).toBe('yes');
    expect(ids(result.current.filteredOrders)).toEqual([1, 3]);

    act(() => {
      result.current.onManualOnlyChange('no');
    });
    expect(ids(result.current.filteredOrders)).toEqual([2, 4, 5, 6]);

    act(() => {
      result.current.onManualOnlyChange('all');
    });
    expect(ids(result.current.filteredOrders)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('statusFilter küçük harfe indirerek karşılaştırır', async () => {
    const { result } = await renderLoadedState(FILTER_ITEMS);

    act(() => {
      result.current.onStatusFilterChange('completed');
    });
    expect(result.current.statusFilter).toBe('completed');
    expect(ids(result.current.filteredOrders)).toEqual([1, 3]);

    act(() => {
      result.current.onStatusFilterChange('processing');
    });
    expect(ids(result.current.filteredOrders)).toEqual([2]);

    act(() => {
      result.current.onStatusFilterChange('pending');
    });
    expect(ids(result.current.filteredOrders)).toEqual([6]);

    // boş status yalnızca boş filtreyle eşleşir ('all' hariç)
    act(() => {
      result.current.onStatusFilterChange('');
    });
    expect(ids(result.current.filteredOrders)).toEqual([4]);

    act(() => {
      result.current.onStatusFilterChange('all');
    });
    expect(ids(result.current.filteredOrders)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('filtreler birlikte uygulanır', async () => {
    const { result } = await renderLoadedState(FILTER_ITEMS);

    act(() => {
      result.current.onRiskFilterChange('high');
    });
    act(() => {
      result.current.onManualOnlyChange('yes');
    });
    expect(ids(result.current.filteredOrders)).toEqual([1]);

    act(() => {
      result.current.onStatusFilterChange('pending');
    });
    expect(ids(result.current.filteredOrders)).toEqual([]);
  });

  it('quickReviewOrders manual inceleme gerektirenleri döner', async () => {
    const { result } = await renderLoadedState(FILTER_ITEMS);

    expect(ids(result.current.quickReviewOrders)).toEqual([1, 3]);
  });

  it('onDaysChange sorgu anahtarını değiştirir ve 0 -> 30 geri düşer', async () => {
    const { result } = await renderLoadedState(FILTER_ITEMS);

    act(() => {
      result.current.onDaysChange(7);
    });
    expect(result.current.days).toBe(7);
    await waitFor(() =>
      expect(apiRequestMock.mock.calls.at(-1)?.[0]).toBe('/api/v2/opmc/orders?days=7&per_page=40&detail_mode=true&force_refresh=false'),
    );

    // 0 veya boş değer 30'a döner
    act(() => {
      result.current.onDaysChange(0);
    });
    expect(result.current.days).toBe(30);
    await waitFor(() =>
      expect(apiRequestMock.mock.calls.at(-1)?.[0]).toBe('/api/v2/opmc/orders?days=30&per_page=40&detail_mode=true&force_refresh=false'),
    );
  });

  it('onRefresh yeniden getirir', async () => {
    const { result } = await renderLoadedState([order({ order_id: 11 })]);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.onRefresh();
    });
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(2));
    expect(apiRequestMock.mock.calls.at(-1)?.[0]).toBe('/api/v2/opmc/orders?days=30&per_page=40&detail_mode=true&force_refresh=true');
  });

  it('TransportError için errorKind "transport" olur ve iki kez yeniden dener', async () => {
    apiRequestMock.mockRejectedValue(new TransportError('Yerel backend bağlantısı kurulamadı.'));
    const { result } = renderState();

    await waitFor(() => expect(result.current.errorKind).toBe('transport'));

    expect(result.current.isError).toBe(true);
    expect(result.current.hasData).toBe(false);
    expect(result.current.errorMessage).toBe('Yerel backend bağlantısı kurulamadı.');
    // retry: (failureCount, error) => error instanceof TransportError && failureCount < 2
    // -> ilk deneme + 2 retry = 3 çağrı
    expect(apiRequestMock).toHaveBeenCalledTimes(3);
  });

  it('ApiError (404 dahil) için errorKind "upstream" olur ve retry yapmaz', async () => {
    // Liste görünümünde 404 ayrıştırması yoktur — not_found ayrımı yalnızca
    // useOpmcDetailMakeState'te yapılır; burada her ApiError upstream sayılır.
    apiRequestMock.mockRejectedValue(new ApiError(404, 'Kayıt bulunamadı'));
    const { result } = renderState();

    await waitFor(() => expect(result.current.errorKind).toBe('upstream'));

    expect(result.current.isError).toBe(true);
    expect(result.current.errorMessage).toBe('Kayıt bulunamadı');
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it('sıradan Error da upstream sayılır ve mesajı gösterilir', async () => {
    apiRequestMock.mockRejectedValue(new Error('Beklenmeyen yanıt'));
    const { result } = renderState();

    await waitFor(() => expect(result.current.errorKind).toBe('upstream'));

    expect(result.current.isError).toBe(true);
    expect(result.current.errorMessage).toBe('Beklenmeyen yanıt');
  });
});
