import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UiVariantProvider } from '@/ui-variants';
import { PosPage } from '@/pages/PosPage';

const { createModernAlisViewModel, alisState, registeredGuards } = vi.hoisted(() => ({
  createModernAlisViewModel: vi.fn(() => ({
    blocker: null,
  })),
  alisState: {
    workspace: null,
    pdfState: { url: null, filename: '', loading: false, error: null },
    onClosePdfModal: vi.fn(),
    hasPendingWorkspaceSync: vi.fn(() => true),
    flushPendingWorkspaceSync: vi.fn(async () => undefined),
  },
  registeredGuards: [] as Array<{ evaluate: () => unknown; flush: () => Promise<void> }>,
}));

vi.mock('@/ui-variants', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@/ui-variants')>();
  return {
    ...original,
    uiVariantTransitionRegistry: {
      register: vi.fn((guard) => {
        registeredGuards.push(guard);
        return () => undefined;
      }),
    },
  };
});

vi.mock('@/make/alis/useAlisMakeState', () => ({
  useAlisMakeState: () => alisState,
}));

vi.mock('@/modern/adapters', () => ({
  createModernAlisViewModel,
}));

vi.mock('@/modern/modules', () => ({
  ModernAlisModule: () => <div data-testid="modern-alis-module" />,
}));

vi.mock('@/lib/desktop', () => ({
  ensureCustomerDisplayWindow: vi.fn(async () => null),
  getDesktopMonitorSetup: vi.fn(async () => null),
  isDesktopDisplayRouteMatch: vi.fn(() => false),
  setCustomerDisplayIdle: vi.fn(async () => null),
}));

describe('PosPage variant guard wiring', () => {
  it('settles and flushes pending Alış workspace sync', async () => {
    render(
      <UiVariantProvider initialVariant="modern">
        <PosPage />
      </UiVariantProvider>,
    );

    expect(createModernAlisViewModel).toHaveBeenCalledWith(alisState);
    const guard = registeredGuards.at(-1);
    expect(guard?.evaluate()).toEqual(expect.objectContaining({ status: 'settling' }));
    await guard?.flush();
    expect(alisState.flushPendingWorkspaceSync).toHaveBeenCalled();
  });
});
