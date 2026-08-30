import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DockableCustomerNotesPanel } from '../DockableCustomerNotesPanel';

vi.mock('@/components/CustomerNotesPanel', () => ({
  CustomerNotesPanel: () => <div data-testid="notes-panel-body" />,
}));

describe('DockableCustomerNotesPanel — roadmap madde 1 overlay izolasyonu', () => {
  it('varsayılan KAPALI başlar: yalnız yuvarlak buton görünür, sheet editörlerini kapatmaz', () => {
    render(<DockableCustomerNotesPanel customerId="c1" customerName="Test Müşteri" />);
    const pill = screen.getByRole('button', { name: /müşteri notlarını aç/i });
    expect(pill).toHaveClass('z-dropdown');
    expect(screen.queryByTestId('notes-panel-body')).not.toBeInTheDocument();
  });

  it('açınca panel gövdesi gösterir, küçültünce tekrar butona döner', () => {
    render(<DockableCustomerNotesPanel customerId="c1" customerName="Test Müşteri" />);
    fireEvent.click(screen.getByRole('button', { name: /müşteri notlarını aç/i }));
    expect(screen.getByTestId('notes-panel-body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /küçült/i }));
    expect(screen.queryByTestId('notes-panel-body')).not.toBeInTheDocument();
  });
});
