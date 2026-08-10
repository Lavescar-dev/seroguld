import type { CustomersPageProps } from '@/make/customers/types';
import { formatMoney, formatRelativeTime } from '@/lib/format';

export interface ModernCustomersViewModel {
  state: CustomersPageProps;
  phase: 'ready' | 'empty';
  stats: Array<{ id: string; label: string; value: string; hint?: string }>;
}

export function createModernCustomersViewModel(state: CustomersPageProps): ModernCustomersViewModel {
  const selected = state.selectedCustomer;
  const riskWarnings = selected && 'risk' in selected && Array.isArray(selected.risk?.warnings) ? selected.risk.warnings.length : 0;
  return {
    state,
    phase: state.customers.length === 0 ? 'empty' : 'ready',
    stats: [
      { id: 'customers', label: 'Müşteri', value: String(state.totalCustomers), hint: state.search ? `Arama: ${state.search}` : `Sayfa ${state.customerPage}/${state.customerTotalPages}` },
      { id: 'history', label: 'AFG Geçmişi', value: String(state.historySummary.count), hint: state.historySummary.lastDate ? formatRelativeTime(state.historySummary.lastDate) : 'Seçili müşteri yok' },
      { id: 'value', label: 'Toplam DKK', value: formatMoney(state.historySummary.total), hint: 'Müşteri belge geçmişi' },
      { id: 'risk', label: 'Risk Uyarısı', value: String(riskWarnings), hint: selected && 'risk' in selected ? selected.risk.level : 'Detay yüklenmedi' },
    ],
  };
}
