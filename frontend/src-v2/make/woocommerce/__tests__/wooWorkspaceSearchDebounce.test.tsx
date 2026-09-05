import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  toastMock: {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  TransportError: class TransportError extends Error {},
  localizeApiError: (error: unknown) => String(error),
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => toastMock,
}));

import { useWooMakeState } from '../useWooMakeState';

function routeRequest(): unknown {
  return {
    rows: [],
    summary: {
      total_products: 0,
      published_products: 0,
      draft_products: 0,
      unpublished_products: 0,
      photo_pending_products: 0,
    },
  };
}

function renderWooState() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/woo']}>
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useWooMakeState(), { wrapper: Wrapper });
}

describe('useWooMakeState workspace arama debounce (M3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(() => routeRequest());
  });

  it('her tuşvuruşu anında workspace fetch tetiklemez; debounced tek istek gider', async () => {
    const { result } = renderWooState();
    await waitFor(() => expect(result.current.loadingWorkspace).toBe(false));

    act(() => {
      result.current.setSearch('ring');
    });

    // Debounce penceresinde (300ms) hemen istek ATILMAZ.
    const immediate = apiRequestMock.mock.calls.filter(([url]) => String(url).includes('q=ring'));
    expect(immediate).toHaveLength(0);

    await waitFor(
      () => {
        const calls = apiRequestMock.mock.calls.filter(([url]) => String(url).includes('q=ring'));
        expect(calls).toHaveLength(1);
        expect(String(calls[0][0])).toContain('q=ring');
      },
      { timeout: 1500 },
    );
  });

  it('ardışık tuşvuruşları tek isteğe iner', async () => {
    const { result } = renderWooState();
    await waitFor(() => expect(result.current.loadingWorkspace).toBe(false));

    act(() => {
      result.current.setSearch('r');
      result.current.setSearch('ri');
      result.current.setSearch('rin');
      result.current.setSearch('ring');
    });

    await waitFor(
      () => {
        const calls = apiRequestMock.mock.calls.filter(([url]) => String(url).includes('q='));
        expect(calls).toHaveLength(1);
      },
      { timeout: 1500 },
    );
  });
});
