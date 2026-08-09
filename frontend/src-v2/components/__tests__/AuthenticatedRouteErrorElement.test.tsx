import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';

import { UiVariantProvider, createUiVariantStorage } from '@/ui-variants';
import type { UiVariantStorageLike } from '@/ui-variants';

import { AuthenticatedRouteErrorElement } from '../AuthenticatedRouteErrorElement';

const writeUiDiagnostic = vi.hoisted(() => vi.fn());

class MemoryStorage implements UiVariantStorageLike {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

vi.mock('@/lib/desktop', () => ({
  writeUiDiagnostic,
}));

function renderBrokenRoute(initialVariant: 'classic' | 'modern', storage: MemoryStorage, recoverAfterError = false) {
  let initialLocationKey: string | null = null;
  function BrokenRoute(): JSX.Element {
    const currentLocation = useLocation();
    initialLocationKey ??= currentLocation.key;
    if (!recoverAfterError || currentLocation.key === initialLocationKey) {
      throw new Error('queue mismatch');
    }
    return <div data-testid="route-recovered">Recovered route</div>;
  }

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <BrokenRoute />,
        errorElement: <AuthenticatedRouteErrorElement />,
      },
    ],
    { initialEntries: ['/'] },
  );

  render(
    <UiVariantProvider initialVariant={initialVariant} storage={createUiVariantStorage(storage)}>
      <RouterProvider router={router} />
    </UiVariantProvider>,
  );
}

describe('authenticated route error recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeUiDiagnostic.mockReset();
    writeUiDiagnostic.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows branded recovery UI instead of React Router raw error output', async () => {
    renderBrokenRoute('classic', new MemoryStorage());

    expect(await screen.findByRole('heading', { name: 'Bu ekran yüklenemedi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sayfayı yeniden yükle' })).toBeInTheDocument();
    expect(screen.queryByText('Unexpected Application Error!')).not.toBeInTheDocument();
    expect(screen.getByText('queue mismatch')).toBeInTheDocument();
    expect(writeUiDiagnostic).not.toHaveBeenCalled();
  });

  it('captures modern route failures and records the classic fallback', async () => {
    let resolveDiagnostic: ((value: null) => void) | undefined;
    writeUiDiagnostic.mockImplementationOnce(
      () => new Promise<null>((resolve) => {
        resolveDiagnostic = resolve;
      }),
    );

    const storage = new MemoryStorage();
    renderBrokenRoute('modern', storage, true);

    expect(await screen.findByRole('heading', { name: 'Bu ekran yüklenemedi' })).toBeInTheDocument();
    expect(writeUiDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'MODERN_ROUTE_RENDER_FAILURE' }));

    resolveDiagnostic?.(null);
    await waitFor(() => {
      expect(storage.getItem('seroguld.ui.variant.v1')).toBe('classic');
    });
    expect(await screen.findByTestId('route-recovered')).toBeInTheDocument();
  });
});
