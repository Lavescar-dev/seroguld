import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UiVariantProvider } from '@/ui-variants';
import { DisplayIdlePage } from '@/pages/DisplayIdlePage';
import { DisplayPage } from '@/pages/DisplayPage';

vi.mock('@/make/display/useDisplayLiveMakeState', () => ({
  useDisplayLiveMakeState: () => ({
    snapshot: null,
    connection: 'connecting' as const,
  }),
}));

vi.mock('@/make/display/useDisplayIdleMakeState', () => ({
  useDisplayIdleMakeState: () => ({
    embedded: false,
    now: new Date('2026-08-06T12:00:00Z'),
  }),
}));

describe('display route variant wiring', () => {
  it('marks the live display page with the active variant', () => {
    render(
      <UiVariantProvider initialVariant="modern">
        <DisplayPage />
      </UiVariantProvider>,
    );

    expect(screen.getByTestId('customer-display-page')).toHaveAttribute('data-display-ui-variant', 'modern');
  });

  it('marks the idle display page with the active variant', () => {
    render(
      <UiVariantProvider initialVariant="classic">
        <DisplayIdlePage />
      </UiVariantProvider>,
    );

    expect(screen.getByTestId('customer-display-idle-page')).toHaveAttribute('data-display-ui-variant', 'classic');
  });
});
