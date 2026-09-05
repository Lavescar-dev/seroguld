// M3 — log lot taslaklarının bayatlaması düzeltmesi:
// 1) taslak seed edilirken sunucu updated_at'i taban olarak saklanır,
// 2) taslak kirli değilken polling ile gelen güncellemeler tabanı tazeler,
// 3) kirli taslakta taban kasıtlı olarak bayat kalır → onSaveLot bayat
//    expected_updated_at gönderir → stale_lot (409) koruması tetiklenir,
// 4) başarılı kayıtta taslak sunucu yanıtından tazelenir.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogBucketWorkspace, LogMeltLot, LogWorkspace } from '@/types';

import { useLogMakeState } from '../useLogMakeState';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  downloadAuthedDocument: vi.fn(),
  fetchAuthedText: vi.fn(),
  localizeApiError: (error: unknown) => String(error),
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/components/ConfirmDialog', () => ({
  useConfirm: () => (async () => true),
}));

vi.mock('@/lib/artifactSync', () => ({
  emitArtifactSync: vi.fn(),
  listenArtifactSync: vi.fn(() => () => undefined),
  signalMatches: vi.fn(() => false),
}));

let workspaceOverride: LogWorkspace | null = null;

function buildLot(updatedAt: string, overrides: Partial<LogMeltLot> = {}): LogMeltLot {
  return {
    id: 'lot-1',
    metal_bucket: 'gold',
    sent_date: '2026-06-01',
    purchased_from_date: null,
    before_weight_grams: '15.00',
    before_amount_dkk: '20000.00',
    before_pure_gold_grams: '13.76',
    after_pure_gold_grams: '',
    insurance_dkk: '',
    shipping_dkk: '',
    refining_dkk: '',
    sale_date: null,
    quote_eur: null,
    exchange_rate_dkk: '',
    payout_total_dkk: null,
    notes: null,
    cost_total_dkk: '0',
    estimated_sale_value_dkk: null,
    net_after_costs_dkk: null,
    bridge_difference_dkk: null,
    status: 'draft',
    line_count: 1,
    created_at: '2026-06-01T08:00:00Z',
    updated_at: updatedAt,
    ...overrides,
  };
}

