import type { LogPageProps } from '@/make/log/LogPage';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { buildBucketGroups, resolveLineDraft, splitGroupKeyForDraft, sumLines, toFloat } from '@/make/log/lineHelpers';
import type { LineDraft, SplitGroupKey } from '@/make/log/types';
import type { AfgWorkspaceDocument, AfgWorkspaceLine, LogBucketWorkspace } from '@/types';

import type { TransitionBlockerDescriptor, UnsupportedControlDescriptor } from './types';

export interface ModernLogLineTotals {
  weight: number;
  amount: number;
  pure: number;
}

export type ModernLogSplitGroups = Record<SplitGroupKey, AfgWorkspaceLine[]>;
export type ModernLogSplitTotals = Record<SplitGroupKey, ModernLogLineTotals>;
export type ModernLogSplitCounts = Record<SplitGroupKey, number>;

const SPLIT_KEYS: SplitGroupKey[] = ['jewelry_cleaning', 'white_gold', 'separate_storage'];

export interface ModernLogSelectedDocument {
  document: AfgWorkspaceDocument;
  /** Standart sınıflandırmada bekleyen satırlar (hiçbir ayrım grubuna düşmeyenler). */
  pending: AfgWorkspaceLine[];
  groups: ModernLogSplitGroups;
  groupedTotals: ModernLogSplitTotals;
  groupedCount: number;
  routedWeight: number;
  routedAmount: number;
  routedPure: number;
  /** Belge toplam has − ayrılan has (negatifse 0'a sabitlenir). */
  remainingPure: number;
}

export interface ModernLogBucketModel {
  bucket: LogBucketWorkspace;
  groups: ModernLogSplitGroups;
  totals: ModernLogSplitTotals;
  counts: ModernLogSplitCounts;
}

export interface ModernLogViewModel {
  state: LogPageProps;
  phase: 'ready' | 'loading' | 'error' | 'empty';
  bucket: LogBucketWorkspace | null;
  /** JSX içinde kullanılan has birimi etiketi (gümüş için 'saf'). */
  pureUnit: 'has' | 'saf';
  /** formatNumber suffix'i (Classic pureLabel karşılığı). */
  pureSuffix: string;
  selectedDocument: ModernLogSelectedDocument | null;
  bucketModel: ModernLogBucketModel | null;
  stats: Array<{ id: string; label: string; value: string; hint?: string }>;
  blocker: TransitionBlockerDescriptor | null;
  unsupportedControls: UnsupportedControlDescriptor[];
}

export function pureUnitLabel(activeTab: LogPageProps['activeTab']): 'has' | 'saf' {
  return activeTab === 'silver' ? 'saf' : 'has';
}

export function pureSuffixLabel(activeTab: LogPageProps['activeTab']): string {
  return activeTab === 'silver' ? ' g saf' : ' g has';
}

export function createLogTransitionBlocker(state: LogPageProps): TransitionBlockerDescriptor | null {
  const reasons: string[] = [];
  if (state.pendingRouteCount > 0) reasons.push(`${state.pendingRouteCount} rota taslağının uygulanması bekleniyor`);
  if (state.routeBusy) reasons.push('Rota güncelleme isteği sürüyor');
  if (state.meltBusy) reasons.push('Eritme lotu kaydı sürüyor');
  if (state.createMeltBusy) reasons.push('Yeni eritme lotu oluşturuluyor');
  if (state.finalizeBusy) reasons.push('Lot kesinleştirme / yeniden açma işlemi sürüyor');
  if (state.deleteBusy) reasons.push('Lot silme işlemi sürüyor');
  if (reasons.length === 0) return null;
  return {
    id: 'log-workspace',
    when: true,
    title: 'Log çalışma alanı koruması',
    description: 'AFG yönlendirme ve eritme değişiklikleri bitmeden görünüm veya rota değişimi engellenmelidir.',
    severity: state.finalizeBusy || state.deleteBusy ? 'danger' : 'warning',
    reasons,
  };
}

// Classic LogPage.tsx:132-154 (buildDocumentGroups) paritesi — belge içi satırları
// ayrım gruplarına ve bekleyenlere ayırır (splitGroupKeyForDraft eşikleri).
export function buildDocumentGroups(document: AfgWorkspaceDocument, lineDrafts: Record<string, LineDraft>): {
  pending: AfgWorkspaceLine[];
  groups: ModernLogSplitGroups;
} {
  const pending: AfgWorkspaceLine[] = [];
  const groups: ModernLogSplitGroups = { jewelry_cleaning: [], white_gold: [], separate_storage: [] };
  for (const line of document.lines) {
    const splitKey = splitGroupKeyForDraft(resolveLineDraft(line, lineDrafts));
    if (splitKey) groups[splitKey].push(line);
    else pending.push(line);
  }
  return { pending, groups };
}

