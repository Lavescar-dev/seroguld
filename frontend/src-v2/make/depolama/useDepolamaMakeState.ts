import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { apiRequest } from '@/lib/api';
import { emitArtifactSync, listenArtifactSync } from '@/lib/artifactSync';
import type { InventoryGridRow, InventoryWorkspace, OfficeRuntimeStatus, ProductOut } from '@/types';

import type { DepolamaPageProps } from './DepolamaPage';
import type {
  InventoryLifecycleStatus,
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
    shopFiyati: row.shop_fiyati_dkk ? numeric(row.shop_fiyati_dkk) : undefined,
    shopDurumu: (row.shop_sync_status as StokItem['shopDurumu']) || undefined,
    olcuUzunluk: row.length_cm || undefined,
    olcuGenislik: row.width_mm ? numeric(row.width_mm) : undefined,
    olcuKalinlik: row.thickness_mm ? numeric(row.thickness_mm) : undefined,
    uretici: row.producer || undefined,
    notlar: row.notes || undefined,
    storageLocation: row.storage_location || undefined,
    referenceNumber: row.reference_number || null,
    productNumber: row.product_number,
    needsCleaning: row.needs_cleaning,
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
  return new Date().toLocaleDateString('da-DK');
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
    length_cm: item.olcuUzunluk || null,
    width_mm: item.olcuGenislik ?? null,
    thickness_mm: item.olcuKalinlik ?? null,
    producer: item.uretici || null,
    inventory_category: spec.inventory_category,
    inventory_subcategory: spec.inventory_subcategory,
  };
}

export function useDepolamaMakeState(): DepolamaPageProps {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [prices, setPrices] = useState<MarketPrices>(DEFAULT_MARKET_PRICES);
  const [priceOpen, setPriceOpen] = useState(false);
  const [activeKat, setActiveKat] = useState<MainCategory>('kulce');
  const [gumusAlt, setGumusAlt] = useState<SilverSub>('smykker');
  const [platinAlt, setPlatinAlt] = useState<PlatinumSub>('platin');
  const [activeView, setActiveView] = useState<InventorySurfaceView>('system');
  const [editing, setEditing] = useState<StokItem | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [opdateret, setOpdateret] = useState<string>(() => readUpdated());

  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['office-runtime-status', 'depolama'],
      queryFn: () => apiRequest<OfficeRuntimeStatus>('/api/v2/office-runtime/status?kind=depolama'),
      staleTime: 30_000,
    });
  }, [queryClient]);

  const workspaceQuery = useQuery({
    queryKey: ['depolama', 'workspace'],
    queryFn: () => apiRequest<InventoryWorkspace>('/api/v2/depolama/workspace'),
  });

  const visibleRows = useMemo(
    () => (workspaceQuery.data?.rows || []).filter(isStorageVisible),
    [workspaceQuery.data?.rows],
  );

  const stokList = useMemo(() => visibleRows.map(rowToStokItem), [visibleRows]);
  const detailQuery = useQuery({
    queryKey: ['depolama', 'product', selectedProductId],
    enabled: Boolean(selectedProductId),
    queryFn: () => apiRequest<ProductOut>(`/api/v2/depolama/products/${selectedProductId}`),
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
    if (!selectedProductId) return;
    if (stokList.some((item) => item.id === selectedProductId)) return;
    setSelectedProductId(null);
  }, [selectedProductId, stokList]);

  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.kind !== 'depolama' || signal.source === 'depolama-ui') return;
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
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      productId,
      status,
      meltReason,
    }: {
      productId: string;
      status: InventoryLifecycleStatus;
      meltReason?: string | null;
    }) =>
      apiRequest<ProductOut>(`/api/v2/depolama/products/${productId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          melt_reason: meltReason || null,
        }),
      }),
    onSuccess: async (product) => {
      await invalidateDepolama(product.id);
      markUpdatedNow();
      emitArtifactSync({ kind: 'depolama', key: 'live', source: 'depolama-ui' });
      if (product.status === 'melted' || product.status === 'sold') {
        setSelectedProductId(null);
      }
    },
  });

  function startNew() {
    setActiveView('system');
    setSelectedProductId(null);
    setEditing(buildNewItem(activeKat, gumusAlt, platinAlt));
  }

  function saveItem() {
    if (!editing) return;
    if (!editing.urun.trim()) {
      if (typeof window !== 'undefined') {
        window.alert('Ürün adı zorunludur!');
      }
      return;
    }
    const exists = stokList.some((item) => item.id === editing.id);
    if (exists) {
      updateProductMutation.mutate({ productId: editing.id, item: editing });
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

  function updateProductStatus(productId: string, status: InventoryLifecycleStatus, meltReason?: string | null) {
    updateStatusMutation.mutate({ productId, status, meltReason });
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
    gumusAlt,
    setGumusAlt,
    platinAlt,
    setPlatinAlt,
    editing,
    setEditing,
    selectedProductId,
    selectedProduct: detailQuery.data ?? null,
    loadingSelectedProduct: detailQuery.isLoading,
    opdateret,
    startNew,
    saveItem,
    deleteItem,
    onOpenWorkbookPreview: () => setActiveView('excel'),
    onOpenDetail: openDetail,
    onCloseDetail: closeDetail,
    onOpenWooProduct: openWooProduct,
    onUpdateProductStatus: updateProductStatus,
    savePrices: () => savePricesMutation.mutate(prices),
    savingItem: createProductMutation.isPending || updateProductMutation.isPending,
    deletingItem: deleteProductMutation.isPending,
    savingPrices: savePricesMutation.isPending,
    updatingStatus: updateStatusMutation.isPending,
  };
}
