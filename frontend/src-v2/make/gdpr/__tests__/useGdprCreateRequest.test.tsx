import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  localizeApiError: (e: unknown) => String(e),
  downloadAuthedDocument: vi.fn(),
}));

import { useGdprCreateRequest, type GdprCreateRequestPayload } from '../useGdprCreateRequest';

const payload: GdprCreateRequestPayload = {
  request_type: 'access',
  subject_name: 'Ayse Yilmaz',
  subject_email: 'ayse@example.com',
  message: 'Verilerimi gormek istiyorum.',
};

const createdOut = { id: 'req-1', status: 'identity_pending', channel: 'public_page' };

function renderCreateRequestMutation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { ...renderHook(() => useGdprCreateRequest(), { wrapper: Wrapper }), invalidateSpy };
}

describe('useGdprCreateRequest', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue(createdOut);
  });

  it('public request ucune auth:false ile POST atar ve govdeye accepted_privacy:true ekler', async () => {
    const { result } = renderCreateRequestMutation();

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock.mock.calls[0][0]).toBe('/api/v2/public/gdpr/request');

    const options = apiRequestMock.mock.calls[0][1] as Record<string, unknown>;
    expect(options).toBeDefined();
    expect(options.method).toBe('POST');
    expect(options.auth).toBe(false);

    const body = JSON.parse(String(options.body));
    expect(body).toEqual({ ...payload, accepted_privacy: true });

    expect(result.current.data).toEqual(createdOut);
  });

  it('basarida 3 queryKey invalidate eder: overview, requests, jobs', async () => {
    const { result, invalidateSpy } = renderCreateRequestMutation();

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(3));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['gdpr-overview']);
    expect(invalidatedKeys).toContainEqual(['gdpr-requests']);
    expect(invalidatedKeys).toContainEqual(['gdpr-jobs']);
  });

  it('hata durumunda invalidate tetiklemez ve isError olur', async () => {
    apiRequestMock.mockRejectedValueOnce(new Error('Talep olusturulamadi'));
    const { result, invalidateSpy } = renderCreateRequestMutation();

    await act(async () => {
      await expect(result.current.mutateAsync(payload)).rejects.toThrow('Talep olusturulamadi');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });
});
