import { describe, expect, it } from 'vitest';

import { computeWooPricePreview } from '../ModernWooProductWizard';

describe('computeWooPricePreview (Woo otomatik fiyat)', () => {
  it('spot × ağırlık × saflık × (1+markup) — gerçek Woo ürünüyle tutarlı', () => {
    // Gerçek ürün: Panzer halskæde 18K, 7.03g, markup %37, Woo fiyatı 6615.77.
    // (WP'nin hesap anındaki spotu küçük farklar yaratabilir — 1 DKK tolerans.)
    const result = computeWooPricePreview({
      metal: 'Altın',
      ayar: '750',
      agirlik: '7.03',
      wooMarkupRate: '37',
      rates: { gold_24k_dkk: '915.90' },
    });
    expect(result).toBeCloseTo(6615.77, 0);
  });

  it('gümüş için silver_dkk kullanır', () => {
    const result = computeWooPricePreview({
      metal: 'Gümüş',
      ayar: '925',
      agirlik: '100',
      wooMarkupRate: '20',
      rates: { silver_dkk: '10' },
    });
    expect(result).toBeCloseTo(10 * 100 * 0.925 * 1.2, 5);
  });

  it('oran, ağırlık veya saflık yoksa null döner (uydurma yok)', () => {
    expect(
      computeWooPricePreview({ metal: 'Altın', ayar: '750', agirlik: '0', wooMarkupRate: '10', rates: { gold_24k_dkk: '915' } }),
    ).toBeNull();
    expect(
      computeWooPricePreview({ metal: 'Altın', ayar: '750', agirlik: '10', wooMarkupRate: '10', rates: null }),
    ).toBeNull();
    expect(
      computeWooPricePreview({ metal: 'Platin', ayar: '900', agirlik: '10', wooMarkupRate: '10', rates: { gold_24k_dkk: '915' } }),
    ).toBeNull();
  });
});
