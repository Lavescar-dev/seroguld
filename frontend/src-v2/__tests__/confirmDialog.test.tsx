import { describe, expect, it } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { ConfirmProvider, useConfirm } from '@/components/ConfirmDialog';

function Trigger() {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('—');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const ok = await confirm({
            title: 'Silmek istiyor musun?',
            message: 'Bu işlem geri alınamaz.',
            confirmText: 'Sil',
            cancelText: 'Vazgeç',
            variant: 'danger',
          });
          setResult(ok ? 'confirmed' : 'cancelled');
        }}
      >
        Tetikle
      </button>
      <span data-testid="result">{result}</span>
    </div>
  );
}

describe('ConfirmProvider', () => {
  it('resolves true when user clicks confirm', async () => {
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: /tetikle/i }).click();
    });
    expect(screen.getByText('Silmek istiyor musun?')).toBeInTheDocument();
    expect(screen.getByText('Bu işlem geri alınamaz.')).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: /^sil$/i }).click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('confirmed');
    });
  });

  it('resolves false when user clicks cancel', async () => {
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: /tetikle/i }).click();
    });
    act(() => {
      screen.getByRole('button', { name: /vazgeç/i }).click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('cancelled');
    });
  });

  it('resolves false when Escape pressed', async () => {
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: /tetikle/i }).click();
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('result').textContent).toBe('cancelled');
    });
  });
});
