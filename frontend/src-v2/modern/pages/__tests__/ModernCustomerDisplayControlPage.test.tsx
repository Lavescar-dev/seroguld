import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModernCustomerDisplayControlPage } from '../ModernCustomerDisplayControlPage';
import type { ModernCustomerDisplayControlPageProps } from '../types';

function baseProps(overrides: Partial<ModernCustomerDisplayControlPageProps> = {}): ModernCustomerDisplayControlPageProps {
  return {
    status: { connection: 'live', windowState: 'open', token: 'token-1234' },
    snapshot: null,
    runtime: [],
    previewAvailability: { state: 'available' },
    ...overrides,
  };
}

describe('ModernCustomerDisplayControlPage — token revoke', () => {
  it('canlı token varken revoke aksiyonunu başlık satırında gösterir', () => {
    const onRevoke = vi.fn();
    render(<ModernCustomerDisplayControlPage {...baseProps()} onRevoke={onRevoke} />);

    const button = screen.getByRole('button', { name: /tokenı geri al/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('token yokken revoke butonu devre dışı kalır', () => {
    const onRevoke = vi.fn();
    render(
      <ModernCustomerDisplayControlPage
        {...baseProps({
          status: { connection: 'offline', windowState: 'closed', token: null },
          previewAvailability: { state: 'readonly', title: 'Aktif display token bekleniyor' },
        })}
        onRevoke={onRevoke}
      />,
    );

    expect(screen.getByRole('button', { name: /tokenı geri al/i })).toBeDisabled();
    expect(screen.getByText(/aktif display token bekleniyor/i)).toBeInTheDocument();
  });

  it('revoke isteği sürerken butonu kilitler', () => {
    render(<ModernCustomerDisplayControlPage {...baseProps()} onRevoke={() => undefined} revokingToken />);

    expect(screen.getByRole('button', { name: /geri alınıyor/i })).toBeDisabled();
  });
});
