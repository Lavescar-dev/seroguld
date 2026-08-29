import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { ApiError, apiRequest } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { describeRejectedPhotos, validatePhotoFiles } from './photoUpload';
import type {
  DesktopBootstrap,
  InventoryGridRow,
  ProductHistoryEntry,
  ProductOut,
  ProductPublishResponse,
  WooRawResponse,
  WooSyncLogEntry,
  WooWorkspace,
  WooWorkspaceSummary,
} from '@/types';

export type Metal = 'Altın' | 'Gümüş' | 'Platin' | 'Palladyum';
export type UrunTip = 'Bar' | 'Mønt' | 'Smykke' | 'Medalje' | 'Granül';
export type WooYayinDurum = 'Yayında' | 'Taslak' | 'Yayınlanmadı';
export type WooFilter = 'all' | 'published' | 'draft' | 'unpublished';
export type MainKat = 'kulce' | 'sikke' | 'taki' | 'gumus' | 'platin_pd';
export type SilverSub = 'smykker' | 'barrer' | 'monter';
export type PlatinumSub = 'platin' | 'palladyum';

export const wooCatalogQueryKeys = {
  root: ['woocommerce-catalog'] as const,
  status: ['woocommerce-catalog', 'status'] as const,
  list: (page: number, search: string) => ['woocommerce-catalog', 'list', { page, search }] as const,
};

export function isCatalogPreviewInvalidatedError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 403);
}

export interface SeoData {
  title: string;
  slug: string;
  kisaAciklama: string;
  meta: string;
  uzunAciklama: string;
}

export interface DraftPhoto {
  id: string;
  name: string;
  url: string;
  file: File;
  birincil: boolean;
}

export interface StokItem {
  id: string;
  stokNo?: string;
  mainKat: MainKat;
  gumusAlt?: SilverSub;
  platinAlt?: PlatinumSub;
  lagerDato: string;
  urun: string;
  saflik: number;
  birimGram: number;
  adet: number;
  alisFiyati: number;
  shopFiyati?: number;
  shopDurumu?: 'hazir' | 'mangler_foto' | 'listelendi';
  uretici?: string;
  notlar?: string;
}

export interface WooListItem {
  id: string;
  urunNo: string;
  durum: string;
  tip: UrunTip;
  metal: Metal;
  agirlik: number;
  ayar: number;
  alimFiyati: number;
  /** Persisted shop price only; unlike the legacy draft field this never falls back to purchase price. */
  shopFiyati?: number;
  safMetal: number;
  satici: string;
  gdprKilitli: boolean;
  satisHasJiyati: number;
  wooYayin: WooYayinDurum;
  wooId?: number | null;
  depoStokId?: string;
  stokNo?: string;
  productTypeRaw: string;
  metalTypeRaw: string;
  shopDurumuRaw?: string | null;
  urun: string;
  fotoCount: number;
  hasPhoto: boolean;
  aiHazir: boolean;
  aiOnaylandi: boolean;
}

export interface NewWooProductDraft {
  kaynak: 'depo' | 'manuel' | null;
  secilenStokId: string | null;
  urunAdi: string;
  metal: Metal;
  tip: UrunTip;
  agirlik: string;
  ayar: string;
  alimFiyati: string;
  satisHasJiyati: string;
  satici: string;
  uretici: string;
  gdprKilitli: boolean;
  stokNo: string;
  adet: string;
  aiAciklama: string;
  aiOnaylandi: boolean;
  seo: SeoData;
  fotograflar: DraftPhoto[];
  wooYayin: WooYayinDurum;
  notlar: string;
  kategoriIds: number[];
}

export interface WooCatalogStatus {
  configured: boolean;
  reachable: boolean;
  remote_published_count: number | null;
  local_active_count: number;
  local_inactive_count: number;
  catalog_revision: number;
  last_synced_at: string | null;
  checked_at: string;
  message: string;
}

