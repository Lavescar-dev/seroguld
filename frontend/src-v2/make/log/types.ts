import type { AfgWorkspaceLine, LogMeltLot } from '@/types';

export type RouteDestination = 'inventory' | 'undecided' | 'melt';

export type LineDraft = {
  classification: 'standard' | 'jewelry_cleaning' | 'white_gold' | 'separate_storage';
  note: string;
  destination: RouteDestination;
};

export type MeltLotDraft = {
  sent_date: string;
  purchased_from_date: string;
  after_pure_gold_grams: string;
  insurance_dkk: string;
  shipping_dkk: string;
  refining_dkk: string;
  sale_date: string;
  quote_eur: string;
  exchange_rate_dkk: string;
  payout_total_dkk: string;
  notes: string;
};

export type SplitGroupKey = 'jewelry_cleaning' | 'white_gold' | 'separate_storage';
export type LogActiveTab = 'gold' | 'silver';
export type LogSurfaceView = 'system' | 'excel';

export const classificationOptions: Array<LineDraft['classification']> = [
  'standard',
  'jewelry_cleaning',
  'white_gold',
  'separate_storage',
];

export function defaultDestination(line: AfgWorkspaceLine): RouteDestination {
  if (line.operation_destination === 'inventory' || line.operation_destination === 'melt' || line.operation_destination === 'undecided') {
    return line.operation_destination;
  }
  return 'undecided';
}

export function defaultClassification(line: AfgWorkspaceLine): LineDraft['classification'] {
  if (line.operation_classification && classificationOptions.includes(line.operation_classification as LineDraft['classification'])) {
    return line.operation_classification as LineDraft['classification'];
  }
  if (line.metal_type === 'white_gold') return 'white_gold';
  return 'standard';
}

function toDateValue(value?: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function toLotDraft(lot: LogMeltLot): MeltLotDraft {
  return {
    sent_date: toDateValue(lot.sent_date),
    purchased_from_date: toDateValue(lot.purchased_from_date),
    after_pure_gold_grams: lot.after_pure_gold_grams || '',
    insurance_dkk: lot.insurance_dkk || '',
    shipping_dkk: lot.shipping_dkk || '',
    refining_dkk: lot.refining_dkk || '',
    sale_date: toDateValue(lot.sale_date),
    quote_eur: lot.quote_eur || '',
    exchange_rate_dkk: lot.exchange_rate_dkk || '',
    payout_total_dkk: lot.payout_total_dkk || '',
    notes: lot.notes || '',
  };
}
