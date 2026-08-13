import type { LogPageProps } from '@/make/log/LogPage';
import { formatMoney, formatNumber } from '@/lib/format';

import type { TransitionBlockerDescriptor, UnsupportedControlDescriptor } from './types';

export interface ModernLogViewModel {
  state: LogPageProps;
  phase: 'ready' | 'loading' | 'error' | 'empty';
  stats: Array<{ id: string; label: string; value: string; hint?: string }>;
  blocker: TransitionBlockerDescriptor | null;
  unsupportedControls: UnsupportedControlDescriptor[];
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

export function createModernLogViewModel(state: LogPageProps): ModernLogViewModel {
  const bucket = state.activeTab === 'silver' ? state.workspace?.silver : state.workspace?.gold;
  const summary = bucket?.summary;
  return {
    state,
    phase: state.isLoading ? 'loading' : state.isError ? 'error' : !bucket || bucket.documents.length === 0 ? 'empty' : 'ready',
    stats: [
      { id: 'documents', label: 'Belge', value: String(summary?.total_documents || 0), hint: state.activeTab === 'silver' ? 'Gümüş havuzu' : 'Altın havuzu' },
      { id: 'route', label: 'Bekleyen yönlendirme', value: String(state.pendingRouteSummary.count), hint: formatNumber(state.pendingRouteSummary.weight, ' g') },
      { id: 'amount', label: 'Toplam DKK', value: formatMoney(summary?.total_amount_dkk || 0), hint: `Saf metal ${formatNumber(summary?.total_pure_gold_grams || 0, ' g')}` },
      { id: 'lots', label: 'Eritme lotu', value: String(summary?.melt_lot_count || 0), hint: `${summary?.melt_line_count || 0} satır` },
    ],
    blocker: createLogTransitionBlocker(state),
    unsupportedControls: [
      { id: 'scanner', label: 'Belge Tarayıcı', reason: 'Belge tarama akışı bu modülde cihaz köprüsü olmadan güvenli değildir.' },
      { id: 'physical-print', label: 'Fiziksel Yazdır', reason: 'PDF dışa aktarımı desteklenir; fiziksel kuyruğa doğrudan yazma modern arayüzde yoktur.' },
    ],
  };
}
