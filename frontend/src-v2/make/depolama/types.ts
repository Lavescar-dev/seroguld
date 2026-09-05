export type MainCategory = 'kulce' | 'sikke' | 'taki' | 'gumus' | 'platin_pd';
export type SilverSub = 'smykker' | 'barrer' | 'monter';
export type PlatinumSub = 'platin' | 'palladyum';
export type ShopDurumu = 'hazir' | 'mangler_foto' | 'listelendi';
export type InventorySurfaceView = 'system' | 'excel';
export type InventoryLifecycleStatus = 'in_inventory' | 'for_sale' | 'undecided' | 'melted' | 'sold';

export const PRODUCT_STATUS_LABEL: Record<string, string> = {
  purchased: 'Giriş Bekliyor',
  in_inventory: 'Depoda',
  for_sale: 'Satış Hazır',
  undecided: 'Karar Bekliyor',
  sold: 'Satıldı',
  melted: 'Eritildi',
};

// Rozet tonu — durum listesi ve tablo rozeti aynı renklendirmeyi kullansın.
export const PRODUCT_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  purchased: 'neutral',
  in_inventory: 'success',
  for_sale: 'success',
  undecided: 'warning',
  sold: 'neutral',
  melted: 'danger',
};

// Tam sınıf adlı rozet renkleri — Tailwind JIT şablon enterpolasyonunu
// (`border-${x}-300`) üretemediği için yüzeyler buradaki tek kaynaktan alır.
// (Klasik drawer + tablo ortak kullanır; modern yüzey sg-* temasıyla ayrı.)
export const PRODUCT_STATUS_BADGE_CLASS: Record<string, string> = {
  purchased: 'border-brand-300 bg-brand-100 text-brand-700',
  in_inventory: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  for_sale: 'border-sky-300 bg-sky-50 text-sky-700',
  undecided: 'border-amber-300 bg-amber-50 text-amber-800',
  sold: 'border-zinc-300 bg-zinc-100 text-zinc-700',
  melted: 'border-rose-300 bg-rose-50 text-rose-700',
};

// Durum filtresi seçenekleri (boş = varsayılan aktif stok görünümü).
export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Aktif stok (varsayılan)' },
  { value: 'in_inventory', label: PRODUCT_STATUS_LABEL.in_inventory },
  { value: 'for_sale', label: PRODUCT_STATUS_LABEL.for_sale },
  { value: 'undecided', label: PRODUCT_STATUS_LABEL.undecided },
  { value: 'purchased', label: PRODUCT_STATUS_LABEL.purchased },
  { value: 'sold', label: PRODUCT_STATUS_LABEL.sold },
  { value: 'melted', label: PRODUCT_STATUS_LABEL.melted },
];

// Backend `_allowed_status_transition` ile sync (product_service.py:120-158)
export const ALLOWED_STATUS_TRANSITIONS: Record<string, InventoryLifecycleStatus[]> = {
  // GDPR penceresi bilgilendirme: taze alım doğrudan satışa alınabilir;
  // purchased → sold da backend'de izinli (0.3.8 kararı, sale_price ile).
  purchased: ['in_inventory', 'undecided', 'melted', 'for_sale', 'sold'],
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
  /** Woo otomatik fiyatı (spot × gram × saflık × (1+markup)) — backend hesaplar */
  wooFiyati?: number;
  wooEksikAlanlar?: string[];
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
  /** Satır thumbnail'ı için ana foto (relative /media/...) + foto sayısı */
  primaryPhoto?: string | null;
  photoCount?: number;
  /** WooCommerce katalog kaydına bağlı mı */
  wooLinked?: boolean;
  /** Yeni eklenen field — düzenleme dispatch'i için optimistic concurrency */
  updatedAt?: string;
  /**
   * Henüz sunucuya POST edilmemiş taslak mı? (buildNewItem işaretler, satırdan
   * gelen öğelerde tanımsız) — Kaydet'te create/update ayrımı listede satır
   * aramak yerine bu bayrağa bağlanır; filtreli liste satırı düşürünce
   * yanlışlıkla duplike ürün oluşmasını engeller.
   */
  isDraft?: boolean;
}

export interface CategoryTotals {
  toplamGramSum: number;
  hasMetalSum: number;
  /** Yalnız sunucudan has_metal_grams gönderilen satırların toplamı (tahmin yok) */
  hasMetalKnownSum: number;
  /** Has metal değeri olmayan (backend None) satır sayısı — footer uyarısı için */
  hasMetalUnknownCount: number;
  adetSum: number;
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
  | 'woo_satis_fiyati'
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
  /** '' = varsayılan aktif stok; aksi halde tek bir ProductStatusEnum değeri */
  status: string;
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
  status: '',
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
  if (filters.status) active.push(`durum: ${PRODUCT_STATUS_LABEL[filters.status] ?? filters.status}`);
  return active;
}
