import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '@/components/ConfirmDialog';
import { apiRequest } from '@/lib/api';

import { DEFAULT_CONFIG, isSettingsConfigDirty, useSettingsMakeState } from '../useSettingsMakeState';
import type { ApiConfig } from '../types';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
  localizeApiError: (error: unknown) => (error instanceof Error ? error.message : 'bilinmeyen hata'),
}));

const apiRequestMock = vi.mocked(apiRequest);

const SERVER_CONFIG: ApiConfig = {
  ...DEFAULT_CONFIG,
  firma_adi: 'Sero Guld og Sølv ApS',
  market_gold: '615.50',
  secret_fields_configured: ['openai_api_key', 'uniconta_password'],
};

function serverConfig(): ApiConfig {
  return { ...SERVER_CONFIG, secret_fields_configured: [...(SERVER_CONFIG.secret_fields_configured ?? [])] };
}

type SettingsState = ReturnType<typeof useSettingsMakeState>;

let latestState: SettingsState | null = null;

// Not: i18n çalışma zamanı görünen metinleri çevirdiği için probe düğmeleri
// erişilebilirlik adıyla değil, kararlı data-testid ile sorgulanır.
function Probe() {
  latestState = useSettingsMakeState();
  return (
    <div>
      {/* i18n metin çevirisi test metnini de çevirdiğinden durum attribute ile taşınır. */}
      <span
        data-testid="mode"
        data-mode={latestState.isLoading ? 'loading' : latestState.isError ? 'error' : 'ready'}
      />
      <button type="button" data-testid="save-btn" onClick={() => latestState?.onSave()}>
        save
      </button>
      <button type="button" data-testid="reset-btn" onClick={() => latestState?.onReset()}>
        reset
      </button>
      <button type="button" data-testid="export-btn" onClick={() => latestState?.onExport()}>
        export
      </button>
      <button type="button" data-testid="import-btn" onClick={() => void latestState?.onImport()}>
        import
      </button>
      <button type="button" data-testid="edit-btn" onClick={() => latestState?.onUpdate('market_gold', '9999')}>
        edit
      </button>
      <button type="button" data-testid="retry-btn" onClick={() => latestState?.onRetryLoad()}>
        retry
      </button>
    </div>
  );
}

function renderSettingsState() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/settings', element: <Probe /> },
      { path: '/other', element: <div>other-page</div> },
    ],
    { initialEntries: ['/settings'] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  return { router };
}

function putCalls(): Array<ApiConfig> {
  return apiRequestMock.mock.calls
    .filter(([path, options]) => path === '/api/v2/settings' && (options as RequestInit | undefined)?.method === 'PUT')
    .map(([, options]) => JSON.parse(String((options as RequestInit).body)) as ApiConfig);
}

beforeEach(() => {
  apiRequestMock.mockReset();
  latestState = null;
});

describe('isSettingsConfigDirty', () => {
  it('returns false for equal configs and true for any field change', () => {
    const server = serverConfig();
    expect(isSettingsConfigDirty(server, { ...server })).toBe(false);
    expect(isSettingsConfigDirty(server, { ...server, market_gold: '9999' })).toBe(true);
    expect(isSettingsConfigDirty(server, { ...server, afg_email_enabled: true })).toBe(true);
    // secret_fields_configured dizi içeriği de karşılaştırılır.
    expect(isSettingsConfigDirty(server, { ...server, secret_fields_configured: [] })).toBe(true);
  });
});

describe('DEFAULT_CONFIG market fallbacks', () => {
  it('align with the backend market_rate_profile defaults, not a stale frontend copy', () => {
    // backend market_rate_profile.py: DEFAULT_GOLD_DKK=615.50, DEFAULT_SILVER_DKK=7.80
    expect(DEFAULT_CONFIG.market_gold).toBe('615.50');
    expect(DEFAULT_CONFIG.market_silver).toBe('7.80');
  });
});

