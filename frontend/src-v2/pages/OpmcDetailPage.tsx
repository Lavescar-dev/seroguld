import { MakeOpmcDetailPage } from '@/make/opmc/OpmcDetailPage';
import { useOpmcDetailMakeState } from '@/make/opmc/useOpmcDetailMakeState';
import { ModernOpmcDetailPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function OpmcDetailPage() {
  const state = useOpmcDetailMakeState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? (
    <ModernOpmcDetailPage
      requestedId={state.requestedId}
      detail={state.detail}
      isLoading={state.isLoading}
      onRefresh={state.onRefresh}
      refreshAvailability={state.isError || state.isNotFound ? { state: 'unavailable', title: 'Risk detayı alınamadı', description: state.errorMessage } : { state: 'available' }}
      overrideAvailability={{ state: state.detail ? 'available' : 'unavailable' }}
      onOverride={(level, reason) => state.onOverride(level, reason)}
    />
  ) : <MakeOpmcDetailPage {...state} />;
}
