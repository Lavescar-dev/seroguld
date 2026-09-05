import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  buildWsUrl: (path: string) => `ws://test.local${path}`,
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

import { useDisplayPreviewMakeState } from '../useDisplayPreviewMakeState';
import type { PosDisplaySnapshot } from '@/types';

// M3 — hook'un WS karesi ve sorgu hatası yüzeyleri için hafif sahte WebSocket.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
}

function snapshotFixture(): PosDisplaySnapshot {
  return {
    session_code: 'DSPWS1',
    status: 'draft',
    trade_side: 'buy_from_customer',
    line_count: 0,
    lines: [],
    updated_at: '2026-09-05T10:00:00Z',
  };
}

function renderHookWithClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useDisplayPreviewMakeState(), { wrapper });
}

describe('useDisplayPreviewMakeState — hata yüzeyi ve son sinyal (M3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preview sorgusu hata mesajını sessizce yutmaz, previewError olarak yüzeye çıkarır', async () => {
    apiRequestMock.mockRejectedValue(new Error('Sunucuya ulaşılamadı'));
    const { result } = renderHookWithClient();

    await waitFor(() => expect(result.current.previewError).toBe('Sunucuya ulaşılamadı'));
    expect(result.current.token).toBe('');
  });

  it('WS karesi geldiğinde snapshot güncellenir ve lastMessageAt beslenir', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    apiRequestMock.mockResolvedValue({ display_token: 'tok-1', snapshot: null });
    const { result } = renderHookWithClient();

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({ type: 'display:init', data: snapshotFixture() }),
      });
    });

    expect(result.current.connection).toBe('live');
    expect(result.current.snapshot?.session_code).toBe('DSPWS1');
    expect(result.current.lastMessageAt).toBeTruthy();
  });
});
