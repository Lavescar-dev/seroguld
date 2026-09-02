import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModernDialog, ModernDrawer } from '../overlay';

type OverlayVariant = 'dialog' | 'drawer';

function OverlayHarness({ variant, open, onClose }: { variant: OverlayVariant; open: boolean; onClose: () => void }) {
  if (variant === 'drawer') {
    return (
      <ModernDrawer open={open} onClose={onClose} title="Deneme paneli">
        <button type="button" onClick={onClose}>İçerik kapat</button>
        <p>Panel gövdesi</p>
      </ModernDrawer>
    );
  }
  return (
    <ModernDialog open={open} onClose={onClose} title="Deneme diyaloğu" description="Kısa açıklama">
      <button type="button" onClick={onClose}>İçerik kapat</button>
      <p>Diyalog gövdesi</p>
    </ModernDialog>
  );
}

/** open state'ini gerçek bir tüketici gibi yöneten sarmalayıcı; kapanış da render'da doğrulanır. */
function StatefulOverlay({
  variant,
  onClose,
}: {
  variant: OverlayVariant;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <OverlayHarness
        variant={variant}
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      />
    </div>
  );
}

function focusSentinel() {
  const sentinel = document.createElement('button');
  sentinel.type = 'button';
  sentinel.textContent = 'önceki odak';
  document.body.appendChild(sentinel);
  sentinel.focus();
  expect(sentinel).toHaveFocus();
  return sentinel;
}

const CASES = [
  { variant: 'dialog' as const, title: 'Deneme diyaloğu', root: '.z-modal' },
  { variant: 'drawer' as const, title: 'Deneme paneli', root: '.z-drawer' },
];

afterEach(() => {
  document.body.querySelectorAll(':scope > button').forEach((node) => node.remove());
});

describe.each(CASES)('overlay ($variant)', ({ variant, title, root }) => {
  it('portals the overlay to document.body instead of the render container', () => {
    const { container, unmount } = render(<OverlayHarness variant={variant} open onClose={() => undefined} />);

    const panel = screen.getByRole('dialog', { name: title });
    expect(container.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    expect(document.querySelector(`${root}[class*="fixed"]`)).not.toBeNull();

    unmount();
    expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    expect(document.body.style.overflow).toBe('');
    const { unmount } = render(<OverlayHarness variant={variant} open onClose={() => undefined} />);

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<OverlayHarness variant={variant} open onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores keys other than Escape and Tab cycling does not escape', () => {
    const onClose = vi.fn();
    render(<OverlayHarness variant={variant} open onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(<OverlayHarness variant={variant} open onClose={onClose} />);

    const backdrop = document.querySelector(`${root} > .absolute.inset-0`);
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the first focusable element and restores it after close', async () => {
    const sentinel = focusSentinel();
    const onClose = vi.fn();
    render(<StatefulOverlay variant={variant} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: 'Kapat' });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument();

    await waitFor(() => expect(sentinel).toHaveFocus());
  });

  it('re-render focuses the typing field back (focus trap should only set up when open changes)', async () => {
    // Yeni müşteri formunda her tuş vuruşu state değiştirir; tüketici onClose'u
    // her render'da yeni arrow olarak geçirir. Effect onClose'a bağlı olsaydı
    // her karakterden sonra başlangıç odağı geri yazılırdı (saha bildirimi).
    function RerenderHarness() {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <span data-testid="tick">{tick}</span>
          <ModernDrawer open onClose={() => setTick((t) => t + 1)} title="Deneme paneli">
            <input aria-label="Ad" />
            <button type="button" onClick={() => setTick((t) => t + 1)}>Tazele</button>
          </ModernDrawer>
        </div>
      );
    }

    render(<RerenderHarness />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus());

    const input = screen.getByLabelText('Ad');
    input.focus();
    expect(input).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Tazele' }));
    expect(screen.getByTestId('tick')).toHaveTextContent('1');
    expect(input).toHaveFocus();
  });
});

describe('overlay closed state', () => {
  it.each(CASES)('renders nothing while $variant is closed', ({ variant }) => {
    render(<OverlayHarness variant={variant} open={false} onClose={() => undefined} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});
