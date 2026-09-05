import { MakeGdprPage } from '@/make/gdpr/GdprPage';
import { useGdprCreateRequest } from '@/make/gdpr/useGdprCreateRequest';
import { useGdprMakeState } from '@/make/gdpr/useGdprMakeState';
import { ModernGdprCockpitPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

// Bilinçli asimetri (M2-gdpr notu): modern varyant GDPR kokpitinin bir alt
// kümesini taşır — WordPress Bridge paneli, publicConfig/bridgeConfig,
// status/customer filtreleri ve "Yeni talep" paneli yalnız classic
// (MakeGdprPage) yüzeyindedir. CustomersPage'den '#/gdpr?customer=ID' ile
// gelen müşteri filtresi hook'ta uygulanır ama modern dalda görünmez.
// ModernGdprPublic*Page bileşenleri hiçbir rotada kullanılmaz: app.tsx'teki
// public GDPR rotaları bilinçli olarak make sarmalayıcılarına bağlıdır ve bu
// bileşenler dormant (düzenleme riski olan ölü kod) durumundadır.
export function GdprPage() {
  const state = useGdprMakeState();
  const createRequest = useGdprCreateRequest();
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
      activeMutation={state.activeMutation}
      onVerify={state.onVerify}
      onApprove={state.onApprove}
      onReject={state.onReject}
      onEnqueue={state.onEnqueue}
      onExecute={state.onExecute}
      onUpdatePolicy={state.onUpdatePolicy}
    />
  ) : (
    <MakeGdprPage
      {...state}
      onCreateRequest={async (payload) => {
        const result = await createRequest.mutateAsync(payload);
        await state.onRefresh();
        return result;
      }}
      isCreatingRequest={createRequest.isPending}
    />
  );
}
