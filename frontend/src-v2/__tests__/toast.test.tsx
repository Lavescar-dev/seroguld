import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { ToastProvider, useToast } from '@/lib/toast';

function TriggerButton({ message }: { message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.success(message, 'Test detayı')}>
      Tetikle
    </button>
  );
}

describe('ToastProvider', () => {
  it('renders success toast when triggered', () => {
    render(
      <ToastProvider>
        <TriggerButton message="Test mesajı" />
      </ToastProvider>,
    );

    const btn = screen.getByRole('button', { name: /tetikle/i });
    act(() => {
      btn.click();
    });

    expect(screen.getByText('Test mesajı')).toBeInTheDocument();
    expect(screen.getByText('Test detayı')).toBeInTheDocument();
  });

  it('returns a graceful-fallback toast object when used outside provider', () => {
    let captured: ReturnType<typeof useToast> | null = null;
    function OutsideConsumer() {
      captured = useToast();
      return null;
    }
    render(<OutsideConsumer />);
    expect(captured).not.toBeNull();
    expect(typeof captured!.success).toBe('function');
    expect(typeof captured!.error).toBe('function');
  });
});
