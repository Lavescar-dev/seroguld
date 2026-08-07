import { MakeDashboardPage } from '@/make/dashboard/DashboardPage';
import { useDashboardMakeState } from '@/make/dashboard/useDashboardMakeState';
import { ModernDashboardPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function DashboardPage() {
  const state = useDashboardMakeState();
  const { variant } = useUiVariant();
  if (variant === 'classic') return <MakeDashboardPage {...state} />;

  return (
    <ModernDashboardPage
      summary={state.data}
      isRefreshing={state.isRefreshing}
      onRefresh={state.onRefresh}
      onNavigate={state.onNavigate}
      workInbox={[
        { id: 'risk', title: 'Manuel risk incelemesi', summary: 'OPMC kuyruğundaki siparişleri doğrulayın.', meta: `${state.data.opmcManuel} kayıt`, tone: state.data.opmcManuel ? 'warning' : 'success', actionLabel: 'OPMC', onAction: () => state.onNavigate('/opmc') },
        { id: 'log', title: 'AFG route kuyruğu', summary: 'Ayırma ve eritme hedeflerini Log içinde tamamlayın.', meta: `${state.data.ayirmaSayisi} bekliyor`, tone: state.data.ayirmaSayisi ? 'warning' : 'success', actionLabel: 'Log', onAction: () => state.onNavigate('/log') },
        { id: 'woo', title: 'Woo yayın hazırlığı', summary: 'Fotoğraf ve yayın durumunu ürün kaydıyla karşılaştırın.', meta: `${state.data.wooHazir} hazır`, tone: 'info', actionLabel: 'Woo', onAction: () => state.onNavigate('/woocommerce') },
      ]}
      relationHealth={[
        { id: 'purchase-log', source: 'Alış / AFG', target: 'Log', status: state.data.logSayisi >= state.data.alisSayisi ? 'İzleniyor' : 'Kontrol', detail: `${state.data.alisSayisi} alış / ${state.data.logSayisi} log kaydı`, tone: state.data.logSayisi >= state.data.alisSayisi ? 'success' : 'warning' },
        { id: 'inventory-woo', source: 'Depolama', target: 'WooCommerce', status: 'Görünür', detail: `${state.data.depoToplamItem} ürün / ${state.data.wooLisitlendi} listeli`, tone: 'info' },
        { id: 'opmc', source: 'WooCommerce', target: 'OPMC', status: state.data.opmcYuksek ? 'İnceleme' : 'Sakin', detail: `${state.data.opmcYuksek} yüksek risk`, tone: state.data.opmcYuksek ? 'danger' : 'success' },
      ]}
    />
  );
}
