import { MakeGdprPage } from '@/make/gdpr/GdprPage';
import { useGdprMakeState } from '@/make/gdpr/useGdprMakeState';
import { ModernGdprCockpitPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function GdprPage() {
  const state = useGdprMakeState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? (
    <ModernGdprCockpitPage
      overview={state.overview}
      requests={state.requests}
      jobs={state.jobs}
      processors={state.processors}
      retentionPolicies={state.retentionPolicies}
      selectedRequest={state.requestDetail}
      isLoading={state.isLoading}
      isRefreshing={state.isRefreshing}
      onRefresh={state.onRefresh}
      onSelectRequest={state.setSelectedRequestId}
    />
  ) : <MakeGdprPage {...state} />;
}
