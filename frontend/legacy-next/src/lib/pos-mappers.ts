import { labelMetalType, labelProductType } from '@/lib/labels';
import type { MetalType, PosDisplayLine, PosDocumentKind, PosSessionLine, PosTradeSide, Product, ProductType } from '@/types';

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeLabel(label: string): string {
  return label === '-' ? '' : label;
}

export function formatMoneyDkk(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return '-';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

export function formatWeight(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return '-';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

export function formatPercent(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return '-';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

export function sortPosDisplayLines(lines: PosDisplayLine[]): PosDisplayLine[] {
  return [...lines].sort((a, b) => a.line_no - b.line_no);
}

export function sortPosSessionLines(lines: PosSessionLine[]): PosSessionLine[] {
  return [...lines].sort((a, b) => a.line_no - b.line_no);
}

export function getPosDocumentKind(tradeSide?: PosTradeSide | null): PosDocumentKind | null {
  if (!tradeSide) return null;
  return tradeSide === 'sell_to_customer' ? 'faktura' : 'afregningsbilag';
}

export function labelPosDocumentKind(kind?: PosDocumentKind | null): string {
  if (!kind) return '-';
  return kind === 'faktura' ? 'Faktura' : 'Afregningsbilag';
}

export function toExcelTypeLabel(productType?: ProductType | null, metalType?: MetalType | null): string {
  const productLabel = safeLabel(labelProductType(productType));
  const metalLabel = safeLabel(labelMetalType(metalType));
  if (!productLabel && !metalLabel) return '-';
  if (!productLabel) return metalLabel;
  if (!metalLabel) return productLabel;
  return `${productLabel} · ${metalLabel}`;
}

export function formatKaratFinhed(
  purityKarat?: string | null,
  purityPercentage?: string | number | null,
): string {
  const karatLabel = (purityKarat || '').trim();
  const purityLabel = formatPercent(purityPercentage);
  if (karatLabel && purityLabel !== '-') {
    return `${karatLabel} / ${purityLabel}%`;
  }
  if (karatLabel) return karatLabel;
  if (purityLabel !== '-') return `${purityLabel}%`;
  return '-';
}

export function toLodighed(purityKarat?: string | null, purityPercentage?: string | number | null): string {
  const pct = toNumber(purityPercentage);
  if (pct !== null && pct > 0 && pct <= 100) {
    return `${Math.round(pct * 10)}`;
  }

  const karat = (purityKarat || '').trim().toUpperCase();
  if (!karat) return '-';

  const digits = karat.replace(/[^\d.]/g, '');
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return karat;
  }

  if (karat.includes('K') && parsed <= 24) {
    return `${Math.round((parsed / 24) * 1000)}`;
  }

  if (parsed > 24 && parsed <= 1000) {
    return `${Math.round(parsed)}`;
  }

  if (parsed > 1000 && parsed <= 10000) {
    return `${Math.round(parsed / 10)}`;
  }

  return karat;
}

export function computeLineOfferDkk(params: {
  tradeSide: PosTradeSide;
  weightGrams?: string | number | null;
  purityPercentage?: string | number | null;
  rateDkk?: string | number | null;
  marginPercent?: string | number | null;
}): number | null {
  const weight = toNumber(params.weightGrams);
  const purity = toNumber(params.purityPercentage);
  const rate = toNumber(params.rateDkk);
  const margin = toNumber(params.marginPercent) ?? 0;
  if (weight === null || purity === null || rate === null) return null;
  if (weight <= 0 || purity < 0 || purity > 100 || rate <= 0 || margin < 0 || margin > 100) return null;

  const pureGrams = weight * (purity / 100);
  const multiplier = params.tradeSide === 'sell_to_customer' ? 1 + margin / 100 : 1 - margin / 100;
  return Number((pureGrams * rate * multiplier).toFixed(2));
}

export function computePureMetalGrams(
  weightGrams?: string | number | null,
  purityPercentage?: string | number | null,
): number | null {
  const weight = toNumber(weightGrams);
  const purity = toNumber(purityPercentage);
  if (weight === null || purity === null) return null;
  if (weight < 0 || purity < 0 || purity > 100) return null;
  return Number((weight * (purity / 100)).toFixed(2));
}

export function sumDisplayLineMetrics(lines: PosDisplayLine[]): {
  totalWeightGrams: number;
  totalPureMetalGrams: number;
} {
  return lines.reduce(
    (totals, line) => ({
      totalWeightGrams: totals.totalWeightGrams + (toNumber(line.weight_grams) ?? 0),
      totalPureMetalGrams: totals.totalPureMetalGrams + (computePureMetalGrams(line.weight_grams, line.purity_percentage) ?? 0),
    }),
    { totalWeightGrams: 0, totalPureMetalGrams: 0 },
  );
}

export type PosExcelLineView = {
  lineNo: number;
  typeLabel: string;
  excelTypeLabel: string;
  metalLabel: string;
  karatFinhed: string;
  lodighed: string;
  weightText: string;
  unitRateText: string;
  totalText: string;
  notes: string;
};

export function mapPosDisplayLineToExcelView(line: PosDisplayLine): PosExcelLineView {
  const typeLabel = labelProductType(line.product_type);
  const metalLabel = labelMetalType(line.metal_type);
  return {
    lineNo: line.line_no,
    typeLabel,
    excelTypeLabel: toExcelTypeLabel(line.product_type, line.metal_type),
    metalLabel,
    karatFinhed: formatKaratFinhed(line.purity_karat, line.purity_percentage),
    lodighed: toLodighed(line.purity_karat, line.purity_percentage),
    weightText: `${formatWeight(line.weight_grams)} g`,
    unitRateText: `${formatMoneyDkk(line.rate_dkk)} DKK/g`,
    totalText: `${formatMoneyDkk(line.line_offer_dkk)} DKK`,
    notes: line.notes?.trim() || '-',
  };
}

export function mapPosSessionLineToExcelView(line: PosSessionLine): PosExcelLineView {
  const typeLabel = labelProductType(line.product_type);
  const metalLabel = labelMetalType(line.metal_type);
  return {
    lineNo: line.line_no,
    typeLabel,
    excelTypeLabel: toExcelTypeLabel(line.product_type, line.metal_type),
    metalLabel,
    karatFinhed: formatKaratFinhed(line.purity_karat, line.purity_percentage),
    lodighed: toLodighed(line.purity_karat, line.purity_percentage),
    weightText: `${formatWeight(line.weight_grams)} g`,
    unitRateText: `${formatMoneyDkk(line.rate_dkk)} DKK/g`,
    totalText: `${formatMoneyDkk(line.line_offer_dkk)} DKK`,
    notes: line.notes?.trim() || '-',
  };
}

export type PosAfregningsLineView = {
  type: string;
  karatFinhed: string;
  lodighed: string;
  weightGramsText: string;
  unitRateText: string;
  totalText: string;
  lineNo: number;
  note: string;
};

export function mapPosSessionLineToAfregningsRow(line: PosSessionLine): PosAfregningsLineView {
  return {
    type: toExcelTypeLabel(line.product_type, line.metal_type),
    karatFinhed: formatKaratFinhed(line.purity_karat, line.purity_percentage),
    lodighed: toLodighed(line.purity_karat, line.purity_percentage),
    weightGramsText: formatWeight(line.weight_grams),
    unitRateText: formatMoneyDkk(line.rate_dkk),
    totalText: formatMoneyDkk(line.line_offer_dkk),
    lineNo: line.line_no,
    note: (line.notes || '').trim(),
  };
}

export type PosLagerRowView = {
  productLabel: string;
  weightGramsText: string;
  unitCount: number;
  totalWeightText: string;
  pureGoldText: string;
  purchasePriceText: string;
  spotValueText: string;
};

export function mapPosSessionLineToLagerRow(line: PosSessionLine): PosLagerRowView {
  const weight = toNumber(line.weight_grams) ?? 0;
  const pure = computePureMetalGrams(line.weight_grams, line.purity_percentage) ?? 0;
  const rate = toNumber(line.rate_dkk) ?? 0;
  const spot = pure * rate;
  return {
    productLabel: toExcelTypeLabel(line.product_type, line.metal_type),
    weightGramsText: formatWeight(weight),
    unitCount: 1,
    totalWeightText: formatWeight(weight),
    pureGoldText: formatWeight(pure),
    purchasePriceText: formatMoneyDkk(line.line_offer_dkk),
    spotValueText: formatMoneyDkk(spot),
  };
}

export type ProductLagerRowView = PosLagerRowView & {
  primaryPhoto: string | null;
  producer: string;
  lengthCm: string;
  widthMm: string;
  thicknessMm: string;
  shopSyncStatus: string;
};

export function mapProductToLagerRow(product: Product): ProductLagerRowView {
  const baseWeight = toNumber(product.weight_grams) ?? 0;
  const totalWeight = toNumber(product.total_weight_grams) ?? baseWeight;
  const pure = toNumber(product.pure_gold_grams) ?? computePureMetalGrams(totalWeight, product.purity_percentage) ?? 0;
  return {
    productLabel: toExcelTypeLabel(product.product_type, product.metal_type),
    weightGramsText: formatWeight(baseWeight),
    unitCount: product.unit_count ?? 1,
    totalWeightText: formatWeight(totalWeight),
    pureGoldText: formatWeight(pure),
    purchasePriceText: formatMoneyDkk(product.purchase_price_dkk),
    spotValueText: formatMoneyDkk(product.spot_value_dkk),
    primaryPhoto: product.primary_photo || product.image || product.photos?.find((photo) => photo.is_primary)?.url || null,
    producer: product.producer || '-',
    lengthCm: product.length_cm || '-',
    widthMm: product.width_mm || '-',
    thicknessMm: product.thickness_mm || '-',
    shopSyncStatus: product.shop_sync_status || '-',
  };
}

export type PosLogRowView = {
  weightText: string;
  amountText: string;
  pureGoldText: string;
  lineNo: number;
};

export function mapPosSessionLineToLogRow(line: PosSessionLine): PosLogRowView {
  const weight = toNumber(line.weight_grams) ?? 0;
  const pure = computePureMetalGrams(line.weight_grams, line.purity_percentage) ?? 0;
  return {
    weightText: formatWeight(weight),
    amountText: formatMoneyDkk(line.line_offer_dkk),
    pureGoldText: formatWeight(pure),
    lineNo: line.line_no,
  };
}

export function lineSignature(line: PosDisplayLine): string {
  return [
    line.line_no,
    line.product_type,
    line.metal_type,
    line.weight_grams,
    line.purity_karat || '',
    line.purity_percentage,
    line.rate_dkk || '',
    line.line_offer_dkk || '',
    line.notes || '',
  ].join('|');
}
