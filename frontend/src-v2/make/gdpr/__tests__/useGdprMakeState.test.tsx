import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  localizeApiError: (e: unknown) => String(e),
  downloadAuthedDocument: vi.fn(),
}));

import { useGdprMakeState } from '../useGdprMakeState';

function renderGdprState(initialEntries: string[] = ['/gdpr']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/gdpr" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return renderHook(() => useGdprMakeState(), { wrapper: Wrapper });
}

function requestsCalls(): string[] {
  return apiRequestMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url === '/api/v2/gdpr/requests' || url.startsWith('/api/v2/gdpr/requests?'));
}

describe('useGdprMakeState filtreleri (searchParams -> apiRequest URL)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue([]);
  });

  it('?status=open icin requests ucunu status=open query string ile cagirir', async () => {
    const { result } = renderGdprState(['/gdpr?status=open']);

    await waitFor(() => expect(requestsCalls()).toContain('/api/v2/gdpr/requests?status=open'));

    expect(result.current.statusFilter).toBe('open');
    expect(result.current.customerFilter).toBeNull();
  });

  it('status ve customer parametrelerini customer_id olarak query stringe tasir', async () => {
    const { result } = renderGdprState(['/gdpr?status=identity_pending&customer=C-7']);

    await waitFor(() =>
      expect(requestsCalls()).toContain('/api/v2/gdpr/requests?status=identity_pending&customer_id=C-7'),
    );

    expect(result.current.statusFilter).toBe('identity_pending');
    expect(result.current.customerFilter).toBe('C-7');
  });

  it('filtre yokken requests ucunu query stringsiz cagirir', async () => {
    renderGdprState(['/gdpr']);

    await waitFor(() => expect(requestsCalls()).toContain('/api/v2/gdpr/requests'));

    const plainCalls = requestsCalls().filter((url) => url === '/api/v2/gdpr/requests');
    expect(plainCalls.length).toBeGreaterThan(0);
  });

  it('setStatusFilter URL i gunceller ve yeni query string ile tekrar cagirir', async () => {
    const { result } = renderGdprState(['/gdpr?status=open']);

    await waitFor(() => expect(requestsCalls()).toContain('/api/v2/gdpr/requests?status=open'));

    act(() => {
      result.current.setStatusFilter('closed');
    });

    await waitFor(() => expect(result.current.statusFilter).toBe('closed'));
    await waitFor(() => expect(requestsCalls()).toContain('/api/v2/gdpr/requests?status=closed'));
  });

  it('clearCustomerFilter customer filtresini kaldirir', async () => {
    const { result } = renderGdprState(['/gdpr?status=open&customer=C-7']);

    await waitFor(() =>
      expect(requestsCalls()).toContain('/api/v2/gdpr/requests?status=open&customer_id=C-7'),
    );

    act(() => {
      result.current.clearCustomerFilter();
    });

    await waitFor(() => expect(result.current.customerFilter).toBeNull());
    await waitFor(() => expect(requestsCalls()).toContain('/api/v2/gdpr/requests?status=open'));
  });
});
