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

describe('ModernCustomerDisplayControlPage — durum etiketleri ve son sinyal (M3)', () => {
  it('connection ve windowState ham enum olarak basılmaz, yerelleştirilmiş etiket gösterilir', () => {
    render(
      <ModernCustomerDisplayControlPage
        {...baseProps({
          status: { connection: 'connecting', windowState: 'blocked', token: 'token-1234' },
        })}
      />,
    );

    expect(screen.getByText('Bağlanıyor')).toBeInTheDocument();
    expect(screen.getByText('Engelli')).toBeInTheDocument();
    expect(screen.queryByText('connecting')).not.toBeInTheDocument();
    expect(screen.queryByText('blocked')).not.toBeInTheDocument();
  });

  it('köprü yanıtı yokken pencere durumu nötr Bilinmiyor etiketine düşer', () => {
    // 'unknown' köprü değeri props tipinde kilitli union'a cast ile taşınır;
    // sayfa bilinmeyen değeri 'Kapalı' SANMADAN nötr göstermek zorunda.
    const unknownState = 'unknown' as unknown as 'open' | 'closed' | 'blocked';
    render(
      <ModernCustomerDisplayControlPage
        {...baseProps({
          status: { connection: 'offline', windowState: unknownState, token: null },
        })}
      />,
    );

    expect(screen.getByText('Bilinmiyor')).toBeInTheDocument();
    expect(screen.getByText('Beklemede')).toBeInTheDocument();
  });

  it('son sinyal karesi varken zamanı gösterir, kalıcı Henüz sinyal yok basmaz', () => {
    render(
      <ModernCustomerDisplayControlPage
        {...baseProps({
          status: { connection: 'live', windowState: 'open', token: 'token-1234', lastHeartbeat: '2026-09-05T10:00:00Z' },
        })}
      />,
    );

    expect(screen.getByText('Son sinyal')).toBeInTheDocument();
    expect(screen.queryByText('Henüz sinyal yok')).not.toBeInTheDocument();
    expect(screen.queryByText('Bağlantı yok')).not.toBeInTheDocument();
  });

  it('canlı bağlantıda sinyal henüz yokken bağlantı durumuna göre dürüst metin basar', () => {
    render(
      <ModernCustomerDisplayControlPage
        {...baseProps({
          status: { connection: 'live', windowState: 'open', token: 'token-1234', lastHeartbeat: null },
        })}
      />,
    );

    expect(screen.getByText('Bağlı — ilk sinyal bekleniyor')).toBeInTheDocument();
  });

  it('bağlantı yokken son sinyal kartı Bağlantı yok der', () => {
    render(
      <ModernCustomerDisplayControlPage
        {...baseProps({
          status: { connection: 'offline', windowState: 'closed', token: null, lastHeartbeat: null },
        })}
      />,
    );

    expect(screen.getByText('Bağlantı yok')).toBeInTheDocument();
  });
});