export interface WooCatalogItem {
  id: string;
  woocommerce_product_id: number;
  name: string;
  slug: string;
  sku: string | null;
  permalink: string | null;
  remote_status: string;
  catalog_visibility: string | null;
  stock_status: string | null;
  stock_quantity: number | null;
  price_dkk: string | number | null;
  regular_price_dkk: string | number | null;
  sale_price_dkk: string | number | null;
  weight_raw: string | null;
  weight_grams: string | number | null;
  weight_missing: boolean;
  manual_review_required: boolean;
  manual_review_reasons: string[];
  photo_missing: boolean;
  image_count: number;
  images: Array<{ id?: number; src?: string; name?: string; alt?: string }>;
  categories: Array<{ id?: number; name?: string; slug?: string }>;
  is_active: boolean;
  linked_product_id: string | null;
  remote_created_at: string | null;
  remote_modified_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

export interface WooCatalogPage {
  items: WooCatalogItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  catalog_revision: number;
}

export interface WooCatalogSyncSummary {
  remote_published_count: number;
  create_count: number;
  update_count: number;
  unchanged_count: number;
  deactivate_count: number;
  weight_missing_count: number;
  manual_review_count: number;
  photo_missing_count: number;
}

export interface WooCatalogSyncPreview {
  preview_revision: string;
  base_revision: number;
  expires_at: string;
  summary: WooCatalogSyncSummary;
  warnings: string[];
}

export interface WooCategory {
  id: number;
  name: string;
  slug: string | null;
  parent: number;
  count: number;
  depth: number;
}

export interface WooCategoriesPayload {
  items: WooCategory[];
  fetched_at: string;
  cached: boolean;
}

export interface WooCatalogItemDetail extends WooCatalogItem {
  description_html: string | null;
  short_description_html: string | null;
  seo_title: string | null;
  meta_description: string | null;
}

export interface WooMakeState {
  search: string;
  setSearch: (value: string) => void;
  filter: WooFilter;
  setFilter: (value: WooFilter) => void;
  urunler: WooListItem[];
  secilenId: string | null;
  setSecilenId: (value: string | null) => void;
  secilen: WooListItem | null;
  detail: ProductOut | null;
  history: ProductHistoryEntry[];
  syncLog: WooSyncLogEntry[];
  rawData: WooRawResponse | null;
  rawOpen: boolean;
  setRawOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  publishPrice: string;
  setPublishPrice: (value: string) => void;
  aiDraft: string;
  setAiDraft: (value: string) => void;
  stokList: StokItem[];
  workspaceSummary: WooWorkspaceSummary;
  bootstrap: DesktopBootstrap | undefined;
  loadingWorkspace: boolean;
  workspaceError: string | null;
  loadingDetail: boolean;
  detailError: string | null;
  isGeneratingAi: boolean;
  isSavingAi: boolean;
  isApprovingReview: boolean;
  isPublishing: boolean;
  isUnpublishing: boolean;
  isSyncing: boolean;
  isUploadingPhotos: boolean;
  isDeletingPhoto: boolean;
  isCreatingProduct: boolean;
  refreshWorkspace: () => Promise<void>;
  generateAi: () => void;
  saveAi: (approved: boolean) => void;
  approveManualReview: () => void;
  publish: () => void;
  unpublish: () => void;
  syncSale: () => void;
  uploadPhotos: (files: File[]) => void;
  deletePhoto: (photoId: string) => void;
  createProductFromDraft: (draft: NewWooProductDraft) => Promise<ProductOut | null>;
  catalogSearch: string;
  setCatalogSearch: (value: string) => void;
  catalogPageNumber: number;
  setCatalogPageNumber: (value: number) => void;
  catalog: WooCatalogPage | null;
  catalogStatus: WooCatalogStatus | null;
  catalogPreview: WooCatalogSyncPreview | null;
  catalogLoading: boolean;
  catalogError: string | null;
  isPreviewingCatalog: boolean;
  isApplyingCatalog: boolean;
  refreshCatalog: () => Promise<void>;
  previewCatalogSync: () => void;
  applyCatalogSync: () => void;
  categories: WooCategory[];
  categoriesLoading: boolean;
  categoriesError: string | null;
  refreshCategories: () => Promise<void>;
  publishCategoryIds: number[];
  publishProfile: string;
  setPublishProfile: (value: string) => void;
  publishYear: string;
  setPublishYear: (value: string) => void;
  // R1-21: "Nyhed" rozeti checkbox'ı (30 gün; süre backend ayarından).
  publishNewBadge: boolean;
  setPublishNewBadge: (value: boolean) => void;
  setPublishCategoryIds: (ids: number[]) => void;
  togglePublishCategory: (id: number) => void;
  catalogDetailId: string | null;
  openCatalogDetail: (id: string | null) => void;
  catalogDetail: WooCatalogItemDetail | null;
  catalogDetailLoading: boolean;
  linkCatalogItem: (catalogItemId: string, productId: string) => void;
  unlinkCatalogItem: (catalogItemId: string) => void;
  unpublishCatalogItem: (catalogItemId: string) => void;
  // R1-16: cekmeceden icerik duzenleme (Woo'ya yazar)
  updateCatalogContent: (catalogItemId: string, body: WooCatalogContentUpdate) => Promise<boolean>;
  // R1-10: panelin GÜNCEL (kaydedilmemiş dahil) durumuyla yayın önizlemesi
  fetchPublishPreview: () => Promise<WooPublishPreview | null>;
  isCatalogActionPending: boolean;
}

// R1-10: yayın öncesi şablon önizleme yanıtı (backend publish-preview).
export type WooPublishPreview = {
  name: string | null;
  slug: string | null;
  regular_price: string | null;
  sku: string | null;
  categories: { id: number }[];
  short_description: string | null;
  description: string | null;
  attributes: { name?: string; options?: string[] }[];
  warnings: string[];
};

export type WooCatalogContentUpdate = {
  name?: string | null;
  short_description_html?: string | null;
  description_html?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
};

export function resolveWooSelectedProductId(
  requestedProductId: string | null,
  items: Array<Pick<WooListItem, 'id'>>,
): string | null {
  if (requestedProductId && items.some((item) => item.id === requestedProductId)) return requestedProductId;
  return items[0]?.id ?? null;
}

export function emptySeoData(): SeoData {
  return {
    title: '',
    slug: '',
    kisaAciklama: '',
    meta: '',
    uzunAciklama: '',
  };
}

export function defaultNewWooProductDraft(): NewWooProductDraft {
  return {
    kaynak: null,
    secilenStokId: null,
    urunAdi: '',
    metal: 'Altın',
    tip: 'Bar',
    agirlik: '',
    ayar: '999',
    alimFiyati: '',
    satisHasJiyati: '',
    satici: '',
    uretici: '',
    gdprKilitli: false,
    stokNo: '',
    adet: '1',
    aiAciklama: '',
    aiOnaylandi: false,
    seo: emptySeoData(),
    fotograflar: [],
    wooYayin: 'Taslak',
    notlar: '',
    kategoriIds: [],
  };
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractApiMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

function parsePurityToRatio(row: InventoryGridRow) {
  if (row.purity_percentage) {
    const percentage = numeric(row.purity_percentage);
    if (percentage > 0) return percentage / 100;
  }
  const match = row.saflik_label.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return 0.999;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return 0.999;
  if (amount > 100) return amount / 1000;
  return amount / 100;
}

function parseAyar(row: InventoryGridRow) {
  if (row.purity_percentage) {
    const percentage = numeric(row.purity_percentage);
    if (percentage > 0) return Math.round(percentage * 10);
  }
  const label = row.saflik_label.toLowerCase();
  if (label.includes('24k')) return 999;
  if (label.includes('22k')) return 916;
  if (label.includes('21k')) return 875;
  if (label.includes('18k')) return 750;
  if (label.includes('14k')) return 585;
  if (label.includes('8k')) return 333;
  const match = row.saflik_label.match(/(\d{3,4})/);
  if (match) return Number(match[1].slice(0, 3));
  return 999;
}

function mapMetal(row: InventoryGridRow): Metal {
  if (row.main_category === 'gumus' || row.metal_type === 'silver') return 'Gümüş';
  if (row.metal_type === 'platinum') return 'Platin';
  if (row.metal_type === 'palladium') return 'Palladyum';
  return 'Altın';
}

function mapTip(row: InventoryGridRow): UrunTip {
  if (row.main_category === 'kulce' || row.subcategory === 'barrer' || row.product_type === 'bar') return 'Bar';
  if (row.main_category === 'sikke' || row.subcategory === 'monter') return 'Mønt';
  return 'Smykke';
}

export function mapWooYayin(row: InventoryGridRow): WooYayinDurum {
  if (row.is_published_to_site) return 'Yayında';
  if (row.shop_sync_status === 'hazir') return 'Taslak';
  return 'Yayınlanmadı';
}

function mapDurum(row: InventoryGridRow): string {
  if (row.status === 'for_sale') return 'Satışta';
  if (row.status === 'draft') return 'Taslak';
  if (row.status === 'sold') return 'Satıldı';
  return row.status;
}

function rowToStokItem(row: InventoryGridRow): StokItem {
  return {
    id: row.id,
    stokNo: row.reference_number || row.product_number,
    mainKat: row.main_category as MainKat,
    gumusAlt: row.main_category === 'gumus' ? ((row.subcategory || 'smykker') as SilverSub) : undefined,
    platinAlt: row.main_category === 'platin_pd' ? ((row.subcategory || 'platin') as PlatinumSub) : undefined,
    lagerDato: row.lager_dato.slice(0, 10),
    urun: row.urun,
    saflik: parsePurityToRatio(row),
    birimGram: numeric(row.birim_gram),
    adet: row.adet || 1,
    alisFiyati: numeric(row.alis_fiyati_dkk),
    shopFiyati: row.shop_fiyati_dkk ? numeric(row.shop_fiyati_dkk) : undefined,
    shopDurumu: (row.shop_sync_status as StokItem['shopDurumu']) || undefined,
    uretici: row.producer || undefined,
    notlar: row.notes || undefined,
  };
}

function rowToWooListItem(row: InventoryGridRow): WooListItem {
  return {
    id: row.id,
    urunNo: row.product_number,
    durum: mapDurum(row),
    tip: mapTip(row),
    metal: mapMetal(row),
    agirlik: numeric(row.toplam_gram || row.birim_gram),
    ayar: parseAyar(row),
    alimFiyati: numeric(row.alis_fiyati_dkk),
    shopFiyati: row.shop_fiyati_dkk == null ? undefined : numeric(row.shop_fiyati_dkk),
    safMetal: numeric(row.has_metal_grams),
    satici: '',
    gdprKilitli: row.is_gdpr_locked,
    satisHasJiyati: numeric(row.shop_fiyati_dkk || row.alis_fiyati_dkk),
    wooYayin: mapWooYayin(row),
    wooId: null,
    depoStokId: row.id,
    stokNo: row.reference_number || row.product_number,
    productTypeRaw: row.product_type,
    metalTypeRaw: row.metal_type,
    shopDurumuRaw: row.shop_sync_status,
    urun: row.urun,
    fotoCount: Number(row.photo_count || 0),
    hasPhoto: Boolean(row.primary_photo || row.photo_count),
    aiHazir: Boolean(row.has_ai_description),
    aiOnaylandi: Boolean(row.ai_description_approved),
  };
}

function prefillFromStock(base: NewWooProductDraft, stock: StokItem): NewWooProductDraft {
  const metal: Metal =
    stock.mainKat === 'gumus' ? 'Gümüş' : stock.mainKat === 'platin_pd' ? (stock.platinAlt === 'palladyum' ? 'Palladyum' : 'Platin') : 'Altın';
  const tip: UrunTip =
    stock.mainKat === 'kulce' || stock.gumusAlt === 'barrer'
      ? 'Bar'
      : stock.mainKat === 'sikke' || stock.gumusAlt === 'monter'
        ? 'Mønt'
        : 'Smykke';
  return {
    ...base,
    kaynak: 'depo',
    secilenStokId: stock.id,
    urunAdi: stock.urun,
    metal,
    tip,
    agirlik: String(stock.birimGram || ''),
    ayar: String(Math.round(stock.saflik * 1000) || 999),
    alimFiyati: String(stock.alisFiyati || ''),
    satisHasJiyati: stock.shopFiyati != null ? String(stock.shopFiyati) : String(stock.alisFiyati || ''),
    uretici: stock.uretici || '',
    stokNo: stock.stokNo || '',
    adet: String(stock.adet || 1),
    notlar: stock.notlar || '',
  };
}

function categorySpec(draft: NewWooProductDraft) {
  if (draft.metal === 'Gümüş') {
    return {
      inventory_category: 'gumus',
      inventory_subcategory: draft.tip === 'Bar' ? 'barrer' : draft.tip === 'Mønt' ? 'monter' : 'smykker',
      product_type: draft.tip === 'Bar' ? 'bar' : 'jewelry',
      metal_type: 'silver',
    };
  }

  if (draft.metal === 'Platin' || draft.metal === 'Palladyum') {
    return {
      inventory_category: 'platin_pd',
      inventory_subcategory: draft.metal === 'Palladyum' ? 'palladyum' : 'platin',
      product_type: 'bar',
      metal_type: draft.metal === 'Palladyum' ? 'palladium' : 'platinum',
    };
  }

  if (draft.tip === 'Bar') {
    return {
      inventory_category: 'kulce',
      inventory_subcategory: null,
      product_type: 'bar',
      metal_type: 'yellow_gold',
    };
  }

  if (draft.tip === 'Mønt') {
    return {
      inventory_category: 'sikke',
      inventory_subcategory: null,
      product_type: 'jewelry',
      metal_type: 'yellow_gold',
    };
  }

  return {
    inventory_category: 'taki',
    inventory_subcategory: null,
    product_type: 'jewelry',
    metal_type: 'yellow_gold',
  };
}

function toCreatePayload(draft: NewWooProductDraft) {
  const spec = categorySpec(draft);
  const ayar = numeric(draft.ayar);
  const agirlik = numeric(draft.agirlik);
  const adet = Math.max(1, Math.round(numeric(draft.adet) || 1));
  const notes = [draft.notlar.trim(), draft.seo.meta.trim() ? `SEO: ${draft.seo.meta.trim()}` : '']
    .filter(Boolean)
    .join('\n');

  return {
    reference_number: draft.stokNo.trim() || null,
    display_name: draft.urunAdi.trim() || null,
    product_type: spec.product_type,
    metal_type: spec.metal_type,
    weight_grams: agirlik,
    purity_karat: spec.metal_type === 'yellow_gold' && ayar ? `${Math.round((ayar / 1000) * 24)}K` : null,
    purity_percentage: ayar ? ayar / 10 : null,
    unit_count: adet,
    purchase_date: new Date().toISOString(),
    purchase_price_dkk: numeric(draft.alimFiyati),
    seller_new: draft.satici.trim() ? { name: draft.satici.trim() } : null,
    notes: notes || null,
    shop_price_dkk: numeric(draft.satisHasJiyati) || null,
    producer: draft.uretici.trim() || null,
    inventory_category: spec.inventory_category,
    inventory_subcategory: spec.inventory_subcategory,
    photos: [],
  };
}

export function useWooMakeState(): WooMakeState {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WooFilter>('all');
  const [publishPrice, setPublishPrice] = useState('');
  const [aiDraft, setAiDraft] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [catalogSearch, setCatalogSearchState] = useState('');
  // Arama sorgusu ~300ms debounce ile koşar; input anında, istek sakin.
  const [debouncedCatalogSearch, setDebouncedCatalogSearch] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedCatalogSearch(catalogSearch.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [catalogSearch]);
  const [catalogPageNumber, setCatalogPageNumber] = useState(1);
  const [catalogPreview, setCatalogPreview] = useState<WooCatalogSyncPreview | null>(null);
  const [publishCategoryIds, setPublishCategoryIds] = useState<number[]>([]);
  const [publishProfile, setPublishProfile] = useState<string>('');
  const [publishYear, setPublishYear] = useState<string>('');
  // R1-21: ilk yayın varsayılanı işaretli; republish'te ürünün mevcut durumuna göre.
  const [publishNewBadge, setPublishNewBadge] = useState<boolean>(true);
  // Operatör bu oturumda kutuya dokundu mu? Dokunmadıysa republish rozete
  // DOKUNMAZ (null gönderilir) — refetch'ler seçimi ezmesin diye ürün
  // değişiminde sıfırlanır.
  const [publishNewBadgeTouched, setPublishNewBadgeTouched] = useState(false);
  const badgeProductIdRef = useRef<string | null>(null);
  const [catalogDetailId, setCatalogDetailId] = useState<string | null>(null);

  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => apiRequest<DesktopBootstrap>('/api/v2/bootstrap'),
  });

