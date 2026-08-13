import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { mapWooYayin, resolveWooSelectedProductId, type WooMakeState } from '@/make/woocommerce/useWooMakeState';
import type { InventoryGridRow, ProductOut } from '@/types';

import { ModernWooCommercePage } from '../ModernWooCommercePage';

const items = Array.from({ length: 30 }, (_, index) => ({
  id: `product-${index}`,
  urunNo: `SKU-${index}`,
  durum: 'Satışta',
  tip: 'Bar' as const,
  metal: 'Altın' as const,
  agirlik: 1,
  ayar: 999,
  alimFiyati: 100,
  safMetal: 1,
  satici: '',
  gdprKilitli: false,
  satisHasJiyati: 100,
  wooYayin: 'Taslak' as const,
  wooId: null,
  depoStokId: `stock-${index}`,
  stokNo: `SKU-${index}`,
  productTypeRaw: 'bar',
  metalTypeRaw: 'yellow_gold',
  shopDurumuRaw: 'hazir',
  urun: `Ürün ${index}`,
  fotoCount: 0,
  hasPhoto: false,
  aiHazir: false,
  aiOnaylandi: false,
}));

const state = {
  urunler: items,
  secilenId: items[0].id,
  secilen: items[0],
  detail: null,
  search: '',
  filter: 'all',
  workspaceSummary: { total_products: 30, published_products: 0, draft_products: 30, unpublished_products: 0, photo_pending_products: 30 },
  stokList: [],
  aiDraft: '',
  publishPrice: '100',
  rawOpen: false,
  isCreatingProduct: false,
  loadingWorkspace: false,
  workspaceError: null,
  catalogSearch: '',
  setCatalogSearch: vi.fn(),
  catalogPageNumber: 1,
  setCatalogPageNumber: vi.fn(),
  catalogStatus: {
    configured: true,
    reachable: true,
    remote_published_count: 466,
    local_active_count: 1,
    local_inactive_count: 0,
    catalog_revision: 2,
    last_synced_at: '2026-08-13T04:00:00Z',
    checked_at: '2026-08-13T04:00:00Z',
    message: 'ok',
  },
  catalog: {
    items: [{
      id: 'catalog-1',
      woocommerce_product_id: 42,
      name: 'Canlı Woo Ürünü',
      slug: 'canli-woo-urunu',
      sku: 'WOO-42',
      permalink: 'https://example.com/product/42',
      remote_status: 'publish',
      catalog_visibility: 'visible',
      stock_status: 'instock',
      stock_quantity: 3,
      price_dkk: '1250',
      regular_price_dkk: '1250',
      sale_price_dkk: null,
      weight_raw: '10',
      weight_grams: '10',
      weight_missing: false,
      manual_review_required: false,
      manual_review_reasons: [],
      photo_missing: false,
      image_count: 1,
      images: [],
      categories: [{ name: 'Altın' }],
      is_active: true,
      linked_product_id: null,
      remote_created_at: null,
      remote_modified_at: null,
      first_seen_at: '2026-08-13T04:00:00Z',
      last_seen_at: '2026-08-13T04:00:00Z',
      updated_at: '2026-08-13T04:00:00Z',
    }],
    page: 1,
    page_size: 50,
    total: 1,
    total_pages: 1,
    catalog_revision: 2,
  },
  catalogPreview: null,
  catalogLoading: false,
  catalogError: null,
  isPreviewingCatalog: false,
  isApplyingCatalog: false,
  refreshCatalog: vi.fn(async () => undefined),
  previewCatalogSync: vi.fn(),
  applyCatalogSync: vi.fn(),
} as unknown as WooMakeState;

const detail = {
  id: 'product-0',
  product_number: 'SKU-0',
  display_name: 'Ürün 0',
  product_type: 'bar',
  metal_type: 'yellow_gold',
  weight_grams: '1',
  purity_percentage: '99.9',
  pure_gold_grams: '1',
  unit_count: 1,
  purchase_date: '2026-01-01T00:00:00Z',
  purchase_price_dkk: '100',
  gdpr_release_date: '2026-01-15T00:00:00Z',
  is_gdpr_locked: false,
  status: 'for_sale',
  ai_description: 'SEO_TITLE: Ürün 0 | Sero Guld\nURL_SLUG: urun-0\nSHORT_DESCRIPTION: Kısa açıklama\nMETA_DESCRIPTION: Meta açıklama\nLONG_DESCRIPTION_HTML: <p>Uzun</p>',
  ai_description_approved: true,
  is_published_to_site: false,
  photos: [],
  manual_review_required: false,
  needs_cleaning: false,
} as ProductOut;

