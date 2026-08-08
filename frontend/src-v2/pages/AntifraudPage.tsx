import { MakeOpmcPage } from '@/make/opmc/OpmcPage';
import { useOpmcMakeState } from '@/make/opmc/useOpmcMakeState';
import { ModernOpmcListPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';
import type { AntiFraudSummary } from '@/types';

const EMPTY_SUMMARY: AntiFraudSummary = { total_orders: 0, high_risk_count: 0, medium_risk_count: 0, low_risk_count: 0, unknown_risk_count: 0, manual_review_count: 0 };

export function AntifraudPage() {
  const state = useOpmcMakeState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? (
    <ModernOpmcListPage
      source={state.source}
      generatedAt={state.generatedAt}
      summary={state.summary || EMPTY_SUMMARY}
      items={state.filteredOrders}
      onRefresh={state.onRefresh}
      isLoading={state.isLoading}
      availability={state.isError ? { state: 'unavailable', title: 'OPMC verisi alınamadı', description: state.errorMessage } : { state: 'available' }}
    />
  ) : <MakeOpmcPage {...state} />;
}
