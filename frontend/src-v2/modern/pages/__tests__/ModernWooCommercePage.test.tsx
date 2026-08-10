import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModernWooCommercePage } from '../ModernWooCommercePage';

const items = Array.from({ length: 30 }, (_, index) => ({
  id: `product-${index}`,
  title: `Ürün ${index}`,
  sku: `SKU-${index}`,
  status: 'IN_INVENTORY',
  metal: 'Gold',
  weightLabel: '1 g',
  priceLabel: '100,00 kr.',
  publishState: 'Taslak',
  tone: 'warning' as const,
}));

describe('ModernWooCommercePage', () => {
  it('paginates larger product lists without losing the selected detail surface', () => {
    render(
      <ModernWooCommercePage
        availability={{ state: 'available' }}
        items={items}
        readiness={[]}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /^Aç$/ })).toHaveLength(25);
    expect(screen.getByText('Ürünler 1–25 / 30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Sonraki$/ }));

    expect(screen.getAllByRole('button', { name: /^Aç$/ })).toHaveLength(5);
    expect(screen.getByText('Ürünler 26–30 / 30')).toBeInTheDocument();
  });
});
