import { IdentityDocType, MetalType, PosSessionStatus, PosTradeSide, ProductStatus, ProductType } from '@/types';

const productTypeLabels: Record<ProductType, string> = {
  bracelet: 'Bilezik',
  ring: 'Yüzük',
  necklace: 'Kolye',
  earring: 'Küpe',
  chain: 'Zincir',
  bar: 'Bar',
  jewelry: 'Takı',
};

const metalTypeLabels: Record<MetalType, string> = {
  yellow_gold: 'Sarı Altın',
  white_gold: 'Beyaz Altın',
  silver: 'Gümüş',
  platinum: 'Platin',
  palladium: 'Palladium',
};

const productStatusLabels: Record<ProductStatus, string> = {
  purchased: 'Alındı',
  in_inventory: 'Envanterde',
  for_sale: 'Satışta',
  sold: 'Satıldı',
  melted: 'Eritildi',
  undecided: 'Kararsız',
};

const identityDocTypeLabels: Record<IdentityDocType, string> = {
  passport: 'Pasaport',
  id_card: 'Kimlik Kartı',
  driver_license: 'Ehliyet',
};

const posStatusLabels: Record<PosSessionStatus, string> = {
  draft: 'Taslak',
  confirmed: 'Onaylandı',
  cancelled: 'İptal Edildi',
};

const posTradeSideLabels: Record<PosTradeSide, string> = {
  buy_from_customer: 'Müşteriden Alış',
  sell_to_customer: 'Müşteriye Satış',
};

export function labelProductType(value?: ProductType | null): string {
  if (!value) return '-';
  return productTypeLabels[value] || value;
}

export function labelMetalType(value?: MetalType | null): string {
  if (!value) return '-';
  return metalTypeLabels[value] || value;
}

export function labelProductStatus(value?: ProductStatus | null): string {
  if (!value) return '-';
  return productStatusLabels[value] || value;
}

export function labelIdentityDocType(value?: IdentityDocType | null): string {
  if (!value) return '-';
  return identityDocTypeLabels[value] || value;
}

export function labelPosStatus(value?: PosSessionStatus | null): string {
  if (!value) return '-';
  return posStatusLabels[value] || value;
}

export function labelPosTradeSide(value?: PosTradeSide | null): string {
  if (!value) return '-';
  return posTradeSideLabels[value] || value;
}
