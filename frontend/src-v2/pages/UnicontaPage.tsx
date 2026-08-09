import { MakeUnicontaPage } from '@/make/uniconta/UnicontaPage';
import { useUnicontaMakeState } from '@/make/uniconta/useUnicontaMakeState';
import { ModernUnicontaPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

function ModernUnicontaRoute() {
  const state = useUnicontaMakeState();

  return (
    <ModernUnicontaPage
      connectionStatus={state.baglantiDurumu}
      config={state.config}
      connectionDraft={state.kimlik}
      connectionSettingsOpen={state.ayarlarAcik}
      loading={state.yukleniyor}
      connectionInfo={{
        companyId: state.kimlik.companyId,
        env: state.kimlik.env,
        sendEmailOnFinalize: state.kimlik.sendEmailOnFinalize,
        sendXmlOnFinalize: state.kimlik.sendXmlOnFinalize,
      }}
      invoices={state.filtrelenmis}
      invoicesLoading={state.invoicesLoading}
      invoicesError={state.invoicesError}
      invoicesTruncated={state.invoicesTruncated}
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
      onOpenConnectionSettings={() => state.setAyarlarAcik(true)}
      onCloseConnectionSettings={() => state.setAyarlarAcik(false)}
      searchValue={state.aramaQ}
      onSearchChange={state.setAramaQ}
      typeFilter={state.tipFiltre}
      onTypeFilterChange={state.setTipFiltre}
      mailFilter={state.mailFiltre}
      onMailFilterChange={state.setMailFiltre}
      eFaturaFilter={state.eFaturaFiltre}
      onEFaturaFilterChange={state.setEFaturaFiltre}
      dateFilter={state.tarihFiltre}
      onDateFilterChange={state.setTarihFiltre}
      sortKey={state.sortKey}
      sortDir={state.sortDir}
      onSort={state.sort}
      onRefresh={state.yenile}
      onSelectInvoice={state.setSecilenFatura}
      onRetryAll={state.failedSyncs.length > 0 ? state.onRetryAll : undefined}
      onRetryFailed={state.onRetryFailed}
      retryingSingleSeq={state.retryingSingleSeq}
    />
  );
}

export function UnicontaPage() {
  const { variant } = useUiVariant();
  return variant === 'modern' ? <ModernUnicontaRoute /> : <MakeUnicontaPage />;
}
