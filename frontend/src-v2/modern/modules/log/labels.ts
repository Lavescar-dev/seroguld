// Classic LogPage ile Modern log yüzeyinin paylaştığı etiket/ton yardımcıları.
// Hex renk yok — grup renkleri yalnız sg-* ton token'ları üzerinden verilir.
import { labelOperationState } from '@/lib/format';
import type { SplitGroupKey } from '@/make/log/types';
import type { AfgWorkspaceLine } from '@/types';

export type ModernTone = 'neutral' | 'success' | 'warning' | 'danger';

export const LOT_STATUS_LABEL: Record<string, string> = {
  draft: 'Taslak',
  finalized: 'Kesinleşti',
};

export function labelLotStatus(status?: string | null): string {
  return LOT_STATUS_LABEL[status || 'draft'] || status || 'Taslak';
}

// Backend gerçekleri: history action enum'u line_attached / line_detached
// (Classic referans LogPage.tsx:507-515).
const LOT_HISTORY_ACTION_LABEL: Record<string, string> = {
  created: 'Oluşturuldu',
  updated: 'Güncellendi',
  deleted: 'Silindi',
  finalized: 'Finalize edildi',
  reopened: 'Tekrar açıldı',
  line_attached: 'Satır bağlandı',
  line_detached: 'Satır ayrıldı',
};

export function labelLotHistoryAction(action: string): string {
  return LOT_HISTORY_ACTION_LABEL[action] || action;
}

// Classic LogPage.tsx:124-129 — rota öncelikli etkin satır durumu.
export function effectiveLineState(line: AfgWorkspaceLine): string {
  if (line.operation_destination === 'melt') return 'melted';
  if (line.operation_destination === 'inventory') return 'in_inventory';
  if (line.operation_destination === 'undecided') return 'undecided';
  return line.product_status || line.operation_destination || 'awaiting_decision';
}

export function labelLineState(line: AfgWorkspaceLine): string {
  const state = effectiveLineState(line);
  if (line.product_status === 'melted') return 'Eritildi';
  if (line.product_status === 'sold') return 'Satıldı';
  return labelOperationState(state);
}

// lib/format statusTone karşılığı — Modern token tonlarına (toneBadgeClass) eşleme.
export function lineStateTone(state: string): ModernTone {
  if (state === 'in_inventory' || state === 'sold') return 'success';
  if (state === 'melted') return 'danger';
  if (state === 'undecided') return 'warning';
  return 'neutral';
}

export function lineTone(line: AfgWorkspaceLine): ModernTone {
  return lineStateTone(effectiveLineState(line));
}

export interface SplitGroupMeta {
  badge: string;
  label: string;
  badgeClass: string;
  textClass: string;
  borderClass: string;
  softClass: string;
  barClass: string;
}

// S → amber, H → blue, D → accent (Classic splitMeta renklerinin token karşılığı).
export const SPLIT_GROUP_META: Record<SplitGroupKey, SplitGroupMeta> = {
  jewelry_cleaning: {
    badge: 'S',
    label: 'Kuyum / temizlik',
    badgeClass: 'border-sg-amber/40 bg-sg-amber-soft text-sg-amber',
    textClass: 'text-sg-amber',
    borderClass: 'border-sg-amber/40',
    softClass: 'bg-sg-amber-soft',
    barClass: 'bg-sg-amber',
  },
  white_gold: {
    badge: 'H',
    label: 'Beyaz altın',
    badgeClass: 'border-sg-blue/40 bg-sg-blue-soft text-sg-blue',
    textClass: 'text-sg-blue',
    borderClass: 'border-sg-blue/40',
    softClass: 'bg-sg-blue-soft',
    barClass: 'bg-sg-blue',
  },
  separate_storage: {
    badge: 'D',
    label: 'Ayrı depo',
    badgeClass: 'border-sg-accent/40 bg-sg-accent-soft text-sg-accent-dark',
    textClass: 'text-sg-accent-dark',
    borderClass: 'border-sg-accent/40',
    softClass: 'bg-sg-accent-soft',
    barClass: 'bg-sg-accent',
  },
};

// L13 — Payout variance: estimated vs payout %5+ fark (Classic LogPage.tsx:1585-1592).
export const PAYOUT_VARIANCE_THRESHOLD_PERCENT = 5;

export function payoutVariancePercent(
  payoutTotalDkk?: string | number | null,
  estimatedSaleValueDkk?: string | number | null,
): number {
  const payout = Number(payoutTotalDkk || 0);
  const estimated = Number(estimatedSaleValueDkk || 0);
  if (!(payout > 0) || !(estimated > 0)) return 0;
  return (Math.abs(payout - estimated) / estimated) * 100;
}

export function hasPayoutVariance(
  payoutTotalDkk?: string | number | null,
  estimatedSaleValueDkk?: string | number | null,
): boolean {
  const payout = Number(payoutTotalDkk || 0);
  const estimated = Number(estimatedSaleValueDkk || 0);
  if (!(payout > 0) || !(estimated > 0)) return false;
  return payoutVariancePercent(payout, estimated) >= PAYOUT_VARIANCE_THRESHOLD_PERCENT;
}
