import { MakeWooCommercePage } from '@/make/woocommerce/WooCommercePage';
import { useWooMakeState } from '@/make/woocommerce/useWooMakeState';
import { ModernWooCommercePage } from '@/modern/pages';
import { formatMoney, formatNumber } from '@/lib/format';
import { useUiVariant } from '@/ui-variants';

export function WooCommercePage() {
  const state = useWooMakeState();
  const { variant } = useUiVariant();

  if (variant === 'modern') {
    const items = state.urunler.map((item) => ({
      id: item.id,
      title: item.urun || item.urunNo,
      sku: item.urunNo,
      status: item.durum,
      metal: item.metal,
      weightLabel: formatNumber(item.agirlik, ' g'),
      priceLabel: formatMoney(item.satisHasJiyati || item.alimFiyati),
      publishState: item.wooYayin,
      tone: item.wooYayin === 'Yayında' ? 'success' as const : item.wooYayin === 'Taslak' ? 'warning' as const : 'neutral' as const,
    }));
    const readiness = state.detail
      ? [
          { label: 'Başlık ve kısa açıklama', value: state.detail.display_name ? 'Hazır' : 'Eksik', tone: state.detail.display_name ? 'success' as const : 'warning' as const },
          { label: 'Galeri', value: state.detail.photos.length > 0 ? `${state.detail.photos.length} görsel` : 'Eksik', tone: state.detail.photos.length > 0 ? 'success' as const : 'warning' as const },
          { label: 'AI / SEO onayı', value: state.detail.ai_description_approved ? 'PASS' : 'İnceleme', tone: state.detail.ai_description_approved ? 'success' as const : 'info' as const },
          { label: 'WordPress bridge', value: state.detail.woocommerce_product_id ? 'Bağlı' : 'DISCOVERY', tone: state.detail.woocommerce_product_id ? 'success' as const : 'info' as const },
        ]
      : [{ label: 'Ürün detayı', value: 'Seçim bekleniyor', tone: 'neutral' as const }];
    const timeline = [
      ...state.syncLog.slice(0, 4).map((entry) => ({
        id: `sync-${entry.id}`,
        title: entry.action,
        detail: entry.error_message || entry.status,
        timestamp: entry.created_at,
        tone: entry.status === 'synced' ? 'success' as const : entry.status === 'failed' ? 'danger' as const : 'warning' as const,
      })),
      ...state.history.slice(0, 4).map((entry) => ({
        id: `history-${entry.id}`,
        title: entry.action,
        detail: entry.notes || 'Ürün geçmişi',
        timestamp: entry.created_at,
        tone: 'info' as const,
      })),
    ];

    return (
      <ModernWooCommercePage
        availability={state.loadingWorkspace ? { state: 'readonly', title: 'Woo çalışma alanı hazırlanıyor', description: 'Gerçek ürün listesi ve bridge durumu bekleniyor.' } : { state: 'available' }}
        items={items}
        selectedProduct={state.detail}
        readiness={readiness}
        syncTimeline={timeline}
        isLoading={state.loadingWorkspace}
        onSelectProduct={state.setSecilenId}
      />
    );
  }

  return <MakeWooCommercePage {...state} />;
}
