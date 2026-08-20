import { describe, expect, it } from 'vitest';

import { filterCategories } from '../WooCategoryPicker';
import { stripHtmlToText } from '../WooCatalogPanel';
import type { WooCategory } from '../useWooMakeState';

const CATEGORIES: WooCategory[] = [
  { id: 10, name: 'Smykker', slug: 'smykker', parent: 0, count: 40, depth: 0 },
  { id: 11, name: 'Ringe', slug: 'ringe', parent: 10, count: 12, depth: 1 },
  { id: 12, name: 'Armbånd', slug: 'armbaand', parent: 10, count: 8, depth: 1 },
  { id: 20, name: 'Barrer', slug: 'barrer', parent: 0, count: 5, depth: 0 },
];

describe('filterCategories', () => {
  it('boş aramada tüm listeyi korur', () => {
    expect(filterCategories(CATEGORIES, '  ')).toEqual(CATEGORIES);
  });

  it('eşleşen kategoriyle birlikte ebeveyn zincirini de tutar', () => {
    const result = filterCategories(CATEGORIES, 'ringe');
    expect(result.map((item) => item.id)).toEqual([10, 11]);
  });

  it('büyük/küçük harf duyarsız arar ve eşleşme yoksa boş döner', () => {
    expect(filterCategories(CATEGORIES, 'BARRER').map((item) => item.id)).toEqual([20]);
    expect(filterCategories(CATEGORIES, 'yok-boyle-kategori')).toEqual([]);
  });
});

describe('stripHtmlToText', () => {
  it('etiketleri ve yorumları söker, boşlukları sadeleştirir', () => {
    expect(stripHtmlToText('<!-- sg-spec --><p>Vare nr. : 1427</p><!-- /sg-spec -->\n<p>Flot &amp; fin</p>')).toBe(
      'Vare nr. : 1427 Flot & fin',
    );
    expect(stripHtmlToText(null)).toBe('');
  });
});
