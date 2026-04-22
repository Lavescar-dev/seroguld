export type MainCategory = 'kulce' | 'sikke' | 'taki' | 'gumus' | 'platin_pd';
export type SilverSub = 'smykker' | 'barrer' | 'monter';
export type PlatinumSub = 'platin' | 'palladyum';
export type ShopDurumu = 'hazir' | 'mangler_foto' | 'listelendi';
export type InventorySurfaceView = 'system' | 'excel';
export type InventoryLifecycleStatus = 'in_inventory' | 'for_sale' | 'undecided' | 'melted';

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
  uretici?: string;
  notlar?: string;
  storageLocation?: string;
  referenceNumber?: string | null;
  productNumber?: string;
  needsCleaning?: boolean;
}

export interface CategoryTotals {
  toplamGramSum: number;
  hasMetalSum: number;
  alisSum: number;
  spotSum: number;
  shopSum: number;
}
