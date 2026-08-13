import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';

import { registerPendingSaveHandler, resetPendingSaveDiscard } from '@/lib/saveCoordinator';
import { SessionLogoutControl } from '../SessionLogoutControl';

const desktopMocks = vi.hoisted(() => ({
  closeManagedExcelSession: vi.fn(async () => true),
  discardManagedExcelSession: vi.fn(async () => false),
  focusManagedExcelSession: vi.fn(async () => true),
  isTauriRuntime: vi.fn(() => true),
  setCustomerDisplayIdle: vi.fn(async () => null),
}));

vi.mock('@/lib/desktop', () => desktopMocks);

function renderLogoutControl() {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <SessionLogoutControl variant="modern" />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: ['/workspace'] },
  );
  render(<RouterProvider router={router} />);
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

describe('SessionLogoutControl', () => {
  let unregisterPendingSave: (() => void) | null = null;

  beforeEach(() => {
    desktopMocks.closeManagedExcelSession.mockReset();
    desktopMocks.closeManagedExcelSession.mockResolvedValue(true);
    desktopMocks.discardManagedExcelSession.mockReset();
    desktopMocks.discardManagedExcelSession.mockResolvedValue(false);
    desktopMocks.focusManagedExcelSession.mockReset();
    desktopMocks.focusManagedExcelSession.mockResolvedValue(true);
    desktopMocks.setCustomerDisplayIdle.mockReset();
    desktopMocks.setCustomerDisplayIdle.mockResolvedValue(null);
    desktopMocks.isTauriRuntime.mockReturnValue(true);
    sessionStorage.clear();
  });

  afterEach(() => {
    unregisterPendingSave?.();
    unregisterPendingSave = null;
    resetPendingSaveDiscard();
  });

  it('idles the customer display before navigating to login', async () => {
    renderLogoutControl();

    fireEvent.click(screen.getByRole('button', { name: 'Çıkış' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(desktopMocks.closeManagedExcelSession).toHaveBeenCalledTimes(1);
    expect(desktopMocks.setCustomerDisplayIdle).toHaveBeenCalledWith('modern', 'tr');
  });

  it('takes the discard path to login even when cleanup rejects', async () => {
    unregisterPendingSave = registerPendingSaveHandler('logout-test', async () => {
      throw new Error('pending workbook save');
    });
    desktopMocks.discardManagedExcelSession.mockRejectedValueOnce(new Error('Excel bridge unavailable'));
    desktopMocks.setCustomerDisplayIdle.mockRejectedValueOnce(new Error('display window unavailable'));
    renderLogoutControl();

    fireEvent.click(screen.getByRole('button', { name: 'Çıkış' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kaydetmeden çık' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    expect(desktopMocks.discardManagedExcelSession).toHaveBeenCalledTimes(1);
    expect(desktopMocks.setCustomerDisplayIdle).toHaveBeenCalledWith('modern', 'tr');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
