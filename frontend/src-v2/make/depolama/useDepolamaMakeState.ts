import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { apiRequest, downloadAuthedDocument } from '@/lib/api';
import { emitArtifactSync, listenArtifactSync, signalMatches } from '@/lib/artifactSync';
import { useToast } from '@/lib/toast';
import type {
  InventoryGridRow,
  InventoryWorkspace,
  ProductHistoryEntry,
  ProductOut,
  ProductSourceAfg,
} from '@/types';

import type { DepolamaPageProps } from './DepolamaPage';
import type {
  InventoryFilterState,
  InventoryLifecycleStatus,
  InventorySortKey,
  InventorySortState,
  InventorySurfaceView,
  MainCategory,
  MarketPrices,
  PlatinumSub,
  SilverSub,
  StokItem,
} from './types';

const DEFAULT_MARKET_PRICES: MarketPrices = {
  gold: 0,
  silver: 0,
  platin: 0,
  palladyum: 0,
};

const UPDATED_STORAGE_KEY = 'depo_opdateret';

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultSaflik(kat: MainCategory) {
  if (kat === 'gumus') return 0.999;
  if (kat === 'platin_pd') return 0.9995;
  return 0.9999;
}

function parseSaflik(row: InventoryGridRow) {
  if (row.purity_percentage) {
    const percentage = numeric(row.purity_percentage);
    if (percentage > 0) return percentage / 100;
  }
  const match = row.saflik_label.match(/(\d+(?:[.,]\d+)?)(?:‰|%)/);
  if (match) {
    const amount = Number(match[1].replace(',', '.'));
    if (Number.isFinite(amount) && amount > 0) {
      return row.saflik_label.includes('%') ? amount / 100 : amount / 1000;
    }
  }
  return defaultSaflik(row.main_category as MainCategory);
}

function isStorageVisible(row: InventoryGridRow) {
  return row.status !== 'sold' && row.status !== 'melted';
}

function toMarketPrices(workspace: InventoryWorkspace | null | undefined): MarketPrices {
  return {
    gold: numeric(workspace?.market_prices.gold),
    silver: numeric(workspace?.market_prices.silver),
    platin: numeric(workspace?.market_prices.platinum),
    palladyum: numeric(workspace?.market_prices.palladium),
  };
}

function rowToStokItem(row: InventoryGridRow): StokItem {
  const mainKat = row.main_category as MainCategory;
  const spotDegeri = numeric(row.spot_degeri_dkk);
  return {
    id: row.id,
    stokNo: row.reference_number || '',
    mainKat,
    gumusAlt: mainKat === 'gumus' ? ((row.subcategory || 'smykker') as SilverSub) : undefined,
    platinAlt: mainKat === 'platin_pd' ? ((row.subcategory || 'platin') as PlatinumSub) : undefined,
    lagerDato: row.lager_dato,
    urun: row.urun,
    saflik: parseSaflik(row),
    birimGram: numeric(row.birim_gram),
    adet: row.adet || 1,
    alisFiyati: numeric(row.alis_fiyati_dkk),
    spotDegeri,
    hasMetalGrams: row.has_metal_grams ? numeric(row.has_metal_grams) : undefined,
    toplamGram: numeric(row.toplam_gram),
    shopFark: row.shop_fiyati_dkk ? numeric(row.shop_fiyati_dkk) - spotDegeri : undefined,
    wooFiyati: row.woo_satis_fiyati_dkk ? numeric(row.woo_satis_fiyati_dkk) : undefined,
    wooEksikAlanlar: row.woo_eksik_alanlar || undefined,
    storageLocation: row.storage_location || undefined,
    isGdprLocked: row.is_gdpr_locked,
    productStatus: row.status,
    shopFiyati: row.shop_fiyati_dkk ? numeric(row.shop_fiyati_dkk) : undefined,
    shopDurumu: (row.shop_sync_status as StokItem['shopDurumu']) || undefined,
    olcuUzunluk: row.length_cm || undefined,
    olcuGenislik: row.width_mm ? numeric(row.width_mm) : undefined,
    olcuKalinlik: row.thickness_mm ? numeric(row.thickness_mm) : undefined,
    olcuCap: row.diameter_mm ? numeric(row.diameter_mm) : undefined,
    uretici: row.producer || undefined,
    notlar: row.notes || undefined,
    referenceNumber: row.reference_number || null,
    productNumber: row.product_number,
    needsCleaning: row.needs_cleaning,
    primaryPhoto: row.primary_photo ?? null,
    photoCount: row.photo_count ?? 0,
    wooLinked: Boolean(row.is_woo_linked),
  };
}

function currentDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function newDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}`;
}

function todayDa() {
  return new Date().toLocaleDateString(document.documentElement.lang);
}

function readUpdated() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(UPDATED_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeUpdated(value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UPDATED_STORAGE_KEY, value);
  } catch {
    // noop
  }
}

function buildNewItem(activeKat: MainCategory, gumusAlt: SilverSub, platinAlt: PlatinumSub): StokItem {
  return {
    id: newDraftId(),
    stokNo: '',
    mainKat: activeKat,
    gumusAlt: activeKat === 'gumus' ? gumusAlt : undefined,
    platinAlt: activeKat === 'platin_pd' ? platinAlt : undefined,
    lagerDato: currentDateInput(),
    urun: '',
    saflik: defaultSaflik(activeKat),
    birimGram: 0,
    adet: 1,
    alisFiyati: 0,
    shopFiyati: undefined,
    shopDurumu: undefined,
    olcuUzunluk: '',
    olcuGenislik: undefined,
    olcuKalinlik: undefined,
    uretici: '',
    notlar: '',
    storageLocation: '',
    referenceNumber: null,
    needsCleaning: false,
  };
}

function categorySpec(item: StokItem): {
  inventory_category: MainCategory;
  inventory_subcategory: string | null;
  product_type: string;
  metal_type: string;
} {
  if (item.mainKat === 'kulce') {
    return { inventory_category: 'kulce', inventory_subcategory: null, product_type: 'bar', metal_type: 'yellow_gold' };
  }
  if (item.mainKat === 'sikke') {
    return { inventory_category: 'sikke', inventory_subcategory: null, product_type: 'jewelry', metal_type: 'yellow_gold' };
  }
  if (item.mainKat === 'taki') {
    return { inventory_category: 'taki', inventory_subcategory: null, product_type: 'jewelry', metal_type: 'yellow_gold' };
  }
  if (item.mainKat === 'gumus') {
    return {
      inventory_category: 'gumus',
      inventory_subcategory: item.gumusAlt || 'smykker',
      product_type: item.gumusAlt === 'barrer' ? 'bar' : 'jewelry',
      metal_type: 'silver',
    };
  }
  return {
    inventory_category: 'platin_pd',
    inventory_subcategory: item.platinAlt || 'platin',
    product_type: 'bar',
    metal_type: (item.platinAlt || 'platin') === 'palladyum' ? 'palladium' : 'platinum',
  };
}

function goldKaratForSaflik(saflik: number): string | null {
  if (Math.abs(saflik - 0.9999) < 0.0001) return '24K';
  if (Math.abs(saflik - 0.9166) < 0.0001) return '22K';
  if (Math.abs(saflik - 0.9) < 0.0001) return '21.6K';
  if (Math.abs(saflik - 0.875) < 0.0001) return '21K';
  if (Math.abs(saflik - 0.75) < 0.0001) return '18K';
  if (Math.abs(saflik - 0.585) < 0.0001) return '14K';
  if (Math.abs(saflik - 0.3333) < 0.0001) return '8K';
  return null;
}

function toDateTime(value: string) {
  return `${value || currentDateInput()}T12:00:00+00:00`;
}

function toCreatePayload(item: StokItem) {
  const spec = categorySpec(item);
  return {
    reference_number: item.mainKat === 'taki' ? item.stokNo || null : item.referenceNumber || null,
    display_name: item.urun || null,
    product_type: spec.product_type,
    metal_type: spec.metal_type,
    weight_grams: item.birimGram || 0,
    purity_karat: spec.metal_type === 'yellow_gold' ? goldKaratForSaflik(item.saflik) : null,
    purity_percentage: item.saflik * 100,
    unit_count: Math.max(1, item.adet || 1),
    purchase_date: toDateTime(item.lagerDato),
    purchase_price_dkk: item.alisFiyati || 0,
    notes: item.notlar || null,
    storage_location: item.storageLocation || null,
    needs_cleaning: Boolean(item.needsCleaning),
    shop_price_dkk: item.mainKat === 'taki' && item.shopFiyati != null ? item.shopFiyati : null,
    shop_sync_status: item.mainKat === 'taki' ? item.shopDurumu || null : null,
    length_cm: item.olcuUzunluk || null,
    width_mm: item.olcuGenislik ?? null,
    thickness_mm: item.olcuKalinlik ?? null,
    diameter_mm: item.olcuCap ?? null,
    producer: item.uretici || null,
    inventory_category: spec.inventory_category,
    inventory_subcategory: spec.inventory_subcategory,
    photos: [],
  };
}

function toPatchPayload(item: StokItem) {
  const spec = categorySpec(item);
  return {
    reference_number: item.mainKat === 'taki' ? item.stokNo || null : item.referenceNumber || null,
    display_name: item.urun || null,
    product_type: spec.product_type,
    metal_type: spec.metal_type,
    weight_grams: item.birimGram || null,
    purity_karat: spec.metal_type === 'yellow_gold' ? goldKaratForSaflik(item.saflik) : null,
    purity_percentage: item.saflik ? item.saflik * 100 : null,
    unit_count: Math.max(1, item.adet || 1),
    purchase_price_dkk: item.alisFiyati || null,
    notes: item.notlar || null,
    storage_location: item.storageLocation || null,
    needs_cleaning: Boolean(item.needsCleaning),
    shop_price_dkk: item.mainKat === 'taki' && item.shopFiyati != null ? item.shopFiyati : null,
    shop_sync_status: item.mainKat === 'taki' ? item.shopDurumu || null : null,
    // Boş bırakılan ölçü/üretici alanı sunucuda SİLİNİR (clear bayrakları);
    // None='dokunma' semantiği yüzünden null göndermek yetmiyordu.
    length_cm: item.olcuUzunluk || null,
    clear_length_cm: !item.olcuUzunluk,
    width_mm: item.olcuGenislik ?? null,
    clear_width_mm: item.olcuGenislik == null,
    thickness_mm: item.olcuKalinlik ?? null,
    clear_thickness_mm: item.olcuKalinlik == null,
    diameter_mm: item.olcuCap ?? null,
    clear_diameter_mm: item.olcuCap == null,
    producer: item.uretici || null,
    clear_producer: !item.uretici,
    inventory_category: spec.inventory_category,
    inventory_subcategory: spec.inventory_subcategory,
    expected_updated_at: item.updatedAt || null,
  };
}

const SORT_KEY_TO_FIELD: Record<InventorySortKey, (item: StokItem) => number | string> = {
  lager_dato: (item) => item.lagerDato,
  urun: (item) => (item.urun || '').toLocaleLowerCase('tr'),
  birim_gram: (item) => item.birimGram,
  toplam_gram: (item) => item.toplamGram ?? item.birimGram * item.adet,
  alis_fiyati: (item) => item.alisFiyati,
  spot_degeri: (item) => item.spotDegeri ?? 0,
  woo_satis_fiyati: (item) => item.wooFiyati ?? 0,
  shop_fiyati: (item) => item.shopFiyati ?? 0,
  storage_location: (item) => (item.storageLocation || '').toLocaleLowerCase('tr'),
};

function sortItems(items: StokItem[], sort: InventorySortState): StokItem[] {
  const getKey = SORT_KEY_TO_FIELD[sort.key];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = getKey(a);
    const bv = getKey(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
    return String(av).localeCompare(String(bv), document.documentElement.lang) * direction;
  });
}

export function buildWorkspaceQueryParams(
  filters: InventoryFilterState,
  category: MainCategory | 'all',
  subcategory: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (category !== 'all') params.set('category', category);
  if (filters.status) params.set('status', filters.status);
  if (subcategory) params.set('subcategory', subcategory);
  if (filters.location.trim()) params.set('location', filters.location.trim());
  if (filters.needsCleaning) params.set('needs_cleaning', 'true');
  if (filters.gdprLocked !== 'all') params.set('gdpr_locked', filters.gdprLocked === 'locked' ? 'true' : 'false');
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  if (filters.weightMin.trim()) params.set('weight_min', filters.weightMin.trim().replace(',', '.'));
  if (filters.weightMax.trim()) params.set('weight_max', filters.weightMax.trim().replace(',', '.'));
  if (filters.priceMin.trim()) params.set('price_min', filters.priceMin.trim().replace(',', '.'));
  if (filters.priceMax.trim()) params.set('price_max', filters.priceMax.trim().replace(',', '.'));
  return params.toString();
}

import { EMPTY_FILTERS } from './types';

export function useDepolamaMakeState(options: { showAllCategoriesInitially?: boolean } = {}): DepolamaPageProps {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [prices, setPrices] = useState<MarketPrices>(DEFAULT_MARKET_PRICES);
  const [priceOpen, setPriceOpen] = useState(false);
  const [activeKat, setActiveKatState] = useState<MainCategory>('kulce');
  const [categoryScope, setCategoryScopeState] = useState<MainCategory | 'all'>(
    options.showAllCategoriesInitially ? 'all' : 'kulce',
  );
  // Variant (modern/klasik) mount'tan sonra yerleşirse başlangıç kapsamını
  // kullanıcı dokunmadıysa senkronla — aksi halde modern açılış 'kulce'de
  // takılı kalır ve liste boş görünürdü.
  const scopeTouchedRef = useRef(false);
  useEffect(() => {
    if (options.showAllCategoriesInitially && !scopeTouchedRef.current) {
      setCategoryScopeState('all');
    }
  }, [options.showAllCategoriesInitially]);
  const [gumusAlt, setGumusAlt] = useState<SilverSub>('smykker');
  const [platinAlt, setPlatinAlt] = useState<PlatinumSub>('platin');
  const [activeView, setActiveView] = useState<InventorySurfaceView>('system');
  const [editing, setEditing] = useState<StokItem | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [opdateret, setOpdateret] = useState<string>(() => readUpdated());

  const [filters, setFilters] = useState<InventoryFilterState>(EMPTY_FILTERS);
  const [sort, setSort] = useState<InventorySortState>({ key: 'lager_dato', direction: 'desc' });
  const [retryingLabelId, setRetryingLabelId] = useState<string | null>(null);

  const subcategory =
    categoryScope === 'gumus' ? gumusAlt : categoryScope === 'platin_pd' ? platinAlt : null;

  const workspaceParams = useMemo(
    () => buildWorkspaceQueryParams(filters, categoryScope, subcategory),
    [filters, categoryScope, subcategory],
  );

  const workspaceQuery = useQuery({
    queryKey: ['depolama', 'workspace', workspaceParams],
    queryFn: () => apiRequest<InventoryWorkspace>(`/api/v2/depolama/workspace?${workspaceParams}`),
  });

  // Durum filtresi seçiliyse backend zaten tam o durumu döndürür (satılmış/
  // eritilmiş dahil) — bu durumda client tarafı gizleme uygulanmaz.
  const visibleRows = useMemo(
    () => (workspaceQuery.data?.rows || []).filter((row) => (filters.status ? true : isStorageVisible(row))),
    [workspaceQuery.data?.rows, filters.status],
  );

  const stokList = useMemo(
    () => sortItems(visibleRows.map(rowToStokItem), sort),
    [visibleRows, sort],
  );
  const detailQuery = useQuery({
    queryKey: ['depolama', 'product', selectedProductId],
    enabled: Boolean(selectedProductId),
    queryFn: () => apiRequest<ProductOut>(`/api/v2/depolama/products/${selectedProductId}`),
  });
  const historyQuery = useQuery({
    queryKey: ['depolama', 'product', selectedProductId, 'history'],
    enabled: Boolean(selectedProductId),
    queryFn: () => apiRequest<ProductHistoryEntry[]>(`/api/v2/depolama/products/${selectedProductId}/history?limit=30`),
  });
  const sourceAfgQuery = useQuery({
    queryKey: ['depolama', 'product', selectedProductId, 'source-afg'],
    enabled: Boolean(selectedProductId),
    queryFn: () => apiRequest<ProductSourceAfg | null>(`/api/v2/depolama/products/${selectedProductId}/source-afg`),
  });

  useEffect(() => {
    setPrices(toMarketPrices(workspaceQuery.data));
  }, [workspaceQuery.data]);

  useEffect(() => {
    if (activeView === 'excel') {
      setSelectedProductId(null);
      return;
    }
    void invalidateDepolama(selectedProductId || undefined);
  }, [activeView]);

  useEffect(() => {
    if (editing) {
      setActiveView('system');
      setSelectedProductId(null);
    }
  }, [editing]);

  useEffect(() => {
    // Seçimi YALNIZ ürün gerçekten yoksa (silinmiş → detay 404/hata) kapat.
    // Filtre değişimi veya refetch sırasında stokList'ten düşmesi seçimi
    // KAPATMAZ (eski davranış Detay'ı aralıklı buga sokuyordu).
    if (!selectedProductId) return;
    if (detailQuery.isError) setSelectedProductId(null);
  }, [selectedProductId, detailQuery.isError]);

  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.source === 'depolama-ui') return;
      // Hem direkt depolama sinyali hem alış/log'dan tetiklenen cross-module sinyali yakala
      if (!signalMatches(signal, 'depolama')) return;
      void invalidateDepolama();
    });
  }, [queryClient, workspaceQuery.data]);

  async function invalidateDepolama(productId?: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['depolama'] }),
      queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['woocommerce'] }),
      productId ? queryClient.invalidateQueries({ queryKey: ['depolama', 'product', productId] }) : Promise.resolve(),
      productId ? queryClient.invalidateQueries({ queryKey: ['inventory', 'product', productId] }) : Promise.resolve(),
    ]);
  }

  function markUpdatedNow() {
    const now = todayDa();
    setOpdateret(now);
    writeUpdated(now);
  }

  function setCategoryScope(value: MainCategory | 'all') {
    scopeTouchedRef.current = true;
    setCategoryScopeState(value);
    if (value !== 'all') setActiveKatState(value);
    setSelectedProductId(null);
  }

  function setActiveKat(value: MainCategory) {
    scopeTouchedRef.current = true;
    setActiveKatState(value);
    setCategoryScopeState(value);
    setSelectedProductId(null);
  }

  const extractApiMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error) {
      try {
        const parsed = JSON.parse(error.message);
        if (parsed && typeof parsed === 'object') {
          if (parsed.detail && typeof parsed.detail === 'object' && parsed.detail.message) {
            return String(parsed.detail.message);
          }
          if (typeof parsed.detail === 'string') return parsed.detail;
        }
      } catch {
        // fall through
      }
      return error.message || fallback;
    }
    return fallback;
  };

  const savePricesMutation = useMutation({
    mutationFn: (payload: MarketPrices) =>
      apiRequest('/api/v2/depolama/market-prices', {
        method: 'PUT',
        body: JSON.stringify({
          gold: payload.gold,
          silver: payload.silver,
          platinum: payload.platin,
          palladium: payload.palladyum,
        }),
      }),
    onSuccess: async () => {
      await invalidateDepolama();
      markUpdatedNow();
      emitArtifactSync({ kind: 'depolama', key: 'live', source: 'depolama-ui' });
      setPriceOpen(false);
      toast.success('Piyasa fiyatları güncellendi');
    },
    onError: (error) => {
      toast.error('Piyasa fiyatları kaydedilemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const createProductMutation = useMutation({
    mutationFn: (item: StokItem) =>
      apiRequest<ProductOut>('/api/v2/depolama/products', {
        method: 'POST',
        body: JSON.stringify(toCreatePayload(item)),
      }),
    onSuccess: async (product, item) => {
      await invalidateDepolama(product.id);
      markUpdatedNow();
      emitArtifactSync({ kind: 'depolama', key: 'live', source: 'depolama-ui' });
      setActiveKat(item.mainKat);
      if (item.mainKat === 'gumus') setGumusAlt(item.gumusAlt || 'smykker');
      if (item.mainKat === 'platin_pd') setPlatinAlt(item.platinAlt || 'platin');
      setEditing(null);
      toast.success('Ürün oluşturuldu', product.product_number || product.display_name || undefined);
    },
    onError: (error) => {
      toast.error('Ürün oluşturulamadı', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ productId, item }: { productId: string; item: StokItem }) =>
      apiRequest<ProductOut>(`/api/v2/depolama/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(toPatchPayload(item)),
      }),
    onSuccess: async (product) => {
      await invalidateDepolama(product.id);
      markUpdatedNow();
      emitArtifactSync({ kind: 'depolama', key: 'live', source: 'depolama-ui' });
      setEditing(null);
      toast.success('Ürün güncellendi', product.product_number || undefined);
    },
    onError: (error) => {
      const msg = extractApiMessage(error, 'Sunucu hatası');
      if (msg.includes('stale_product') || msg.toLowerCase().includes('başka bir kullanıcı')) {
        toast.warning('Çakışma', 'Ürün başka bir kullanıcı tarafından güncellenmiş. Lütfen sayfayı yenileyin.');
        setEditing(null);
      } else {
        toast.error('Ürün güncellenemedi', msg);
      }
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: (productId: string) =>
      apiRequest<Blob>(`/api/v2/depolama/products/${productId}`, {
        method: 'DELETE',
      }),
    onSuccess: async (_blob, productId) => {
      await invalidateDepolama(productId);
      markUpdatedNow();
      emitArtifactSync({ kind: 'depolama', key: 'live', source: 'depolama-ui' });
      setEditing((current) => (current?.id === productId ? null : current));
      toast.success('Ürün silindi');
    },
    onError: (error) => {
      toast.error('Ürün silinemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      productId,
      status,
      meltReason,
      expectedUpdatedAt,
      salePriceDkk,
      buyerCustomerId,
    }: {
      productId: string;
      status: InventoryLifecycleStatus;
      meltReason?: string | null;
      expectedUpdatedAt?: string | null;
      salePriceDkk?: number | null;
      buyerCustomerId?: string | null;
    }) =>
      apiRequest<ProductOut>(`/api/v2/depolama/products/${productId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          melt_reason: meltReason || null,
          sale_price_dkk: salePriceDkk || null,
          buyer_customer_id: buyerCustomerId || null,
          expected_updated_at: expectedUpdatedAt || null,
        }),
      }),
    onSuccess: async (product) => {
      await invalidateDepolama(product.id);
      markUpdatedNow();
      emitArtifactSync({ kind: 'depolama', key: 'live', source: 'depolama-ui' });
      if (product.status === 'melted' || product.status === 'sold') {
        setSelectedProductId(null);
      }
      toast.success('Ürün durumu güncellendi', product.status);
    },
    onError: (error) => {
      const msg = extractApiMessage(error, 'Sunucu hatası');
      if (msg.includes('stale_product')) {
        toast.warning('Çakışma', 'Ürün durumu başka bir kullanıcı tarafından güncellenmiş.');
      } else {
        toast.error('Durum güncellenemedi', msg);
      }
    },
  });

  const uploadPhotosMutation = useMutation({
    mutationFn: async ({ productId, files }: { productId: string; files: FileList | File[] }) => {
      const fd = new FormData();
      Array.from(files).forEach((file) => fd.append('files', file));
      return apiRequest<ProductOut>(`/api/products/${productId}/photos`, {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: async (product) => {
      await invalidateDepolama(product.id);
      toast.success('Fotoğraflar yüklendi');
    },
    onError: (error) => {
      toast.error('Fotoğraf yüklenemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: ({ productId, photoId }: { productId: string; photoId: string }) =>
      apiRequest(`/api/products/${productId}/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: async (_, vars) => {
      await invalidateDepolama(vars.productId);
      toast.success('Fotoğraf silindi');
    },
    onError: (error) => {
      toast.error('Fotoğraf silinemedi', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  const attachLibraryPhotoMutation = useMutation({
    mutationFn: ({ productId, file }: { productId: string; file: string }) =>
      apiRequest<ProductOut>(`/api/v2/depolama/products/${productId}/photos/from-library`, {
        method: 'POST',
        body: JSON.stringify({ file }),
      }),
    onSuccess: async (product) => {
      await invalidateDepolama(product.id);
      toast.success('Foto havuzdan iliştirildi');
    },
    onError: (error) => {
      const msg = extractApiMessage(error, 'Sunucu hatası');
      if (msg.includes('zaten iliştir')) toast.warning('Zaten ekli', msg);
      else toast.error('Foto iliştirilemedi', msg);
    },
  });

  const autoLinkWooMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ linked: number; skipped_no_match: number; already_linked: number }>(
        '/api/v2/woocommerce/catalog/auto-link-by-sku',
        { method: 'POST' },
      ),
    onSuccess: async (result) => {
      await invalidateDepolama();
      await queryClient.invalidateQueries({ queryKey: ['woocommerce'] });
      toast.success('Woo bağlama tamamlandı', `${result.linked} ürün bağlandı, ${result.skipped_no_match} eşleşmedi.`);
    },
    onError: (error) => {
      toast.error('Woo bağlama başarısız', extractApiMessage(error, 'Sunucu hatası'));
    },
  });

  async function printLabel(productId: string, productLabel: string) {
    setRetryingLabelId(productId);
    try {
      await downloadAuthedDocument(
        `/api/v2/depolama/products/${productId}/label`,
        `etiket-${productLabel || productId}.escpos`,
      );
      toast.success('Etiket indirildi', 'Thermal printera gönderebilirsiniz.');
    } catch (error) {
      toast.error('Etiket alınamadı', extractApiMessage(error, 'Sunucu hatası'));
    } finally {
      setRetryingLabelId(null);
    }
  }

  function startNew() {
    setActiveView('system');
    setSelectedProductId(null);
    setEditing(buildNewItem(categoryScope === 'all' ? 'taki' : activeKat, gumusAlt, platinAlt));
  }

  function saveItem() {
    if (!editing) return;
    if (!editing.urun.trim()) {
      toast.warning('Ürün adı zorunlu', 'Lütfen "Ürün / Vare" alanını doldurun.');
      return;
    }
    if (editing.birimGram <= 0) {
      toast.warning('Birim gram zorunlu', 'Gram değeri 0\'dan büyük olmalıdır.');
      return;
    }
    if (editing.alisFiyati <= 0) {
      toast.warning('Alış fiyatı zorunlu', 'Alış fiyatı 0\'dan büyük olmalıdır.');
      return;
    }
    const exists = stokList.some((item) => item.id === editing.id);
    if (exists) {
      // Optimistic concurrency için detailQuery'den updated_at iletilir
      const detail = detailQuery.data;
      const updatedAt = detail && detail.id === editing.id ? detail.updated_at ?? undefined : undefined;
      updateProductMutation.mutate({
        productId: editing.id,
        item: { ...editing, updatedAt },
      });
      return;
    }
    createProductMutation.mutate(editing);
  }

  function deleteItem(productId: string) {
    deleteProductMutation.mutate(productId);
  }

  function openDetail(productId: string) {
    setActiveView('system');
    setSelectedProductId(productId);
  }

  function closeDetail() {
    setSelectedProductId(null);
  }

  function openWooProduct(productId: string) {
    navigate(`/woocommerce?product=${encodeURIComponent(productId)}`);
  }

  function updateProductStatus(
    productId: string,
    nextStatus: InventoryLifecycleStatus,
    meltReason?: string | null,
    salePriceDkk?: number | null,
  ) {
    const detail = detailQuery.data;
    const expectedUpdatedAt = detail && detail.id === productId ? detail.updated_at : null;
    updateStatusMutation.mutate({
      productId,
      status: nextStatus,
      meltReason,
      expectedUpdatedAt,
      salePriceDkk,
    });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  return {
    loading: workspaceQuery.isLoading,
    activeView,
    setActiveView,
    stokList,
    prices,
    setPrices,
    priceOpen,
    setPriceOpen,
    activeKat,
    setActiveKat,
    categoryScope,
    setCategoryScope,
    gumusAlt,
    setGumusAlt,
    platinAlt,
    setPlatinAlt,
    editing,
    setEditing,
    selectedProductId,
    selectedProduct: detailQuery.data ?? null,
    loadingSelectedProduct: detailQuery.isLoading,
    detailError: detailQuery.isError,
    productHistory: historyQuery.data ?? [],
    productHistoryLoading: historyQuery.isLoading,
    productSourceAfg: sourceAfgQuery.data ?? null,
    productSourceAfgLoading: sourceAfgQuery.isLoading,
    opdateret,
    startNew,
    saveItem,
    deleteItem,
    onOpenWorkbookPreview: () => setActiveView('excel'),
    onOpenDetail: openDetail,
    onCloseDetail: closeDetail,
    onRetryDetail: () => {
      void detailQuery.refetch();
    },
    onOpenWooProduct: openWooProduct,
    onUpdateProductStatus: updateProductStatus,
    savePrices: () => savePricesMutation.mutate(prices),
    savingItem: createProductMutation.isPending || updateProductMutation.isPending,
    deletingItem: deleteProductMutation.isPending,
    savingPrices: savePricesMutation.isPending,
    updatingStatus: updateStatusMutation.isPending,
    filters,
    setFilters,
    resetFilters,
    sort,
    setSort,
    onPrintLabel: printLabel,
    printingLabelForId: retryingLabelId,
    onUploadPhotos: (productId: string, files: FileList | File[]) =>
      uploadPhotosMutation.mutate({ productId, files }),
    uploadingPhotos: uploadPhotosMutation.isPending,
    onDeletePhoto: (productId: string, photoId: string) =>
      deletePhotoMutation.mutate({ productId, photoId }),
    deletingPhoto: deletePhotoMutation.isPending,
    onAttachLibraryPhoto: (productId: string, file: string) =>
      attachLibraryPhotoMutation.mutate({ productId, file }),
    attachingLibraryPhoto: attachLibraryPhotoMutation.isPending,
    onAutoLinkWoo: () => autoLinkWooMutation.mutate(),
    autoLinkingWoo: autoLinkWooMutation.isPending,
  };
}
