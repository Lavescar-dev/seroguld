import type { AlisPageProps } from '@/make/alis/AlisPage';
import type { PosSavedPurchaseListItem } from '@/types';
import { formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';

import type { TransitionBlockerDescriptor, UnsupportedControlDescriptor } from './types';

export interface ModernAlisViewModel {
  state: AlisPageProps;
  phase: 'ready' | 'loading' | 'empty';
  documentsSummary: Array<{ id: string; label: string; value: string; hint?: string }>;
  workspaceSummary: Array<{ id: string; label: string; value: string; hint?: string }>;
  documents: PosSavedPurchaseListItem[];
  blocker: TransitionBlockerDescriptor | null;
  unsupportedControls: UnsupportedControlDescriptor[];
}

export function createAlisTransitionBlocker(
  state: AlisPageProps,
  options?: { hasPendingAutosave?: boolean; hasDirtyWorkspace?: boolean },
): TransitionBlockerDescriptor | null {
  const reasons: string[] = [];
  if (!state.workspace) return null;
  if (options?.hasPendingAutosave) reasons.push('Autosave kuyruğu henüz tamamlanmadı');
  if (options?.hasDirtyWorkspace) reasons.push('Workspace değişiklikleri henüz finalize edilmedi');
  if (state.customerPending) reasons.push('Müşteri kartı güncelleniyor');
  if (state.customerSelecting) reasons.push('Müşteri seçimi tamamlanıyor');
  if (state.finalizePending) reasons.push('AFG finalize isteği çalışıyor');
  if (state.cancelPending) reasons.push('Workspace iptal işlemi çalışıyor');
  if (reasons.length === 0) return null;
  return {
    id: 'alis-workspace',
    when: true,
    title: 'Alış Workspace Koruması',
    description: 'AFG workspace açıkken rota değişimi veya panel kapanışı öncesinde bekleyen işlerin bitmesi gerekiyor.',
    severity: state.finalizePending ? 'danger' : 'warning',
    reasons,
  };
}

export function createModernAlisViewModel(
  state: AlisPageProps,
  options?: { hasPendingAutosave?: boolean; hasDirtyWorkspace?: boolean },
): ModernAlisViewModel {
  const documents = state.documents;
  const totalWeight = documents.reduce((sum, item) => sum + Number(item.total_weight_grams || 0), 0);
  const totalAmount = documents.reduce((sum, item) => sum + Number(item.gross_amount_dkk || 0), 0);
  const latestDocument = documents[0] || null;
  const workspace = state.workspace;

  return {
    state,
    phase: !workspace && state.listLoading && documents.length === 0 ? 'loading' : !workspace && documents.length === 0 ? 'empty' : 'ready',
    documents,
    documentsSummary: [
      { id: 'count', label: 'Belge', value: String(documents.length), hint: 'Son 120 kayıt' },
      { id: 'amount', label: 'Toplam DKK', value: formatMoney(totalAmount), hint: 'Liste filtresine göre' },
      { id: 'weight', label: 'Toplam Gram', value: formatNumber(totalWeight, ' g'), hint: 'Gold + silver preview' },
      {
        id: 'latest',
        label: 'Son Belge',
        value: latestDocument?.document_number || '—',
        hint: latestDocument ? formatRelativeTime(latestDocument.issued_at) : 'Henüz belge yok',
      },
    ],
    workspaceSummary: workspace
      ? [
          { id: 'line-count', label: 'Satır', value: String(workspace.summary.active_line_count), hint: workspace.session.session_code },
          { id: 'weight', label: 'Toplam Gram', value: formatNumber(workspace.summary.total_weight_grams, ' g'), hint: `Au ${formatNumber(workspace.summary.gold_weight_grams, ' g')} / Ag ${formatNumber(workspace.summary.silver_weight_grams, ' g')}` },
          { id: 'pure', label: 'Saf Metal', value: formatNumber(workspace.summary.total_pure_gold_grams, ' g'), hint: 'AFG hesap semantiği korunur' },
          { id: 'amount', label: 'Toplam Teklif', value: formatMoney(workspace.summary.total_amount_dkk), hint: 'DKK net offer' },
        ]
      : [],
    blocker: createAlisTransitionBlocker(state, options),
    unsupportedControls: [
      { id: 'bulk-import', label: 'Toplu İçe Aktarım', reason: 'Eski bulk import akışı modern route içinde güvenli reconcile callback olmadan desteklenmiyor.' },
      { id: 'scanner', label: 'Tarayıcı', reason: 'Tarayıcı cihaz entegrasyonu bu presentational yüzeyde host edilmiyor; gerçek desktop bridge gerekli.' },
      { id: 'physical-print', label: 'Fiziksel Yazdır', reason: 'OS printer queue kontrolü route dışı yan etki olduğu için yalnız mevcut print/export akışı destekleniyor.' },
    ],
  };
}
