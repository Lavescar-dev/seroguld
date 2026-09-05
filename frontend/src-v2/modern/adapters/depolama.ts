import type { DepolamaPageProps } from '@/make/depolama/DepolamaPage';
import { formatMoney, formatNumber } from '@/lib/format';

export interface ModernDepolamaViewModel {
  state: DepolamaPageProps;
  phase: 'ready' | 'loading' | 'empty' | 'error';
  stats: Array<{ id: string; label: string; value: string; hint?: string }>;
}

export function createModernDepolamaViewModel(state: DepolamaPageProps): ModernDepolamaViewModel {
  const stokList = state.stokList;
  const totalGram = stokList.reduce((sum, item) => sum + Number(item.toplamGram || item.birimGram * item.adet || 0), 0);
  const totalPurchase = stokList.reduce((sum, item) => sum + Number(item.alisFiyati || 0), 0);
  const cleanQueue = stokList.filter((item) => item.needsCleaning).length;
  const lockedCount = stokList.filter((item) => item.isGdprLocked).length;
  // workspaceTotal: filtrelenmiş toplam — satır listesi sınır yüzünden kesildiyse
  // 'Ürün' istatistiği tam büyüklüğü hint olarak gösterir.
  const total = state.workspaceTotal ?? null;
  const truncated = total != null && total > stokList.length;

  return {
    state,
    // Liste isteği patladıysa 'empty' değil 'error' — yüzey Tekrar Dene gösterir,
    // "henüz ürün yok" yanılgısını önler.
    phase: state.workspaceError
      ? 'error'
      : state.loading && stokList.length === 0
        ? 'loading'
        : stokList.length === 0
          ? 'empty'
          : 'ready',
    stats: [
      { id: 'items', label: 'Ürün', value: truncated ? `${stokList.length} / ${total}` : String(stokList.length), hint: truncated ? `Limit nedeniyle kesildi · toplam ${total}` : 'Aktif filtreye göre' },
      { id: 'weight', label: 'Toplam Gram', value: formatNumber(totalGram, ' g'), hint: 'Kategori semantiği korunur' },
      { id: 'purchase', label: 'Alış Değeri', value: formatMoney(totalPurchase), hint: 'DKK toplam' },
      { id: 'ops', label: 'Temizlik / GDPR', value: `${cleanQueue} / ${lockedCount}`, hint: 'Operasyon kuyruğu' },
    ],
  };
}