  const workspaceQuery = useQuery({
    queryKey: ['woocommerce', 'workspace', search],
    queryFn: () =>
      apiRequest<WooWorkspace>(`/api/v2/woocommerce/workspace${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`),
  });

  const catalogStatusQuery = useQuery({
    queryKey: wooCatalogQueryKeys.status,
    queryFn: () => apiRequest<WooCatalogStatus>('/api/v2/woocommerce/status'),
    staleTime: 60_000,
  });

  const catalogQuery = useQuery({
    queryKey: wooCatalogQueryKeys.list(catalogPageNumber, debouncedCatalogSearch),
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(catalogPageNumber),
        page_size: '50',
      });
      if (debouncedCatalogSearch) params.set('q', debouncedCatalogSearch);
      return apiRequest<WooCatalogPage>(`/api/v2/woocommerce/catalog?${params.toString()}`);
    },
    // Sayfa/arama değişiminde önceki sayfa görünür kalır; tablo ve pager boşalmaz.
    placeholderData: keepPreviousData,
  });

  const setCatalogSearch = useCallback((value: string) => {
    setCatalogSearchState(value);
    setCatalogPageNumber(1);
  }, []);

  const categoriesQuery = useQuery({
    queryKey: ['woocommerce', 'categories'],
    queryFn: () => apiRequest<WooCategoriesPayload>('/api/v2/woocommerce/categories'),
    staleTime: 120_000,
  });

  const catalogDetailQuery = useQuery({
    queryKey: ['woocommerce-catalog', 'detail', catalogDetailId],
    enabled: Boolean(catalogDetailId),
    queryFn: () => apiRequest<WooCatalogItemDetail>(`/api/v2/woocommerce/catalog/${catalogDetailId}`),
  });

  const allRows = workspaceQuery.data?.rows || [];
  const requestedProductId = searchParams.get('product');
  const urunler = useMemo(() => {
    const mapped = allRows.map(rowToWooListItem);
    return mapped.filter((item) => {
      if (filter === 'published') return item.wooYayin === 'Yayında';
      if (filter === 'draft') return item.wooYayin === 'Taslak';
      if (filter === 'unpublished') return item.wooYayin === 'Yayınlanmadı';
      return true;
    });
  }, [allRows, filter]);

  const stokList = useMemo(() => allRows.map(rowToStokItem), [allRows]);

  // The URL is the single source of truth for the selected product. Keeping a
  // second local selection state caused a click on B to be overwritten by the
  // previous `?product=A` effect before the URL update landed.
  const secilenId = useMemo(() => {
    return resolveWooSelectedProductId(requestedProductId, urunler);
  }, [requestedProductId, urunler]);

  const setSecilenId = useCallback((nextId: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextId) next.set('product', nextId);
      else next.delete('product');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (secilenId === requestedProductId) return;
    if (!secilenId && !requestedProductId) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (secilenId) next.set('product', secilenId);
      else next.delete('product');
      return next;
    }, { replace: true });
  }, [requestedProductId, secilenId, setSearchParams]);

  const secilen = useMemo(() => urunler.find((item) => item.id === secilenId) ?? null, [urunler, secilenId]);

  const detailQuery = useQuery({
    queryKey: ['woocommerce', 'product', secilenId],
    enabled: Boolean(secilenId),
    queryFn: () => apiRequest<ProductOut>(`/api/v2/woocommerce/products/${secilenId}`),
  });

  const historyQuery = useQuery({
    queryKey: ['woocommerce', 'history', secilenId],
    enabled: Boolean(secilenId),
    queryFn: () => apiRequest<ProductHistoryEntry[]>(`/api/v2/woocommerce/products/${secilenId}/history?limit=20`),
  });

  const syncLogQuery = useQuery({
    queryKey: ['woocommerce', 'sync-log', secilenId],
    enabled: Boolean(secilenId),
    queryFn: () => apiRequest<WooSyncLogEntry[]>(`/api/v2/woocommerce/products/${secilenId}/sync-log?limit=20`),
  });

  const rawQuery = useQuery({
    queryKey: ['woocommerce', 'woo-raw', secilenId],
    enabled: rawOpen && Boolean(detailQuery.data?.woocommerce_product_id) && Boolean(secilenId),
    queryFn: () => apiRequest<WooRawResponse>(`/api/v2/woocommerce/products/${secilenId}/raw`),
  });

  useEffect(() => {
    const product = detailQuery.data;
    if (!product) return;
    setPublishPrice(String(product.shop_price_dkk || product.sale_price_dkk || product.purchase_price_dkk || ''));
    setAiDraft(product.ai_description || '');
    setPublishCategoryIds((product.woocommerce_category_ids ?? []).map(Number));
    // Override varsa onu, yoksa türetilen profili göster; yıl varsa doldur.
    setPublishProfile(product.woocommerce_publish_profile || product.resolved_publish_profile || '');
    setPublishYear(product.production_year ? String(product.production_year) : '');
    // R1-21: rozet default'u YALNIZ ürün değişince kur — fotoğraf/AI kayıt
    // refetch'leri operatörün işaretini ezmesin.
    if (badgeProductIdRef.current !== product.id) {
      badgeProductIdRef.current = product.id;
      setPublishNewBadge(!product.is_published_to_site);
      setPublishNewBadgeTouched(false);
    }
  }, [detailQuery.data]);

  async function invalidateProduct(productId?: string | null) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['woocommerce'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['depolama'] }),
      productId ? queryClient.invalidateQueries({ queryKey: ['woocommerce', 'product', productId] }) : Promise.resolve(),
      productId ? queryClient.invalidateQueries({ queryKey: ['woocommerce', 'history', productId] }) : Promise.resolve(),
      productId ? queryClient.invalidateQueries({ queryKey: ['woocommerce', 'sync-log', productId] }) : Promise.resolve(),
      productId ? queryClient.invalidateQueries({ queryKey: ['woocommerce', 'woo-raw', productId] }) : Promise.resolve(),
    ]);
  }

  const generateAiMutation = useMutation({
    mutationFn: (productId: string) => apiRequest<ProductOut>(`/api/v2/woocommerce/products/${productId}/ai`, { method: 'POST' }),
    onSuccess: async (product) => {
      setAiDraft(product.ai_description || '');
      await invalidateProduct(product.id);
      toast.success('AI açıklaması üretildi');
    },
    onError: (error) => toast.error('AI açıklaması üretilemedi', extractApiMessage(error, 'Sunucu hatası')),
  });

  const saveAiMutation = useMutation({
    mutationFn: ({ productId, approved, description }: { productId: string; approved: boolean; description: string }) =>
      apiRequest<ProductOut>(`/api/v2/woocommerce/products/${productId}/ai`, {
        method: 'PUT',
        body: JSON.stringify({
          ai_description: description.trim(),
          ai_description_approved: approved,
        }),
      }),
    onSuccess: async (product) => {
      setAiDraft(product.ai_description || '');
      await invalidateProduct(product.id);
      toast.success('AI açıklaması kaydedildi');
    },
    onError: (error) => toast.error('AI açıklaması kaydedilemedi', extractApiMessage(error, 'Sunucu hatası')),
  });

  const manualReviewMutation = useMutation({
    mutationFn: (productId: string) =>
      apiRequest<ProductOut>(`/api/v2/woocommerce/products/${productId}/manual-review/approve`, { method: 'POST' }),
    onSuccess: async (product) => {
      await invalidateProduct(product.id);
      toast.success('Manuel review onaylandı');
    },
    onError: (error) => toast.error('Manuel review onaylanamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const publishMutation = useMutation({
    mutationFn: ({ productId, name }: { productId: string; name?: string | null }) =>
      apiRequest<ProductPublishResponse>(`/api/v2/woocommerce/products/${productId}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          regular_price_dkk: Number(publishPrice || '0'),
          name: name || undefined,
          // Seçici durumu yayınla birlikte kalıcılaşır; [] = harita davranışına dön.
          category_ids: publishCategoryIds,
          publish_profile: publishProfile || '',
          production_year: publishYear.trim() ? Number(publishYear) : 0,
          // İlk yayın veya operatör dokunduysa açık değer; yoksa null =
          // mevcut rozete dokunma (backend None'ı atlar).
          mark_as_new:
            !detailQuery.data?.is_published_to_site || publishNewBadgeTouched ? publishNewBadge : null,
        }),
      }),
    onSuccess: async (payload) => {
      setPublishPrice(String(payload.product.shop_price_dkk || payload.product.sale_price_dkk || payload.product.purchase_price_dkk || ''));
      await invalidateProduct(payload.product.id);
      setRawOpen(true);
      toast.success('Ürün WooCommerce’e yayınlandı', payload.wc_product_id ? `Woo ID: ${payload.wc_product_id}` : undefined);
      // Kısmi sorunlar (ör. yüklenemeyen fotoğraf) yayını durdurmaz ama
      // operatör görmeden geçmemeli.
      for (const warning of payload.warnings || []) {
        // R1-27: StoneX haritası boşsa operatörü doğrudan probe akışına yönlendir.
        const enriched = warning.includes('StoneX meta haritası boş')
          ? warning + ' Ayarlar → WooCommerce eşlemeleri bölümündeki probe aracıyla bir kez doldurun.'
          : warning;
        toast.error('Yayın uyarısı', enriched);
      }
    },
    onError: (error) => toast.error('Ürün yayınlanamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const unpublishMutation = useMutation({
    mutationFn: (productId: string) => apiRequest<ProductOut>(`/api/v2/woocommerce/products/${productId}/unpublish`, { method: 'POST' }),
    onSuccess: async (product) => {
      await invalidateProduct(product.id);
      toast.success('Ürün yayından kaldırıldı');
    },
    onError: (error) => toast.error('Ürün yayından kaldırılamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const syncSaleMutation = useMutation({
    mutationFn: (productId: string) =>
      apiRequest<{ message?: string; product?: ProductOut }>(`/api/v2/woocommerce/products/${productId}/sync`, { method: 'POST' }),
    onSuccess: async (payload) => {
      await invalidateProduct(payload.product?.id || secilenId);
      toast.success('Woo satış kontrolü tamamlandı', payload.message || undefined);
    },
    onError: (error) => toast.error('Woo satış kontrolü başarısız', extractApiMessage(error, 'Sunucu hatası')),
  });

  const uploadPhotosMutation = useMutation({
    mutationFn: async ({ productId, files }: { productId: string; files: File[] }) => {
      const formData = new FormData();
      for (const file of files) formData.append('files', file);
      return apiRequest<ProductOut>(`/api/v2/woocommerce/products/${productId}/photos`, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: async (product) => {
      await invalidateProduct(product.id);
      toast.success('Fotoğraflar yüklendi');
    },
    onError: (error) => toast.error('Fotoğraf yüklenemedi', extractApiMessage(error, 'Sunucu hatası')),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: ({ productId, photoId }: { productId: string; photoId: string }) =>
      apiRequest<ProductOut>(`/api/v2/woocommerce/products/${productId}/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: async (product) => {
      await invalidateProduct(product.id);
      toast.success('Fotoğraf silindi');
    },
    onError: (error) => toast.error('Fotoğraf silinemedi', extractApiMessage(error, 'Sunucu hatası')),
  });

  const createProductMutation = useMutation({
    mutationFn: async (draft: NewWooProductDraft) => {
      const created = await apiRequest<ProductOut>('/api/v2/depolama/products', {
        method: 'POST',
        body: JSON.stringify(toCreatePayload(draft)),
      });

      let current = created;

      if (draft.fotograflar.length > 0) {
        const formData = new FormData();
        for (const photo of draft.fotograflar) {
          formData.append('files', photo.file);
        }
        current = await apiRequest<ProductOut>(`/api/v2/woocommerce/products/${created.id}/photos`, {
          method: 'POST',
          body: formData,
        });
      }

      const wantsApprovedAi = draft.aiOnaylandi || draft.wooYayin === 'Yayında';
      const hasDraftAi = draft.aiAciklama.trim().length >= 10;
      if (hasDraftAi) {
        current = await apiRequest<ProductOut>(`/api/v2/woocommerce/products/${created.id}/ai`, {
          method: 'PUT',
          body: JSON.stringify({
            ai_description: draft.aiAciklama.trim(),
            ai_description_approved: wantsApprovedAi,
          }),
        });
      }

      if (draft.wooYayin === 'Yayında') {
        const payload = await apiRequest<ProductPublishResponse>(`/api/v2/woocommerce/products/${created.id}/publish`, {
          method: 'POST',
          body: JSON.stringify({
            regular_price_dkk: Number(draft.satisHasJiyati || draft.alimFiyati || '0'),
            name: draft.urunAdi.trim() || undefined,
            category_ids: draft.kategoriIds,
            // R1-21: wizard yayını tanımı gereği ilk yayın — rozet işaretli.
            mark_as_new: true,
          }),
        });
        current = payload.product;
      }

      return current;
    },
    onSuccess: async (product) => {
      setSecilenId(product.id);
      await invalidateProduct(product.id);
      toast.success('Ürün oluşturuldu', product.product_number || product.display_name || undefined);
    },
    onError: (error) => toast.error('Ürün oluşturulamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const catalogPreviewMutation = useMutation({
    mutationFn: () => apiRequest<WooCatalogSyncPreview>('/api/v2/woocommerce/catalog/sync/preview', { method: 'POST' }),
    onSuccess: (payload) => {
      setCatalogPreview(payload);
      toast.info(
        'WooCommerce senkronizasyon önizlemesi hazır',
        `${payload.summary.remote_published_count} yayınlı ürün kontrol edildi.`,
      );
    },
    onError: (error) => toast.error('WooCommerce kataloğu kontrol edilemedi', extractApiMessage(error, 'Sunucu hatası')),
  });

  const catalogApplyMutation = useMutation({
    mutationFn: (previewRevision: string) =>
      apiRequest<{ status: string; revision: number; summary: WooCatalogSyncSummary; synced_at: string }>(
        '/api/v2/woocommerce/catalog/sync',
        {
          method: 'POST',
          body: JSON.stringify({ preview_revision: previewRevision }),
        },
      ),
    onSuccess: async (payload) => {
      setCatalogPreview(null);
      setCatalogPageNumber(1);
      await queryClient.invalidateQueries({ queryKey: wooCatalogQueryKeys.root });
      toast.success(
        'WooCommerce kataloğu güncellendi',
        `${payload.summary.create_count} yeni, ${payload.summary.update_count} güncellenen ürün.`,
      );
    },
    onError: async (error) => {
      if (isCatalogPreviewInvalidatedError(error)) {
        setCatalogPreview(null);
        await queryClient.invalidateQueries({ queryKey: wooCatalogQueryKeys.root });
        toast.error(
          'WooCommerce önizlemesi geçersiz',
          'Önizlemenin süresi doldu veya katalog değişti. Yeni bir önizleme oluşturun.',
        );
        return;
      }
      toast.error('WooCommerce kataloğu güncellenemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const invalidateCatalogDetail = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: wooCatalogQueryKeys.root });
    await queryClient.invalidateQueries({ queryKey: ['woocommerce-catalog', 'detail'] });
  }, [queryClient]);

  const catalogLinkMutation = useMutation({
    mutationFn: ({ catalogItemId, productId }: { catalogItemId: string; productId: string }) =>
      apiRequest<WooCatalogItem>(`/api/v2/woocommerce/catalog/${catalogItemId}/link`, {
        method: 'POST',
        body: JSON.stringify({ product_id: productId }),
      }),
    onSuccess: async () => {
      await invalidateCatalogDetail();
      toast.success('Katalog kaydı CRM ürününe bağlandı');
    },
    onError: (error) => toast.error('Bağlantı kurulamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const catalogUnlinkMutation = useMutation({
    mutationFn: (catalogItemId: string) =>
      apiRequest<WooCatalogItem>(`/api/v2/woocommerce/catalog/${catalogItemId}/link`, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidateCatalogDetail();
      toast.success('Katalog bağlantısı kaldırıldı');
    },
    onError: (error) => toast.error('Bağlantı kaldırılamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const catalogUnpublishMutation = useMutation({
    mutationFn: (catalogItemId: string) =>
      apiRequest<WooCatalogItem>(`/api/v2/woocommerce/catalog/${catalogItemId}/unpublish`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidateCatalogDetail();
      await invalidateProduct();
      toast.success('Ürün sitede taslağa çekildi');
    },
    onError: (error) => toast.error('Yayından kaldırılamadı', extractApiMessage(error, 'Sunucu hatası')),
  });

  const catalogContentMutation = useMutation({
    mutationFn: ({ catalogItemId, body }: { catalogItemId: string; body: WooCatalogContentUpdate }) =>
      apiRequest<WooCatalogItemDetail>(`/api/v2/woocommerce/catalog/${catalogItemId}/content`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await invalidateCatalogDetail();
      toast.success('Katalog içeriği sitede güncellendi');
    },
    onError: (error) => toast.error('İçerik güncellenemedi', extractApiMessage(error, 'Sunucu hatası')),
  });

  const refreshCategories = useCallback(async () => {
    try {
      const payload = await apiRequest<WooCategoriesPayload>('/api/v2/woocommerce/categories?refresh=true');
      queryClient.setQueryData(['woocommerce', 'categories'], payload);
    } catch (error) {
      toast.error('Kategoriler yenilenemedi', extractApiMessage(error, 'Sunucu hatası'));
    }
  }, [queryClient, toast]);

  const togglePublishCategory = useCallback((id: number) => {
    setPublishCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }, []);

  async function refreshWorkspace() {
    await workspaceQuery.refetch();
    if (secilenId) {
      await Promise.all([detailQuery.refetch(), historyQuery.refetch(), syncLogQuery.refetch()]);
    }
  }

  async function refreshCatalog() {
    await Promise.all([catalogStatusQuery.refetch(), catalogQuery.refetch()]);
  }

  return {
    search,
    setSearch,
    filter,
    setFilter,
    urunler,
    secilenId,
    setSecilenId,
    secilen,
    detail: detailQuery.data ?? null,
    history: historyQuery.data || [],
    syncLog: syncLogQuery.data || [],
    rawData: rawQuery.data ?? null,
    rawOpen,
    setRawOpen,
    publishPrice,
    setPublishPrice,
    aiDraft,
    setAiDraft,
    stokList,
    workspaceSummary: workspaceQuery.data?.summary ?? {
      total_products: 0,
      published_products: 0,
      draft_products: 0,
      unpublished_products: 0,
      photo_pending_products: 0,
    },
    bootstrap: bootstrapQuery.data,
    loadingWorkspace: workspaceQuery.isLoading,
    workspaceError: workspaceQuery.error instanceof Error ? workspaceQuery.error.message : workspaceQuery.error ? 'Woo ürün çalışma alanı yüklenemedi.' : null,
    loadingDetail: detailQuery.isLoading,
    detailError: detailQuery.error instanceof Error ? detailQuery.error.message : detailQuery.error ? 'Ürün detayı yüklenemedi.' : null,
    isGeneratingAi: generateAiMutation.isPending,
    isSavingAi: saveAiMutation.isPending,
    isApprovingReview: manualReviewMutation.isPending,
    isPublishing: publishMutation.isPending,
    isUnpublishing: unpublishMutation.isPending,
    isSyncing: syncSaleMutation.isPending,
    isUploadingPhotos: uploadPhotosMutation.isPending,
    isDeletingPhoto: deletePhotoMutation.isPending,
    isCreatingProduct: createProductMutation.isPending,
    refreshWorkspace,
    generateAi: () => {
      if (detailQuery.data) {
        generateAiMutation.mutate(detailQuery.data.id);
      }
    },
    saveAi: (approved) => {
      if (detailQuery.data && aiDraft.trim().length >= 10) {
        saveAiMutation.mutate({ productId: detailQuery.data.id, approved, description: aiDraft });
      }
    },
    approveManualReview: () => {
      if (detailQuery.data) {
        manualReviewMutation.mutate(detailQuery.data.id);
      }
    },
    fetchPublishPreview: async () => {
      const product = detailQuery.data;
      if (!product) return null;
      try {
        const params = new URLSearchParams();
        const price = Number(publishPrice || '0');
        if (price > 0) params.set('regular_price_dkk', String(price));
        const previewName = product.display_name || secilen?.urun || '';
        if (previewName) params.set('name', previewName);
        // Kaydedilmemiş panel seçimleri de önizlemeye girer (backend rollback'ler).
        params.set('category_ids', publishCategoryIds.join(','));
        if (publishProfile) params.set('publish_profile', publishProfile);
        if (publishYear.trim()) params.set('production_year', publishYear.trim());
        return await apiRequest<WooPublishPreview>(`/api/products/${product.id}/publish-preview?${params.toString()}`);
      } catch {
        return null;
      }
    },
    publish: () => {
      if (detailQuery.data) {
        publishMutation.mutate({
          productId: detailQuery.data.id,
          name: detailQuery.data.display_name || secilen?.urun || undefined,
        });
      }
    },
    unpublish: () => {
      if (detailQuery.data) {
        unpublishMutation.mutate(detailQuery.data.id);
      }
    },
    syncSale: () => {
      if (detailQuery.data) {
        syncSaleMutation.mutate(detailQuery.data.id);
      }
    },
    uploadPhotos: (files) => {
      if (!detailQuery.data || files.length === 0) return;
      const { accepted, rejected } = validatePhotoFiles(files);
      if (rejected.length > 0) {
        toast.error('Bazı dosyalar kabul edilmedi', describeRejectedPhotos(rejected));
      }
      if (accepted.length > 0) {
        uploadPhotosMutation.mutate({ productId: detailQuery.data.id, files: accepted });
      }
    },
    deletePhoto: (photoId) => {
      if (detailQuery.data && photoId) {
        deletePhotoMutation.mutate({ productId: detailQuery.data.id, photoId });
      }
    },
    createProductFromDraft: async (draft) => createProductMutation.mutateAsync(draft),
    catalogSearch,
    setCatalogSearch,
    catalogPageNumber,
    setCatalogPageNumber,
    catalog: catalogQuery.data ?? null,
    catalogStatus: catalogStatusQuery.data ?? null,
    catalogPreview,
    catalogLoading: catalogQuery.isLoading || catalogStatusQuery.isLoading,
    catalogError:
      catalogQuery.error instanceof Error
        ? catalogQuery.error.message
        : catalogStatusQuery.error instanceof Error
          ? catalogStatusQuery.error.message
          : catalogQuery.error || catalogStatusQuery.error
            ? 'WooCommerce kataloğu yüklenemedi.'
            : null,
    isPreviewingCatalog: catalogPreviewMutation.isPending,
    isApplyingCatalog: catalogApplyMutation.isPending,
    refreshCatalog,
    previewCatalogSync: () => catalogPreviewMutation.mutate(),
    applyCatalogSync: () => {
      if (catalogPreview?.preview_revision) {
        catalogApplyMutation.mutate(catalogPreview.preview_revision);
      }
    },
    categories: categoriesQuery.data?.items ?? [],
    categoriesLoading: categoriesQuery.isLoading,
    categoriesError: categoriesQuery.error ? extractApiMessage(categoriesQuery.error, 'Kategoriler alınamadı') : null,
    refreshCategories,
    publishCategoryIds,
    setPublishCategoryIds,
    publishProfile,
    setPublishProfile,
    publishYear,
    setPublishYear,
    publishNewBadge,
    setPublishNewBadge: (value: boolean) => {
      setPublishNewBadgeTouched(true);
      setPublishNewBadge(value);
    },
    togglePublishCategory,
    catalogDetailId,
    openCatalogDetail: setCatalogDetailId,
    catalogDetail: catalogDetailQuery.data ?? null,
    catalogDetailLoading: catalogDetailQuery.isLoading,
    linkCatalogItem: (catalogItemId: string, productId: string) => catalogLinkMutation.mutate({ catalogItemId, productId }),
    unlinkCatalogItem: (catalogItemId: string) => catalogUnlinkMutation.mutate(catalogItemId),
    unpublishCatalogItem: (catalogItemId: string) => catalogUnpublishMutation.mutate(catalogItemId),
    updateCatalogContent: async (catalogItemId: string, body: WooCatalogContentUpdate) => {
      try {
        await catalogContentMutation.mutateAsync({ catalogItemId, body });
        return true;
      } catch {
        return false;
      }
    },
    isCatalogActionPending:
      catalogLinkMutation.isPending ||
      catalogUnlinkMutation.isPending ||
      catalogUnpublishMutation.isPending ||
      catalogContentMutation.isPending,
  };
}

export function buildDraftFromStock(stock: StokItem) {
  return prefillFromStock(defaultNewWooProductDraft(), stock);
}
