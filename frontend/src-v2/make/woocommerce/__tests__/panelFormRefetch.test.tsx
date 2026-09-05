import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiRequestMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  toastMock: {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  TransportError: class TransportError extends Error {},
  localizeApiError: (error: unknown) => String(error),
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => toastMock,
}));

import { useWooMakeState } from '../useWooMakeState';

const rowBase = {
  lager_dato: '2026-09-01T00:00:00Z',
  saflik_label: '999',
  main_category: 'kulce',
  subcategory: null,
  adet: 1,
  producer: null,
  notes: null,
  reference_number: null,
  toplam_gram: '10',
  birim_gram: '10',
  alis_fiyati_dkk: '500',
  shop_fiyati_dkk: null,
  has_metal_grams: '9',
  is_published_to_site: false,
  shop_sync_status: 'hazir',
  is_gdpr_locked: false,
  photo_count: 0,
  primary_photo: null,
  status: 'in_inventory',
  product_type: 'bar',
  metal_type: 'yellow_gold',
};

function makeRow(id: string) {
  return { ...rowBase, id, product_number: id.toUpperCase(), urun: `Ürün ${id}` };
}

function makeDetail(id: string, shopPrice = '1250') {
  return {
    id,
    product_number: id.toUpperCase(),
    display_name: `Ürün ${id}`,
    shop_price_dkk: shopPrice,
    sale_price_dkk: shopPrice,
    purchase_price_dkk: '500',
    woo_markup_rate: null,
    woo_min_price_dkk: null,
    ai_description: `Sunucudaki mevcut AI açıklaması (${id}).`,
    woocommerce_category_ids: [],
    woocommerce_publish_profile: null,
    resolved_publish_profile: 'bar',
    production_year: null,
    is_published_to_site: false,
  };
}

let detailOne = makeDetail('prod-1');
let detailTwo = makeDetail('prod-2', '2500');

function routeRequest(url: string): unknown {
  if (url.startsWith('/api/v2/woocommerce/products/prod-1/history')) return [];
  if (url.startsWith('/api/v2/woocommerce/products/prod-2/history')) return [];
  if (url.startsWith('/api/v2/woocommerce/products/prod-1/sync-log')) return [];
  if (url.startsWith('/api/v2/woocommerce/products/prod-2/sync-log')) return [];
  if (url.startsWith('/api/v2/woocommerce/products/prod-1')) return detailOne;
  if (url.startsWith('/api/v2/woocommerce/products/prod-2')) return detailTwo;
  if (url.startsWith('/api/v2/woocommerce/workspace')) {
    return {
      rows: [makeRow('prod-1'), makeRow('prod-2')],
      summary: {
        total_products: 2,
        published_products: 0,
        draft_products: 2,
        unpublished_products: 0,
        photo_pending_products: 2,
      },
    };
  }
  if (url.startsWith('/api/v2/woocommerce/categories')) return { items: [], fetched_at: '', cached: false };
  if (url.startsWith('/api/v2/woocommerce/status')) {
    return {
      configured: false,
      reachable: false,
      remote_published_count: null,
      local_active_count: 0,
      local_inactive_count: 0,
      catalog_revision: 0,
      last_synced_at: null,
      checked_at: '',
      message: 'ok',
    };
  }
  if (url.startsWith('/api/v2/bootstrap')) return {};
  return {};
}

function renderWooState(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useWooMakeState(), { wrapper: Wrapper });
}

describe('useWooMakeState panel formu refetch koruması (A10)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((url: string) => Promise.resolve(routeRequest(String(url))));
    Object.values(toastMock).forEach((fn) => fn.mockReset());
    detailOne = makeDetail('prod-1');
    detailTwo = makeDetail('prod-2', '2500');
  });

  it('detay yüklendiğinde panel alanlarını sunucudan doldurur', async () => {
    const { result } = renderWooState('/woo?product=prod-1');

    await waitFor(() => expect(result.current.publishPrice).toBe('1250'));
    expect(result.current.aiDraft).toBe('Sunucudaki mevcut AI açıklaması (prod-1).');
    expect(result.current.publishProfile).toBe('bar');
  });

  it('aynı ürüne gelen refetch kaydedilmemiş fiyat ve AI taslağını EZMEZ', async () => {
    const { result } = renderWooState('/woo?product=prod-1');
    await waitFor(() => expect(result.current.publishPrice).toBe('1250'));

    act(() => {
      result.current.setPublishPrice('999');
      result.current.setAiDraft('Operatörün henüz kaydetmediği taslak.');
    });
    expect(result.current.publishPrice).toBe('999');

    // Sunucudaki veri değişti (ör. başka bir oturum / fotoğraf refetch'i).
    detailOne = { ...detailOne, shop_price_dkk: '7777', sale_price_dkk: '7777' };
    await act(async () => {
      await result.current.refreshWorkspace();
    });

    // Pozitif sinyal: refetch'ten gelen yeni sunucu verisi hook'a ulaştı.
    await waitFor(() => expect(result.current.detail?.shop_price_dkk).toBe('7777'));
    // Ama panel formu operatör değerlerinde kaldı.
    expect(result.current.publishPrice).toBe('999');
    expect(result.current.aiDraft).toBe('Operatörün henüz kaydetmediği taslak.');
  });

  it('ürün değişince panel alanları yeni ürünün sunucu verisiyle sıfırlanır', async () => {
    const { result } = renderWooState('/woo?product=prod-1');
    await waitFor(() => expect(result.current.publishPrice).toBe('1250'));

    act(() => {
      result.current.setPublishPrice('999');
    });

    act(() => {
      result.current.setSecilenId('prod-2');
    });

    // Pozitif sinyal: prod-2 verisi geldi (farklı fiyat).
    await waitFor(() => expect(result.current.publishPrice).toBe('2500'));
    expect(result.current.aiDraft).toBe('Sunucudaki mevcut AI açıklaması (prod-2).');
  });
});
