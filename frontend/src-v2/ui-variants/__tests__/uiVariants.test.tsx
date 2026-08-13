import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '@/components/ConfirmDialog';

import {
  ClassicDiscoveryBanner,
  UiVariantBoundary,
  UiVariantProvider,
  UiVariantSettingsCards,
  UiVariantSwitchDialog,
  buildUiVariantRootFingerprint,
  createUiVariantStorage as createStorageAdapter,
  getUiVariantRootAttributes,
  readStoredUiVariant,
  UiVariantTransitionRegistry,
  useUiVariant,
} from '@/ui-variants';
import type { UiVariantStorageLike } from '@/ui-variants';

class MemoryStorage implements UiVariantStorageLike {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

function VariantStatus() {
  const { variant, notice } = useUiVariant();
  return (
    <div>
      <span data-testid="variant">{variant}</span>
      <span data-testid="notice">{notice?.message ?? '—'}</span>
      <span data-testid="notice-description">{notice?.description ?? '—'}</span>
    </div>
  );
}

function RequestModernButton() {
  const { requestVariantChange } = useUiVariant();
  return (
    <button type="button" onClick={() => requestVariantChange('modern')}>
      Modern iste
    </button>
  );
}

function ConfirmModernDirectly() {
  const { pendingRequest, requestVariantChange, confirmRequestedChange } = useUiVariant();

  useEffect(() => {
    if (pendingRequest?.intent.toVariant === 'modern') {
      void confirmRequestedChange();
    }
  }, [confirmRequestedChange, pendingRequest]);

  return (
    <button type="button" onClick={() => requestVariantChange('modern')}>
      Modern dogrudan
    </button>
  );
}

function CrashOnRender(): JSX.Element {
  throw new Error('Modern boom');
}

function VariantGate() {
  const { variant } = useUiVariant();
  return variant === 'modern' ? <CrashOnRender /> : <div>Classic ready</div>;
}

function ManualReturnProbe() {
  const { variant, reportModernBootstrapFailure, notice } = useUiVariant();
  useEffect(() => {
    if (variant === 'modern') {
      reportModernBootstrapFailure({
        hash: '#/log',
        supportPath: '/tmp/support.zip',
        diagnostic: {
          variant: 'modern',
          hash: '#/log',
          route: '/log',
          fingerprint: 'variant:modern',
          timestamp: new Date().toISOString(),
          error: { name: 'Error', message: 'x' },
        },
      });
    }
  }, [reportModernBootstrapFailure, variant]);

  return (
    <div>
      <span data-testid="probe-variant">{variant}</span>
      <span data-testid="probe-notice">{notice?.message ?? '—'}</span>
    </div>
  );
}

describe('ui variants', () => {
  it('defaults to modern when v3 is missing and ignores v1/v2 classic preferences', () => {
    const storage = new MemoryStorage();
    expect(readStoredUiVariant(storage)).toBe('modern');

    storage.setItem('seroguld.ui.variant.v1', 'classic');
    storage.setItem('seroguld.ui.variant.v2', 'classic');
    expect(readStoredUiVariant(storage)).toBe('modern');

    const adapter = createStorageAdapter(storage);
    adapter.writeVariant('modern');
    expect(readStoredUiVariant(storage)).toBe('modern');
    expect(storage.getItem('seroguld.ui.variant.v3')).toBe('modern');
    expect(storage.getItem('seroguld.ui.variant.v2')).toBe('classic');

    adapter.writeVariant('classic');
    expect(readStoredUiVariant(storage)).toBe('classic');
    expect(storage.getItem('seroguld.ui.variant.v3')).toBe('classic');

    expect(adapter.isModernBannerDismissed()).toBe(false);
    adapter.dismissModernBanner();
    expect(adapter.isModernBannerDismissed()).toBe(true);
  });

  it('renders exact confirmation copy and applies the chosen variant', async () => {
    const storage = new MemoryStorage();

    render(
      <ConfirmProvider>
        <UiVariantProvider initialVariant="classic" storage={createStorageAdapter(storage)}>
          <UiVariantSwitchDialog />
          <RequestModernButton />
          <VariantStatus />
        </UiVariantProvider>
      </ConfirmProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Modern iste' }).click();
    });

    expect(screen.getByText('Yeni Sero Guld arayüzüne geçilsin mi?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'İş akışları ve veriler değişmez. Açık taslaklarınız ve kaydedilmiş işlemleriniz korunur. İstediğiniz zaman Ayarlar > Görünüm bölümünden klasik arayüze dönebilirsiniz.',
      ),
    ).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Yeni arayüze geç' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('variant')).toHaveTextContent('modern');
    });
    expect(storage.getItem('seroguld.ui.variant.v3')).toBe('modern');
  });

  it('keeps the classic banner dismissed across provider remounts', async () => {
    const storage = new MemoryStorage();
    const adapter = createStorageAdapter(storage);
    const { unmount } = render(
      <UiVariantProvider initialVariant="classic" storage={adapter}>
        <ClassicDiscoveryBanner />
      </UiVariantProvider>,
    );

    expect(screen.getByText('Yeni Sero Guld hazır')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Şimdi değil' }).click();
    });
    expect(screen.queryByText('Yeni Sero Guld hazır')).not.toBeInTheDocument();

    unmount();

    render(
      <UiVariantProvider initialVariant="classic" storage={adapter}>
        <ClassicDiscoveryBanner />
      </UiVariantProvider>,
    );

    expect(screen.queryByText('Yeni Sero Guld hazır')).not.toBeInTheDocument();
  });

  it('flushes settling guards before applying the new variant', async () => {
    const storage = new MemoryStorage();
    const registry = new UiVariantTransitionRegistry();
    let dirty = true;

    registry.register({
      id: 'autosave',
      evaluate: () =>
        dirty
          ? { status: 'settling', reason: 'Kaydedilmemiş taslak tamamlanıyor.' }
          : { status: 'ready' },
      flush: async () => {
        dirty = false;
      },
    });

    render(
      <UiVariantProvider initialVariant="classic" storage={createStorageAdapter(storage)} registry={registry}>
        <ConfirmModernDirectly />
        <VariantStatus />
      </UiVariantProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Modern dogrudan' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('variant')).toHaveTextContent('modern');
    });
  });

  it('blocks variant changes when a guard refuses the transition', async () => {
    const storage = new MemoryStorage();
    const registry = new UiVariantTransitionRegistry();

    registry.register({
      id: 'finalize',
      evaluate: () => ({
        status: 'blocked',
        reason: 'Devam eden finalize işlemi tamamlanmadan geçiş yapılamaz.',
      }),
    });

    render(
      <UiVariantProvider initialVariant="classic" storage={createStorageAdapter(storage)} registry={registry}>
        <ConfirmModernDirectly />
        <VariantStatus />
      </UiVariantProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Modern dogrudan' }).click();
    });

    expect(screen.getByTestId('variant')).toHaveTextContent('classic');
    expect(screen.getByTestId('notice')).toHaveTextContent('Arayüz değişikliği şu anda tamamlanamadı.');
    expect(screen.getByTestId('notice-description')).toHaveTextContent(
      'Devam eden finalize işlemi tamamlanmadan geçiş yapılamaz.',
    );
  });

  it('builds root fingerprints and exposes root attributes on the boundary wrapper', () => {
    const fingerprint = buildUiVariantRootFingerprint({
      variant: 'modern',
      route: '/log',
      hash: '#/log',
      frontendMode: 'vite-dev',
      frontendBuiltAt: '2026-08-06T10:00:00Z',
    });
    expect(fingerprint).toContain('variant:modern');
    expect(fingerprint).toContain('route:/log');

    const attrs = getUiVariantRootAttributes({
      variant: 'classic',
      route: '/settings',
      hash: '#/settings',
    });
    expect(attrs['data-ui-variant']).toBe('classic');
    expect(attrs['data-ui-fingerprint']).toContain('route:/settings');

    render(
      <UiVariantProvider initialVariant="classic">
        <UiVariantBoundary autoReturnDelayMs={0}>
          <div>icerik</div>
        </UiVariantBoundary>
      </UiVariantProvider>,
    );

    const root = screen.getByText('icerik').parentElement;
    expect(root).toHaveAttribute('data-ui-variant', 'classic');
    expect(root?.getAttribute('data-ui-fingerprint')).toContain('variant:classic');
  });

  it('captures a sanitized modern boundary diagnostic, preserves hash, and waits for explicit classic choice', async () => {
    const storage = new MemoryStorage();
    const adapter = createStorageAdapter(storage);
    window.location.hash = '#/log';
    const capture = vi.fn().mockResolvedValue({ supportPath: '/tmp/support.zip' });

    render(
      <UiVariantProvider storage={adapter} initialVariant="modern">
        <UiVariantBoundary
          storage={adapter}
          diagnosticAdapter={{ capture }}
          autoReturnDelayMs={0}
        >
          <VariantGate />
        </UiVariantBoundary>
        <VariantStatus />
      </UiVariantProvider>,
    );

    expect(await screen.findByText('Yeni arayüz yüklenemedi')).toBeInTheDocument();
    expect(storage.getItem('seroguld.ui.variant.v3')).toBeNull();
    expect(window.location.hash).toBe('#/log');

    const diagnostic = capture.mock.calls[0]?.[0];
    expect(diagnostic.error.message).toBe('Modern boom');
    expect(diagnostic.hash).toBe('#/log');
    expect(diagnostic.fingerprint).toContain('variant:modern');

    expect(screen.getByRole('button', { name: 'Klasik arayüze dön' })).toBeInTheDocument();
    expect(screen.getByTestId('variant')).toHaveTextContent('modern');

    act(() => screen.getByRole('button', { name: 'Klasik arayüze dön' }).click());

    await waitFor(() => {
      expect(screen.getByTestId('variant')).toHaveTextContent('classic');
    });
    expect(screen.getByTestId('notice')).toHaveTextContent('Yeni arayüz başlatılamadı');
  });

  it('keeps modern selected after a reported failure until classic is chosen explicitly', async () => {
    render(
      <UiVariantProvider initialVariant="modern">
        <ManualReturnProbe />
      </UiVariantProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('probe-variant')).toHaveTextContent('modern'));
    expect(screen.getByTestId('probe-notice')).toHaveTextContent('Yeni arayüz başlatılamadı');
  });

  it('renders settings cards with classic and preview labels', () => {
    render(
      <UiVariantProvider initialVariant="classic">
        <UiVariantSettingsCards />
      </UiVariantProvider>,
    );

    expect(screen.getByText('Klasik Sero Guld')).toBeInTheDocument();
    expect(screen.getByText('Yeni Sero Guld (Önizleme)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni arayüzü dene' })).toBeInTheDocument();
  });
});
