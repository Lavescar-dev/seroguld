import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
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

import { ConfirmProvider } from '@/components/ConfirmDialog';
import { useWooMakeState } from '../useWooMakeState';

const rowBase = {
  lager_dato: '2026-09-01T00:00:00Z',
  saflik_label: '999',
  main_category: 'taki',
  subcategory: null,
  adet: 1,
  producer: null,
  notes: null,
  reference_number: 'S0001',
  toplam_gram: '2',
  birim_gram: '2',
  alis_fiyati_dkk: '900',
  shop_fiyati_dkk: null,
  has_metal_grams: '1.4',
  is_published_to_site: false,
  shop_sync_status: 'hazir',
  is_gdpr_locked: false,
  photo_count: 0,
  primary_photo: null,
  status: 'in_inventory',
  product_type: 'necklace',
  metal_type: 'yellow_gold',
};

function makeRow(id: string) {
  return { ...rowBase, id, product_number: id.toUpperCase(), urun: `Ürün ${id}` };
}

function makeDetail(id: string, photos: unknown[] = [], aiDescription: string | null = null) {
  return {
    id,
    product_number: id.toUpperCase(),
    reference_number: 'S0001',
    display_name: `Testove TESTSEN halskæde ${id}`,
    product_type: 'necklace',
    metal_type: 'yellow_gold',
    weight_grams: '2.39',
    purity_percentage: '58.5',
    unit_count: 1,
    purchase_price_dkk: '900',
    shop_price_dkk: '1250',
    sale_price_dkk: '1250',
    woo_markup_rate: null,
    woo_min_price_dkk: null,
    length_cm: '45,00cm',
    ai_description: aiDescription,
    ai_description_approved: false,
    woocommerce_category_ids: [],
    woocommerce_publish_profile: null,
    resolved_publish_profile: 'jewelry',
    production_year: null,
    is_published_to_site: false,
    photos,
    manual_review_required: false,
  };
}

// AI üretiminin döndürdüğü foto sayacı: sunucudaki ai-describe yanıt alanı.
let imagesAnalyzedInResponse = 0;
let detailPhotos: unknown[] = [];

function aiPostCalls() {
  return apiRequestMock.mock.calls.filter(
    ([url, options]) =>
      String(url).endsWith('/ai') && (options as { method?: string } | undefined)?.method === 'POST',
  );
}

function routeRequest(url: string, method: string | undefined): unknown {
  if (method === 'POST' && String(url).endsWith('/ai')) {
    return {
      ...makeDetail('prod-1', detailPhotos, 'SEO_TITLE: Testove TESTSEN halskæde'),
      images_analyzed: imagesAnalyzedInResponse,
    };
  }
  if (url.startsWith('/api/v2/woocommerce/products/prod-1/history')) return [];
  if (url.startsWith('/api/v2/woocommerce/products/prod-1/sync-log')) return [];
  if (url.startsWith('/api/v2/woocommerce/products/prod-1')) return makeDetail('prod-1', detailPhotos);
  if (url.startsWith('/api/v2/woocommerce/workspace')) {
    return {
      rows: [makeRow('prod-1')],
      summary: { total_products: 1, published_products: 0, draft_products: 1, unpublished_products: 0, photo_pending_products: 1 },
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
  // ConfirmProvider ile sarılır: useConfirm gerçek diyaloğu kurar (window.confirm
  // fallback'i değil) — böylece "emin misiniz?" akışı uçtan uca test edilir.
  return renderHook(() => useWooMakeState(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ConfirmProvider>
        <Wrapper initialEntry={initialEntry}>{children}</Wrapper>
      </ConfirmProvider>
    ),
  });
}

describe('useWooMakeState AI üretim onayı (foto yoksa "emin misiniz?")', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((url: string, options?: { method?: string }) =>
      Promise.resolve(routeRequest(url, options?.method)),
    );
    Object.values(toastMock).forEach((fn) => fn.mockReset());
    detailPhotos = [];
    imagesAnalyzedInResponse = 0;
  });

  it('fotoğraf YOKSA onay diyaloğu açar, İptal istek atmaz, Üret derse üretir', async () => {
    detailPhotos = [];
    const { result } = renderWooState('/woo?product=prod-1');
    await waitFor(() => expect(result.current.detail?.id).toBe('prod-1'));

    act(() => {
      result.current.generateAi();
    });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Fotoğraf yok: açıklama yalnız ürün özelliklerinden oluşturulacak.');
    expect(aiPostCalls()).toHaveLength(0);

    // İptal → üretme.
    fireEvent.click(screen.getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(aiPostCalls()).toHaveLength(0);

    // Aynı diyalogda Üret → tek üretim isteği.
    act(() => {
      result.current.generateAi();
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Üret' }));
    await waitFor(() => expect(aiPostCalls()).toHaveLength(1));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('AI açıklaması üretildi'));
  });

  it('fotoğraf VARSA onay sormadan direkt üretir', async () => {
    detailPhotos = [{ id: 'photo-1', url: '/media/foto-1.jpg', filename: 'foto-1.jpg' }];
    const { result } = renderWooState('/woo?product=prod-1');
    await waitFor(() => expect(result.current.detail?.id).toBe('prod-1'));

    act(() => {
      result.current.generateAi();
    });

    await waitFor(() => expect(aiPostCalls()).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fotoğraflı üründe images_analyzed=0 dönerse uyarı verir (sessiz metin-only yok)', async () => {
    detailPhotos = [
      { id: 'photo-1', url: '/media/foto-1.jpg', filename: 'foto-1.jpg' },
      { id: 'photo-2', url: '/media/foto-2.jpg', filename: 'foto-2.jpg' },
    ];
    imagesAnalyzedInResponse = 0;
    const { result } = renderWooState('/woo?product=prod-1');
    await waitFor(() => expect(result.current.detail?.id).toBe('prod-1'));

    act(() => {
      result.current.generateAi();
    });

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith('Fotoğraflar okunamadı — açıklama yalnız özelliklerden üretildi.'));
    expect(toastMock.success).not.toHaveBeenCalledWith('AI açıklaması üretildi');
  });

  it('images_analyzed>0 ise normal başarı bildirimi gelir', async () => {
    detailPhotos = [{ id: 'photo-1', url: '/media/foto-1.jpg', filename: 'foto-1.jpg' }];
    imagesAnalyzedInResponse = 1;
    const { result } = renderWooState('/woo?product=prod-1');
    await waitFor(() => expect(result.current.detail?.id).toBe('prod-1'));

    act(() => {
      result.current.generateAi();
    });

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('AI açıklaması üretildi'));
    expect(toastMock.warning).not.toHaveBeenCalled();
  });
});
