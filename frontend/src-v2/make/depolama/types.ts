export type MainCategory = 'kulce' | 'sikke' | 'taki' | 'gumus' | 'platin_pd';
export type SilverSub = 'smykker' | 'barrer' | 'monter';
export type PlatinumSub = 'platin' | 'palladyum';
export type ShopDurumu = 'hazir' | 'mangler_foto' | 'listelendi';
export type InventorySurfaceView = 'system' | 'excel';
export type InventoryLifecycleStatus = 'in_inventory' | 'for_sale' | 'undecided' | 'melted';

export const PRODUCT_STATUS_LABEL: Record<string, string> = {
  purchased: 'Giriş Bekliyor',
  in_inventory: 'Depoda',
  for_sale: 'Satış Hazır',
  undecided: 'Karar Bekliyor',
  sold: 'Satıldı',
  melted: 'Eritildi',
};

// Backend `_allowed_status_transition` ile sync (product_service.py:120-145)
export const ALLOWED_STATUS_TRANSITIONS: Record<string, InventoryLifecycleStatus[]> = {
  // GDPR penceresi bilgilendirme: taze alım doğrudan satışa alınabilir.
  purchased: ['in_inventory', 'undecided', 'melted', 'for_sale'],
  in_inventory: ['for_sale', 'melted', 'undecided'],
  for_sale: ['in_inventory', 'melted'], // sold ayrı akış (sale_price gerek)
  undecided: ['in_inventory', 'for_sale', 'melted'],
  sold: [],
  melted: [],
};

export interface MarketPrices {
  gold: number;
  silver: number;
  platin: number;
  palladyum: number;
}

export interface StokItem {
  id: string;
  stokNo?: string;
  mainKat: MainCategory;
  gumusAlt?: SilverSub;
  platinAlt?: PlatinumSub;
  lagerDato: string;
  urun: string;
  saflik: number;
  birimGram: number;
  adet: number;
  alisFiyati: number;
  shopFiyati?: number;
  shopDurumu?: ShopDurumu;
  olcuUzunluk?: string;
  olcuGenislik?: number;
  olcuKalinlik?: number;
  olcuCap?: number;
  uretici?: string;
  notlar?: string;
  storageLocation?: string;
  referenceNumber?: string | null;
  productNumber?: string;
  needsCleaning?: boolean;
  /** Backend'den gelen authoritative değerler — client tarafında tekrar hesaplama yapılmaz */
  spotDegeri?: number;
  hasMetalGrams?: number;
  toplamGram?: number;
  shopFark?: number;
  isGdprLocked?: boolean;
  productStatus?: string;
  /** Yeni eklenen field — düzenleme dispatch'i için optimistic concurrency */
  updatedAt?: string;
}

export interface CategoryTotals {
  toplamGramSum: number;
  hasMetalSum: number;
  alisSum: number;
  spotSum: number;
  shopSum: number;
}

export type InventorySortKey =
  | 'lager_dato'
  | 'urun'
  | 'birim_gram'
  | 'toplam_gram'
  | 'alis_fiyati'
  | 'spot_degeri'
  | 'shop_fiyati'
  | 'storage_location';

export interface InventorySortState {
  key: InventorySortKey;
  direction: 'asc' | 'desc';
}

export interface InventoryFilterState {
  q: string;
  dateFrom: string;
  dateTo: string;
  weightMin: string;
  weightMax: string;
  priceMin: string;
  priceMax: string;
  location: string;
  needsCleaning: boolean;
  gdprLocked: 'all' | 'locked' | 'unlocked';
}

export const EMPTY_FILTERS: InventoryFilterState = {
  q: '',
  dateFrom: '',
  dateTo: '',
  weightMin: '',
  weightMax: '',
  priceMin: '',
  priceMax: '',
  location: '',
  needsCleaning: false,
  gdprLocked: 'all',
};

export function describeActiveInventoryFilters(
  filters: InventoryFilterState,
  categoryScope: MainCategory | 'all',
): string[] {
  const active: string[] = [];
  if (categoryScope !== 'all') active.push('kategori seçimi');
  if (filters.q.trim()) active.push(`arama "${filters.q.trim()}"`);
  if (filters.location.trim()) active.push(`lokasyon "${filters.location.trim()}"`);
  if (filters.dateFrom || filters.dateTo) active.push('tarih aralığı');
  if (filters.weightMin || filters.weightMax) active.push('gram aralığı');
  if (filters.priceMin || filters.priceMax) active.push('fiyat aralığı');
  if (filters.needsCleaning) active.push('temizlik bekleyenler');
  if (filters.gdprLocked !== 'all') active.push('GDPR kilidi');
  return active;
}