// Classic LogPage.tsx:826-855 (selectedWorkspace) paritesi — belge bazlı ayrılan/kalan türetme.
export function buildSelectedDocumentModel(
  document: AfgWorkspaceDocument | null,
  lineDrafts: Record<string, LineDraft>,
): ModernLogSelectedDocument | null {
  if (!document) return null;
  const { pending, groups } = buildDocumentGroups(document, lineDrafts);
  const groupedTotals: ModernLogSplitTotals = {
    jewelry_cleaning: sumLines(groups.jewelry_cleaning),
    white_gold: sumLines(groups.white_gold),
    separate_storage: sumLines(groups.separate_storage),
  };
  const groupedCount = SPLIT_KEYS.reduce((sum, key) => sum + groups[key].length, 0);
  const routedWeight = SPLIT_KEYS.reduce((sum, key) => sum + groupedTotals[key].weight, 0);
  const routedAmount = SPLIT_KEYS.reduce((sum, key) => sum + groupedTotals[key].amount, 0);
  const routedPure = SPLIT_KEYS.reduce((sum, key) => sum + groupedTotals[key].pure, 0);
  const remainingPure = Math.max(toFloat(document.total_pure_gold_grams) - routedPure, 0);
  return {
    document,
    pending,
    groups,
    groupedTotals,
    groupedCount,
    routedWeight,
    routedAmount,
    routedPure,
    remainingPure,
  };
}

export function buildBucketModel(bucket: LogBucketWorkspace, lineDrafts: Record<string, LineDraft>): ModernLogBucketModel {
  const groups = buildBucketGroups(bucket.documents, lineDrafts);
  return {
    bucket,
    groups,
    totals: {
      jewelry_cleaning: sumLines(groups.jewelry_cleaning),
      white_gold: sumLines(groups.white_gold),
      separate_storage: sumLines(groups.separate_storage),
    },
    counts: {
      jewelry_cleaning: groups.jewelry_cleaning.length,
      white_gold: groups.white_gold.length,
      separate_storage: groups.separate_storage.length,
    },
  };
}

// Classic summaryCards (LogPage.tsx:157-200) paritesi: Toplam Alış Havuzu /
// Toplam Ayrılan (bucket.split_groups) / Eritmeye Giden net (bucket.melt_queue) / Eritme Lotları.
export function buildLogStats(bucket: LogBucketWorkspace | null, pureSuffix: string): ModernLogViewModel['stats'] {
  const summary = bucket?.summary;
  const splitGroups = bucket?.split_groups ?? [];
  const splitWeight = splitGroups.reduce((sum, group) => sum + toFloat(group.total_weight_grams), 0);
  const splitAmount = splitGroups.reduce((sum, group) => sum + toFloat(group.total_amount_dkk), 0);
  const splitPure = splitGroups.reduce((sum, group) => sum + toFloat(group.total_pure_gold_grams), 0);
  const meltQueue = bucket?.melt_queue;
  const lots = bucket?.melt_lots ?? [];
  const lastLot = lots[0];
  const meltAfterPure = lots.reduce((sum, lot) => sum + toFloat(lot.after_pure_gold_grams), 0);

  return [
    {
      id: 'pool',
      label: 'Toplam Alış Havuzu',
      value: formatNumber(summary?.total_weight_grams || 0, ' g'),
      hint: `${formatMoney(summary?.total_amount_dkk || 0)} · ${formatNumber(summary?.total_pure_gold_grams || 0, pureSuffix)} · ${summary?.total_documents || 0} belge`,
    },
    {
      id: 'split',
      label: 'Toplam Ayrılan',
      value: formatNumber(splitWeight, ' g'),
      hint: `${formatMoney(splitAmount)} · ${formatNumber(splitPure, pureSuffix)} · Takı + Beyaz Altın + Depo`,
    },
    {
      id: 'melt-queue',
      label: 'Eritmeye Giden (net)',
      value: formatNumber(meltQueue?.total_weight_grams || 0, ' g'),
      hint: `${formatMoney(meltQueue?.total_amount_dkk || 0)} · ${formatNumber(meltQueue?.total_pure_gold_grams || 0, pureSuffix)} · ${meltQueue?.line_count || 0} satır`,
    },
    {
      id: 'lots',
      label: 'Eritme Lotları',
      value: `${lots.length} lot`,
      hint: lastLot?.sent_date
        ? `Son: ${formatDate(lastLot.sent_date)} · ${formatNumber(meltAfterPure, pureSuffix)}`
        : `${formatNumber(meltAfterPure, pureSuffix)}`,
    },
  ];
}

export function createModernLogViewModel(state: LogPageProps): ModernLogViewModel {
  const bucket = state.activeTab === 'silver' ? state.workspace?.silver : state.workspace?.gold;
  const pureSuffix = pureSuffixLabel(state.activeTab);
  const bucketModel = bucket ? buildBucketModel(bucket, state.lineDrafts) : null;
  const selectedDocument = buildSelectedDocumentModel(
    bucket?.documents.find((document) => document.sequence_no === state.expandedDocument) ?? bucket?.documents[0] ?? null,
    state.lineDrafts,
  );

  return {
    state,
    phase: state.isLoading
      ? 'loading'
      : state.isError
        ? 'error'
        : !bucket || bucket.documents.length === 0
          ? 'empty'
          : 'ready',
    bucket: bucket ?? null,
    pureUnit: pureUnitLabel(state.activeTab),
    pureSuffix,
    selectedDocument,
    bucketModel,
    stats: buildLogStats(bucket ?? null, pureSuffix),
    blocker: createLogTransitionBlocker(state),
    unsupportedControls: [
      { id: 'scanner', label: 'Belge Tarayıcı', reason: 'Belge tarama akışı bu modülde cihaz köprüsü olmadan güvenli değildir.' },
      { id: 'physical-print', label: 'Fiziksel Yazdır', reason: 'PDF dışa aktarımı desteklenir; fiziksel kuyruğa doğrudan yazma modern arayüzde yoktur.' },
    ],
  };
}
