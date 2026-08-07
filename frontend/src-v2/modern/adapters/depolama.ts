import type { DepolamaPageProps } from '@/make/depolama/DepolamaPage';
import { formatMoney, formatNumber } from '@/lib/format';

export interface ModernDepolamaViewModel {
  state: DepolamaPageProps;
  phase: 'ready' | 'loading' | 'empty';
  stats: Array<{ id: string; label: string; value: string; hint?: string }>;
}

export function createModernDepolamaViewModel(state: DepolamaPageProps): ModernDepolamaViewModel {
  const stokList = state.stokList;
  const totalGram = stokList.reduce((sum, item) => sum + Number(item.toplamGram || item.birimGram * item.adet || 0), 0);
  const totalPurchase = stokList.reduce((sum, item) => sum + Number(item.alisFiyati || 0), 0);
  const cleanQueue = stokList.filter((item) => item.needsCleaning).length;
  const lockedCount = stokList.filter((item) => item.isGdprLocked).length;

  return {
    state,
    phase: state.loading && stokList.length === 0 ? 'loading' : stokList.length === 0 ? 'empty' : 'ready',
    stats: [
      { id: 'items', label: 'Ürün', value: String(stokList.length), hint: 'Aktif filtreye göre' },
      { id: 'weight', label: 'Toplam Gram', value: formatNumber(totalGram, ' g'), hint: 'Kategori semantiği korunur' },
      { id: 'purchase', label: 'Alış Değeri', value: formatMoney(totalPurchase), hint: 'DKK toplam' },
      { id: 'ops', label: 'Temizlik / GDPR', value: `${cleanQueue} / ${lockedCount}`, hint: 'Operasyon kuyruğu' },
    ],
  };
}