function buildWorkspace(lots: LogMeltLot[]): LogWorkspace {
  const bucket: LogBucketWorkspace = {
    metal_bucket: 'gold',
    summary: {
      total_documents: 0,
      total_lines: 1,
      awaiting_lines: 0,
      routed_lines: 1,
      split_line_count: 0,
      melt_line_count: 0,
      melt_lot_count: lots.length,
      total_weight_grams: '15',
      total_pure_gold_grams: '13.76',
      total_amount_dkk: '20000',
    },
    documents: [],
    split_groups: [
      { key: 'jewelry_cleaning', label: 'Smykker Lager', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
      { key: 'white_gold', label: 'Hvidguld', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
      { key: 'separate_storage', label: 'Spandlager', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
    ],
    melt_queue: {
      line_count: 0,
      total_weight_grams: '0',
      total_pure_gold_grams: '0',
      total_amount_dkk: '0',
      earliest_purchase_date: null,
      latest_purchase_date: null,
      document_numbers: [],
    },
    melt_lots: lots,
  };
  return {
    summary: {
      total_documents: 0,
      awaiting_documents: 0,
      inventory_documents: 0,
      undecided_documents: 0,
      melted_documents: 0,
      total_amount_dkk: '20000',
      total_pure_gold_grams: '13.76',
    },
    gold: bucket,
    silver: { ...bucket, metal_bucket: 'silver', melt_lots: [] },
  };
}

function renderLogState() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/log']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useLogMakeState(), { wrapper: Wrapper });
}

function mockWorkspaceGet() {
  apiRequestMock.mockImplementation((url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/api/v2/log/workspace')) {
      return Promise.resolve(workspaceOverride);
    }
    return Promise.resolve({});
  });
}

describe('useLogMakeState — lot taslak bayatlığı (M3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    workspaceOverride = null;
  });

  it('kirli olmayan taslak, polling ile gelen updated_at ile taban tazeler ve save güncel expected gönderir', async () => {
    workspaceOverride = buildWorkspace([buildLot('2026-08-01T09:00:00Z')]);
    mockWorkspaceGet();
    const state = renderLogState();

    await waitFor(() => expect(state.result.current.lotDrafts['lot-1']).toBeDefined());

    // Sunucuda başka bir kullanıcı no-op kayıt yaptı: sadece updated_at ilerledi.
    workspaceOverride = buildWorkspace([buildLot('2026-08-01T10:00:00Z')]);
    await act(async () => {
      await state.result.current.onRetryWorkspace();
    });
    await waitFor(() =>
      expect(state.result.current.workspace?.gold.melt_lots[0]?.updated_at).toBe('2026-08-01T10:00:00Z'),
    );
    // Seed/rebase effect'inin oturmasını bekle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(state.result.current.lotDrafts['lot-1']).toBeDefined(),
    );

    // Kirli olmayan taslak + taze taban: save güncel expected_updated_at gönderir.
    const bodies: Array<Record<string, unknown>> = [];
    apiRequestMock.mockImplementation((url: unknown, options?: { body?: unknown }) => {
      if (typeof url === 'string' && url.startsWith('/api/v2/log/workspace')) {
        return Promise.resolve(workspaceOverride);
      }
      if (typeof url === 'string' && url.includes('/api/v2/log/melt-lots/')) {
        bodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
        return Promise.resolve(buildLot('2026-08-01T11:00:00Z', { insurance_dkk: '5' }));
      }
      return Promise.resolve({});
    });

    await act(async () => {
      state.result.current.onSaveLot('lot-1');
    });

    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].expected_updated_at).toBe('2026-08-01T10:00:00Z');
  });

  it('başarılı kayıtta taslak sunucu yanıtından tazelenir (normalize edilmiş değer gelir)', async () => {
    workspaceOverride = buildWorkspace([buildLot('2026-08-01T09:00:00Z')]);
    mockWorkspaceGet();
    const state = renderLogState();
    await waitFor(() => expect(state.result.current.lotDrafts['lot-1']).toBeDefined());

    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.startsWith('/api/v2/log/workspace')) {
        return Promise.resolve(workspaceOverride);
      }
      if (typeof url === 'string' && url.includes('/api/v2/log/melt-lots/')) {
        // Sunucu kanonik değeri döner ('42' → '42.00').
        return Promise.resolve(buildLot('2026-08-01T11:00:00Z', { insurance_dkk: '42.00' }));
      }
      return Promise.resolve({});
    });

    await act(async () => {
      state.result.current.onLotDraftChange('lot-1', { insurance_dkk: '42' });
    });
    await act(async () => {
      state.result.current.onSaveLot('lot-1');
    });

    await waitFor(() =>
      expect(state.result.current.lotDrafts['lot-1']?.insurance_dkk).toBe('42.00'),
    );
  });

  it('kirli taslakta taban bayat kalır: save eski expected_updated_at gönderir (stale_lot koruması)', async () => {
    workspaceOverride = buildWorkspace([buildLot('2026-08-01T09:00:00Z')]);
    mockWorkspaceGet();
    const state = renderLogState();
    await waitFor(() => expect(state.result.current.lotDrafts['lot-1']).toBeDefined());

    // Kullanıcı taslağı düzenler (kirli).
    await act(async () => {
      state.result.current.onLotDraftChange('lot-1', { insurance_dkk: '42' });
    });

    // Ardından sunucu güncellemesi gelir (başka kullanıcı).
    workspaceOverride = buildWorkspace([buildLot('2026-08-01T10:30:00Z')]);
    await act(async () => {
      await state.result.current.onRetryWorkspace();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const bodies: Array<Record<string, unknown>> = [];
    apiRequestMock.mockImplementation((url: unknown, options?: { body?: unknown }) => {
      if (typeof url === 'string' && url.startsWith('/api/v2/log/workspace')) {
        return Promise.resolve(workspaceOverride);
      }
      if (typeof url === 'string' && url.includes('/api/v2/log/melt-lots/')) {
        bodies.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    await act(async () => {
      state.result.current.onSaveLot('lot-1');
    });

    await waitFor(() => expect(bodies.length).toBe(1));
    // Bayat taban gönderilir → sunucu updated_at'i farklı → stale_lot 409 döner.
    expect(bodies[0].expected_updated_at).toBe('2026-08-01T09:00:00Z');
  });
});