function makeDetailedState() {
  return {
    ...state,
    detail,
    loadingDetail: false,
    detailError: null,
    refreshWorkspace: vi.fn(async () => undefined),
    setSearch: vi.fn(),
    setFilter: vi.fn(),
    setSecilenId: vi.fn(),
    setPublishPrice: vi.fn(),
    setAiDraft: vi.fn(),
    setRawOpen: vi.fn(),
    generateAi: vi.fn(),
    saveAi: vi.fn(),
    approveManualReview: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    syncSale: vi.fn(),
    uploadPhotos: vi.fn(),
    deletePhoto: vi.fn(),
    createProductFromDraft: vi.fn(async () => null),
  } as unknown as WooMakeState;
}

describe('ModernWooCommercePage', () => {
  it('uses the persisted publication flag as the single publication source', () => {
    expect(mapWooYayin({ is_published_to_site: true, shop_sync_status: null } as unknown as InventoryGridRow)).toBe('Yayında');
    expect(mapWooYayin({ is_published_to_site: false, shop_sync_status: 'hazir' } as unknown as InventoryGridRow)).toBe('Taslak');
    expect(mapWooYayin({ is_published_to_site: false, shop_sync_status: null } as unknown as InventoryGridRow)).toBe('Yayınlanmadı');
    expect(mapWooYayin({ is_published_to_site: false, shop_sync_status: 'listelendi' } as unknown as InventoryGridRow)).toBe('Yayınlanmadı');
  });

  it('keeps the URL-selected product instead of reverting to the previous row', () => {
    expect(resolveWooSelectedProductId('product-1', items)).toBe('product-1');
    expect(resolveWooSelectedProductId('missing', items)).toBe('product-0');
  });

  it('paginates larger product lists without losing the selected detail surface', () => {
    render(<ModernWooCommercePage state={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'CRM ürünleri' }));

    expect(screen.getAllByRole('button', { name: /^SKU-/ })).toHaveLength(25);
    expect(screen.getByText('Ürünler 1–25 / 30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Sonraki$/ }));

    expect(screen.getAllByRole('button', { name: /^SKU-/ })).toHaveLength(5);
    expect(screen.getByText('Ürünler 26–30 / 30')).toBeInTheDocument();
  });

  it('keeps product operations visible in the modern workspace', () => {
    const detailedState = makeDetailedState();
    render(<ModernWooCommercePage state={detailedState} />);

    fireEvent.click(screen.getByRole('button', { name: 'CRM ürünleri' }));

    expect(screen.getByText('Yayın hazırlığı')).toBeInTheDocument();
    expect(screen.getAllByText('Shop —').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Satış kontrolü/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yeni ürün/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Fotoğraf$/ }));
    expect(screen.getByText('Ürün fotoğrafları')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^AI & SEO$/ }));
    expect(screen.getByRole('button', { name: /AI açıklama üret/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /AI açıklama üret/ }));
    expect(detailedState.generateAi).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Yeni ürün/ }));
    expect(screen.getByText('Yeni ürün oluştur')).toBeInTheDocument();
    expect(screen.getByText('Ürün kaynağı')).toBeInTheDocument();
  });

  it('opens on the separate live Woo catalog and requires an explicit sync action', () => {
    const catalogState = { ...state, previewCatalogSync: vi.fn() } as unknown as WooMakeState;
    render(<ModernWooCommercePage state={catalogState} />);

    expect(screen.getByText('Canlı Woo Ürünü')).toBeInTheDocument();
    expect(screen.getByText('466')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Woo’dan senkronize et/ }));
    expect(catalogState.previewCatalogSync).toHaveBeenCalledTimes(1);
  });
});