describe('useSettingsMakeState', () => {
  it('reports loading and keeps reset/export locked until the real config arrives', async () => {
    apiRequestMock.mockImplementation(() => new Promise(() => {}));
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('loading'));
    expect(latestState?.isReady).toBe(false);

    // Yükleme bitmeden yazma yolları hiçbir istek Tetiklemez.
    fireEvent.click(screen.getByTestId('reset-btn'));
    fireEvent.click(screen.getByTestId('export-btn'));
    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'PUT'),
      ).toHaveLength(0);
    });
    // Onay diyaloğu da açılmaz.
    expect(screen.queryByText(/fabrika değerlerine döndürülsün/)).not.toBeInTheDocument();
  });

  it('exposes the load error and never opens the default-config write path on failure', async () => {
    apiRequestMock.mockRejectedValueOnce(new Error('bağlantı kurulamadı'));
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('error'));
    expect(latestState?.isError).toBe(true);
    expect(latestState?.loadErrorMessage).toBe('bağlantı kurulamadı');

    // HIGH fix: hatalı yüklemede Kaydet/Sıfırla/İçe aktar üretim ayarını EZEMEZ.
    fireEvent.click(screen.getByTestId('reset-btn'));
    fireEvent.click(screen.getByTestId('save-btn'));
    await waitFor(() => expect(putCalls()).toHaveLength(0));
    expect(screen.queryByText(/fabrika değerlerine döndürülsün/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('retry-btn'));
    await waitFor(() => expect(apiRequestMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('asks via useConfirm before resetting and writes DEFAULT_CONFIG only on confirm', async () => {
    apiRequestMock.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === 'PUT') return Promise.resolve(serverConfig());
      return Promise.resolve(serverConfig());
    });
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    fireEvent.click(screen.getByTestId('reset-btn'));

    // Sıfırlama onayı diyalogsuz yazmaz.
    expect(putCalls()).toHaveLength(0);
    expect(await screen.findByText(/fabrika değerlerine döndürülsün/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sıfırla' }));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    // Gövde DEFAULT_CONFIG'tir (sunucu yanıtıyla değil).
    expect(putCalls()[0]).toEqual(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  });

  it('cancelling the reset confirm leaves the config untouched', async () => {
    apiRequestMock.mockResolvedValue(serverConfig());
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    fireEvent.click(screen.getByTestId('reset-btn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Vazgeç' }));

    await waitFor(() => expect(screen.queryByText(/fabrika değerlerine döndürülsün/)).not.toBeInTheDocument());
    expect(putCalls()).toHaveLength(0);
  });

  it('flags the draft dirty after an edit', async () => {
    apiRequestMock.mockResolvedValue(serverConfig());
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    expect(latestState?.isDirty).toBe(false);
    fireEvent.click(screen.getByTestId('edit-btn'));
    expect(latestState?.isDirty).toBe(true);
  });

  it('blocks navigation with unsaved changes and can stay on the page', async () => {
    apiRequestMock.mockResolvedValue(serverConfig());
    const { router } = renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    fireEvent.click(screen.getByTestId('edit-btn'));

    await waitFor(() => expect(latestState?.isDirty).toBe(true));
    await waitFor(() => {
      router.navigate('/other').catch(() => {});
    });
    expect(await screen.findByText(/Kaydedilmemiş değişiklikler var/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kal' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(screen.queryByText('other-page')).not.toBeInTheDocument();
  });

  it('proceeds on confirmed navigation with unsaved changes', async () => {
    apiRequestMock.mockResolvedValue(serverConfig());
    const { router } = renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    fireEvent.click(screen.getByTestId('edit-btn'));
    await waitFor(() => expect(latestState?.isDirty).toBe(true));
    await waitFor(() => {
      router.navigate('/other').catch(() => {});
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Değişiklikleri bırak' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/other');
    });
    expect(screen.getByText('other-page')).toBeInTheDocument();
  });

  it('does not block navigation when nothing is dirty', async () => {
    apiRequestMock.mockResolvedValue(serverConfig());
    const { router } = renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    await waitFor(() => {
      router.navigate('/other').catch(() => {});
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    expect(screen.getByText('other-page')).toBeInTheDocument();
    expect(screen.queryByText(/Kaydedilmemiş değişiklikler var/)).not.toBeInTheDocument();
  });

  it('asks before an import overwrites the saved config and aborts on cancel', async () => {
    apiRequestMock.mockResolvedValue(serverConfig());
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('import-btn'));

    // Temiz formda bile içe aktarma ezme onayı olmadan ilerlemez.
    expect(await screen.findByText(/kayıtlı ayarların üzerine yazacak/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));

    await waitFor(() => expect(clickSpy).not.toHaveBeenCalled());
    expect(putCalls()).toHaveLength(0);
    clickSpy.mockRestore();
  });

  it('imports a settings file after confirmation and puts the merged config', async () => {
    apiRequestMock.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === 'PUT') return Promise.resolve({ ...serverConfig(), market_silver: '9.9' });
      return Promise.resolve(serverConfig());
    });
    renderSettingsState();

    await waitFor(() => expect(screen.getByTestId('mode').dataset.mode).toBe('ready'));

    // Dosya seçici + FileReader'ı taklit et: onchange dosya seçilmiş gibi tetiklenir.
    const realCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      options?: ElementCreationOptions,
    ) => {
      const element = realCreateElement(tag, options);
      if (tag === 'input') {
        queueMicrotask(() => {
          element.onchange?.({ target: { files: [new File(['{}'], 'settings.json')] } } as unknown as Event);
        });
      }
      return element;
    }) as typeof document.createElement);
    class FakeFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      readAsText() {
        this.onload?.({ target: { result: JSON.stringify({ market_silver: '9.9' }) } });
      }
    }
    vi.stubGlobal('FileReader', FakeFileReader);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    try {
      fireEvent.click(screen.getByTestId('import-btn'));
      fireEvent.click(await screen.findByRole('button', { name: 'Devam et' }));

      await waitFor(() => expect(putCalls()).toHaveLength(1));
      // DEFAULT_CONFIG ile birleştirilir ve PUT gövdesine yazılır.
      expect(putCalls()[0].market_silver).toBe('9.9');
      expect(putCalls()[0].openai_model).toBe(DEFAULT_CONFIG.openai_model);
      // Başarıda form, sunucu yanıtına göre güncellenir.
      await waitFor(() => expect(latestState?.config.market_silver).toBe('9.9'));
    } finally {
      vi.unstubAllGlobals();
      clickSpy.mockRestore();
      createElementSpy.mockRestore();
    }
  });
});
