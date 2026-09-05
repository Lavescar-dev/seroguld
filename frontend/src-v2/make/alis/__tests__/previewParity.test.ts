import { describe, expect, it } from 'vitest';

import {
  computedPreviewBarRowsPayload,
  computedPreviewExtraRowsPayload,
  computedPreviewGoldRowsPayload,
  computedPreviewPtPdRowsPayload,
  computedPreviewSilverRowsPayload,
} from '../useAlisMakeState';
import type { PosWorkspaceMarketRates } from '@/types';
import type { EditableExtraRow } from '../types';

// ---------------------------------------------------------------------------
// BACKEND PARİTE KİLİDİ (A12 / R2-07)
//
// Backend referansı (okundu): app/services/pos_workspace_state.py ::
// _workspace_row_unit_price_from_matrix + pos_service.py ::
// _workspace_row_line_total
//
//     unit  = quantize_2(rate + mer_pris)          # mer pris KRD/GRAM, EKLEME
//     total = quantize_2(unit × gram)              # unit ÖNCE 2 haneye kapanır
//
// Mer pris YÜZDE DEĞİLDİR (eski önizleme matematiği rate × (1 − avance/100)
// kullanıp backend'den sapıyordu). Backend tarafındaki aynı semantiğin
// çapası: backend/tests/test_pos_display_cache.py ::
// test_workspace_unit_price_is_additive_mer_pris_backend_anchor — iki test
// aynı örnek değerlerini paylaşır; biri bozulursa diğeri de patlar.
// ---------------------------------------------------------------------------

function backendUnitPriceDkk(rateDkk: number, avanceKrPerGram: number): string {
  return (rateDkk + avanceKrPerGram).toFixed(2);
}

function backendLineTotalDkk(rateDkk: number, avanceKrPerGram: number, gram: number): string {
  // Backend sıralaması: unit önce quantize, sonra kapalı unit × gram, sonra quantize.
  const unit = Number(backendUnitPriceDkk(rateDkk, avanceKrPerGram));
  return (unit * gram).toFixed(2);
}

const marketRates: PosWorkspaceMarketRates = {
  eur_dkk_fx: '7.45',
  gold_24k_dkk: '615.50',
  silver_dkk: '7.80',
  gold_rates_dkk: { '22': '564.21', '22b': '564.21', '24': '615.50' },
  silver_rates_dkk: { '925': '7.22', '999': '7.80' },
  gold_bar_dkk: '873.00',
  silver_bar_dkk: '13.10',
  platinum_dkk: '280.00',
  palladium_dkk: '310.00',
  plet_dkk: '0.02',
  gold_matrix: [],
  silver_matrix: [],
};

// Aile başına canlı oran çözüm anahtarı — fonksiyonlar oranı SATIRDAN değil
// marketRates'ten çözer; beklenen oran ailenin kendi anahtarından gelir.
const FAMILY_RATES = {
  gold22: Number(marketRates.gold_rates_dkk['22']),
  gold22b: Number(marketRates.gold_rates_dkk['22b']),
  silver925: Number(marketRates.silver_rates_dkk['925']),
  goldBar: Number(marketRates.gold_bar_dkk),
  platinum: Number(marketRates.platinum_dkk),
};

// Tüm aileler AYNI (avance, gram) tablosunu kullanır — tek tablo, tek test:
// bar/ptpd/extra dahil altı kombinasyonun backend paritesi tek yerde kilitli.
const SHARED_CASES = [
  { name: 'pozitif merpris eklenir', avance: 15, gram: 2 },
  { name: 'negatif merpris düşürür', avance: -15, gram: 3 },
  { name: 'kesirli merpris', avance: 0.5, gram: 10 },
  { name: 'eski yüzde yorumuyla çelişen örnek', avance: 10, gram: 3 },
] as const;

function expectRowParity(row: { unit_price_dkk: string; line_total_dkk: string }, rate: number, avance: number, gram: number) {
  expect(row.unit_price_dkk).toBe(backendUnitPriceDkk(rate, avance));
  expect(row.line_total_dkk).toBe(backendLineTotalDkk(rate, avance, gram));
}

