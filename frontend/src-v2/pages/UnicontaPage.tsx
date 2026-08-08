import { MakeUnicontaPage } from '@/make/uniconta/UnicontaPage';
import { useUnicontaMakeState } from '@/make/uniconta/useUnicontaMakeState';
import { ModernUnicontaPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

function ModernUnicontaRoute() {
  const state = useUnicontaMakeState();

  return (
    <ModernUnicontaPage
      connectionStatus={state.baglantiDurumu}
      config={null}
      connectionInfo={{
        companyId: state.kimlik.companyId,
        env: state.kimlik.env,
        sendEmailOnFinalize: state.kimlik.sendEmailOnFinalize,
        sendXmlOnFinalize: state.kimlik.sendXmlOnFinalize,
      }}
      invoices={state.filtrelenmis}
      syncSummary={state.syncSummary}
      failedSyncs={state.failedSyncs}
      health={state.health}
      selectedInvoice={state.secilenFatura}
      stats={state.stats}
      connectAvailability={{ state: 'available' }}
      retryAvailability={
        state.failedSyncs.length > 0
          ? { state: 'available' }
          : { state: 'readonly', title: 'Retry kuyruğu boş', description: 'Gerçek hata satırı oluştuğunda retry aksiyonu burada açılır.' }
      }
      onConnect={state.baglan}
      onRefresh={state.yenile}
      onSelectInvoice={state.setSecilenFatura}
      onRetryAll={state.failedSyncs.length > 0 ? state.onRetryAll : undefined}
      onRetryFailed={state.onRetryFailed}
    />
  );
}

export function UnicontaPage() {
  const { variant } = useUiVariant();
  return variant === 'modern' ? <ModernUnicontaRoute /> : <MakeUnicontaPage />;
}