describe('computedPreview* — backend formül paritesi (unit = rate + mer pris kr/g)', () => {
  it('gold/silver/bar/ptpd/extra tüm aileler aynı örnek tabloyla backend ile birebir', () => {
    for (const testCase of SHARED_CASES) {
      const { avance, gram } = testCase;
      const gramStr = gram.toFixed(2);
      const avanceStr = avance.toFixed(2);

      const [gold] = computedPreviewGoldRowsPayload(
        [
          {
            row_key: 'gold:22',
            karat: '22',
            label: '22K',
            lodighed: '916',
            purity_percentage: '91.60',
            gram: gramStr,
            avance_percent: avanceStr,
            rate_dkk: '0',
            unit_price_dkk: '0',
            line_total_dkk: '0',
          },
        ],
        marketRates,
      );
      expectRowParity(gold, FAMILY_RATES.gold22, avance, gram);

      const [silver] = computedPreviewSilverRowsPayload(
        [
          {
            row_key: 'silver:3',
            type_code: '3',
            label: 'Sterling sølv',
            lodighed: '925',
            purity_percentage: '92.50',
            gram: gramStr,
            avance_percent: avanceStr,
            rate_dkk: '0',
            unit_price_dkk: '0',
            line_total_dkk: '0',
          },
        ],
        marketRates,
      );
      expectRowParity(silver, FAMILY_RATES.silver925, avance, gram);

      const [goldBar] = computedPreviewBarRowsPayload(
        [
          {
            row_key: 'bar:gold',
            bar_type: 'gold',
            label: 'Guldbarre',
            lodighed: '999.9',
            purity_percentage: '99.99',
            gram: gramStr,
            avance_percent: avanceStr,
            rate_dkk: '0',
            unit_price_dkk: '0',
            line_total_dkk: '0',
          },
        ],
        marketRates,
      );
      expectRowParity(goldBar, FAMILY_RATES.goldBar, avance, gram);

      const [platinumRow] = computedPreviewPtPdRowsPayload(
        [
          {
            row_key: 'ptpd:platinum',
            metal: 'platinum',
            label: 'Platin',
            lodighed: '950',
            purity_percentage: '95.00',
            gram: gramStr,
            avance_percent: avanceStr,
            rate_dkk: '0',
            unit_price_dkk: '0',
            line_total_dkk: '0',
          },
        ],
        marketRates,
      );
      expectRowParity(platinumRow, FAMILY_RATES.platinum, avance, gram);

      const [extraGold] = computedPreviewExtraRowsPayload(
        [
          {
            row_key: 'extra:22b',
            kind: 'quarter',
            label: '22K-2',
            metal: 'gold',
            karat: '22',
            purity_percentage: '91.60',
            gram: gramStr,
            avance_percent: avanceStr,
            rate_dkk: '0',
            unit_price_dkk: '0',
            line_total_dkk: '0',
          },
        ],
        marketRates,
      );
      expectRowParity(extraGold, FAMILY_RATES.gold22, avance, gram);
      expect(extraGold.label).toBe('22K-2');

      const [extraSilver] = computedPreviewExtraRowsPayload(
        [
          {
            row_key: 'extra:kniv',
            kind: 'kniv',
            label: 'Kniv',
            metal: 'silver',
            karat: '925',
            purity_percentage: '92.50',
            gram: gramStr,
            avance_percent: avanceStr,
            rate_dkk: '0',
            unit_price_dkk: '0',
            line_total_dkk: '0',
          },
        ],
        marketRates,
      );
      expectRowParity(extraSilver, FAMILY_RATES.silver925, avance, gram);
    }
  });

  it('eski yüzde formülüne (rate × (1 − avance/100)) dönüş kalıcı olarak engellenir', () => {
    // 22K oranı 564.21 + merpris 10 → backend 574.21 kr/g;
    // eski yüzde hesap 564.21 × 0.90 = 507.79 üretirdi.
    const [gold] = computedPreviewGoldRowsPayload(
      [
        {
          row_key: 'gold:22',
          karat: '22',
          label: '22K',
          lodighed: '916',
          purity_percentage: '91.60',
          gram: '2.00',
          avance_percent: '10',
          rate_dkk: '0',
          unit_price_dkk: '0',
          line_total_dkk: '0',
        },
      ],
      marketRates,
    );
    expect(gold.unit_price_dkk).toBe('574.21');
    expect(gold.line_total_dkk).toBe('1148.42');
    // 507.79 (yüzde formülü) ASLA dönmemeli.
    expect(gold.unit_price_dkk).not.toBe('507.79');
  });

  it('extra satır oranı metal+karat anahtarından canlı çözülür (matris güncelse satır oranı da güncel)', () => {
    // EditableExtraRow üzerindeki donuk rate_dkk DEĞİL, marketRates['22b'] esas alınır.
    const row: EditableExtraRow = {
      row_key: 'extra:1',
      kind: 'quarter',
      label: '22K-2',
      metal: 'gold',
      karat: '22b',
      purity_percentage: '91.60',
      gram: '1.00',
      avance_percent: '0',
      rate_dkk: '999.99', // bayat donuk değer — yok sayılmalı
      unit_price_dkk: '999.99',
      line_total_dkk: '999.99',
    };
    const [live] = computedPreviewExtraRowsPayload([row], marketRates);
    expect(live.rate_dkk).toBe('564.21');
    expect(live.unit_price_dkk).toBe('564.21');
    expect(live.line_total_dkk).toBe('564.21');
  });
});
