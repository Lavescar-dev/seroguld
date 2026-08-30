import { describe, expect, it } from 'vitest';

import type { AfgWorkspaceDocument, AfgWorkspaceLine } from '@/types';

import {
  buildBucketGroups,
  lineHasPendingChange,
  resolveLineDraft,
  splitGroupKeyForDraft,
  sumLines,
  toFloat,
} from '../lineHelpers';
import type { LineDraft } from '../types';

function makeLine(overrides: Partial<Record<keyof AfgWorkspaceLine, unknown>> = {}): AfgWorkspaceLine {
  return {
    id: 'L-1',
    transaction_id: 'T-1',
    document_sequence_no: 1,
    document_number: 'DOC-1',
    session_id: 'S-1',
    session_code: 'SC-1',
    line_no: 1,
    issued_at: '2026-08-30T10:00:00Z',
    margin_percent: '0',
    line_total_dkk: '0',
    is_gdpr_locked: false,
    created_at: '2026-08-30T10:00:00Z',
    ...overrides,
  } as AfgWorkspaceLine;
}

function makeDocument(lines: AfgWorkspaceLine[], overrides: Partial<AfgWorkspaceDocument> = {}): AfgWorkspaceDocument {
  return {
    sequence_no: 1,
    document_number: 'DOC-1',
    session_id: 'S-1',
    document_kind: 'purchase',
    document_title: 'Belge 1',
    status: 'confirmed',
    trade_side: 'buy',
    issued_at: '2026-08-30T10:00:00Z',
    gross_amount_dkk: '0',
    net_amount_dkk: '0',
    total_weight_grams: '0',
    total_pure_gold_grams: '0',
    line_count: lines.length,
    operation_state: 'awaiting',
    has_locked_products: false,
    lines,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<LineDraft> = {}): LineDraft {
  return {
    classification: 'standard',
    note: '',
    destination: 'undecided',
    ...overrides,
  };
}

describe('toFloat', () => {
  it('sayıyı olduğu gibi döndürür', () => {
    expect(toFloat(5)).toBe(5);
    expect(toFloat(12.75)).toBe(12.75);
    expect(toFloat(-3.5)).toBe(-3.5);
    expect(toFloat(0)).toBe(0);
  });

  it('sayısal stringi ayrıştırır', () => {
    expect(toFloat('12.5')).toBe(12.5);
    expect(toFloat('100')).toBe(100);
    expect(toFloat('-7.25')).toBe(-7.25);
    expect(toFloat('0')).toBe(0);
  });

  it('boş değerlerde 0 döndürür', () => {
    expect(toFloat(undefined)).toBe(0);
    expect(toFloat(null)).toBe(0);
    expect(toFloat('')).toBe(0);
  });

  it('geçersiz stringlerde 0 döndürür', () => {
    expect(toFloat('abc')).toBe(0);
    expect(toFloat('12,5')).toBe(0); // ondalık virgül ayrıştırılmaz
    expect(toFloat('12.5gr')).toBe(0);
  });

  it('sayı girdisini doğrulamadan geçirir (NaN dahil)', () => {
    // Sözleşme: typeof === 'number' ise değer kontrolsüz döner.
    expect(toFloat(Number.NaN)).toBeNaN();
  });
});

describe('sumLines', () => {
  it('boş dizide sıfırları döndürür', () => {
    expect(sumLines([])).toEqual({ weight: 0, amount: 0, pure: 0 });
  });

  it('ağırlık, tutar ve saf altını toplar', () => {
    const lines = [
      makeLine({ weight_grams: '10.5', line_total_dkk: '100', pure_gold_grams: '5.1' }),
      makeLine({ weight_grams: '20.25', line_total_dkk: '250.5', pure_gold_grams: '3.4' }),
    ];
    expect(sumLines(lines)).toEqual({ weight: 30.75, amount: 350.5, pure: 8.5 });
  });

  it('eksik/geçersiz alanları 0 sayar', () => {
    const lines = [
      makeLine({ weight_grams: null, line_total_dkk: undefined, pure_gold_grams: 'abc' }),
      makeLine({ weight_grams: '8', line_total_dkk: '40', pure_gold_grams: '2' }),
    ];
    expect(sumLines(lines)).toEqual({ weight: 8, amount: 40, pure: 2 });
  });

  it('sayısal ve string değerleri karıştırır', () => {
    const lines = [
      makeLine({ weight_grams: 1.5, line_total_dkk: '10' }),
      makeLine({ weight_grams: '2.5', line_total_dkk: 20 }),
    ];
    const sum = sumLines(lines);
    expect(sum.weight).toBe(4);
    expect(sum.amount).toBe(30);
    expect(sum.pure).toBe(0);
  });

  it('yüzer nokta birikiminde ham sonucu döndürür', () => {
    const sum = sumLines([
      makeLine({ weight_grams: 0.1 }),
      makeLine({ weight_grams: 0.2 }),
    ]);
    expect(sum.weight).toBeCloseTo(0.3, 10);
  });
});

describe('resolveLineDraft', () => {
  it('varsa mevcut taslağı aynen döndürür', () => {
    const line = makeLine({ id: 'L-9' });
    const draft = makeDraft({ note: 'elde edilen taslak' });
    expect(resolveLineDraft(line, { 'L-9': draft })).toBe(draft);
  });

  it('taslak yoksa satırdan varsayılan üretir', () => {
    const line = makeLine({
      operation_destination: 'inventory',
      operation_classification: 'separate_storage',
      product_notes: 'kolye',
    });
    expect(resolveLineDraft(line, {})).toEqual({
      classification: 'separate_storage',
      note: 'kolye',
      destination: 'inventory',
    });
  });

  it('varsayılan sınıflandırmayı metal türünden çıkarır', () => {
    const line = makeLine({ metal_type: 'white_gold' });
    expect(resolveLineDraft(line, {}).classification).toBe('white_gold');
  });

  it('alanlar boşsa nötr varsayılanlara düşer', () => {
    const draft = resolveLineDraft(makeLine(), {});
    expect(draft.classification).toBe('standard');
    expect(draft.destination).toBe('undecided');
    expect(draft.note).toBe('');
  });

  it('null ürün notunu boş string yapar', () => {
    expect(resolveLineDraft(makeLine({ product_notes: null }), {}).note).toBe('');
  });
});

describe('lineHasPendingChange', () => {
  it('varsayılan durumlarda değişiklik görmez', () => {
    const line = makeLine({
      operation_destination: 'inventory',
      operation_classification: 'jewelry_cleaning',
      product_notes: 'not',
    });
    expect(lineHasPendingChange(line, {})).toBe(false);
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ classification: 'jewelry_cleaning', note: 'not', destination: 'inventory' }) })).toBe(false);
  });

  it('sınıflandırma farkını yakalar', () => {
    const line = makeLine({ operation_destination: 'inventory', operation_classification: 'standard' });
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ classification: 'white_gold' }) })).toBe(true);
  });

  it('varış farkını yakalar', () => {
    const line = makeLine({ operation_destination: 'undecided' });
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ destination: 'melt' }) })).toBe(true);
  });

  it('not farkını yakalar', () => {
    const line = makeLine({ product_notes: 'eski not' });
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ note: 'yeni not' }) })).toBe(true);
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ note: '' }) })).toBe(true);
  });

  it('notları boşluk normalize ederek karşılaştırır', () => {
    const line = makeLine({ product_notes: 'aynı not' });
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ note: '  aynı not  ' }) })).toBe(false);
  });

  it('satır notu boşken sadece boşluktan oluşan taslak notu değişiklik sayılmaz', () => {
    const line = makeLine({ product_notes: null });
    expect(lineHasPendingChange(line, { 'L-1': makeDraft({ note: '   ' }) })).toBe(false);
  });
});

describe('splitGroupKeyForDraft', () => {
  it('envanter dışı varışlarda null döndürür', () => {
    expect(splitGroupKeyForDraft(makeDraft({ destination: 'undecided' }))).toBeNull();
    expect(splitGroupKeyForDraft(makeDraft({ destination: 'melt' }))).toBeNull();
  });

  it('beyaz altını kendi kovasına ayırır', () => {
    expect(splitGroupKeyForDraft(makeDraft({ destination: 'inventory', classification: 'white_gold' }))).toBe('white_gold');
  });

  it('ayrı depolamayı kendi kovasına ayırır', () => {
    expect(splitGroupKeyForDraft(makeDraft({ destination: 'inventory', classification: 'separate_storage' }))).toBe('separate_storage');
  });

  it('standard ve kuyumcu temizliği satırlarını kuyumcu temizliği kovasına koyar', () => {
    expect(splitGroupKeyForDraft(makeDraft({ destination: 'inventory', classification: 'standard' }))).toBe('jewelry_cleaning');
    expect(splitGroupKeyForDraft(makeDraft({ destination: 'inventory', classification: 'jewelry_cleaning' }))).toBe('jewelry_cleaning');
  });
});

describe('buildBucketGroups', () => {
  it('belge yoksa üç boş kova döndürür', () => {
    expect(buildBucketGroups([], {})).toEqual({
      jewelry_cleaning: [],
      white_gold: [],
      separate_storage: [],
    });
  });

  it('satırları taslaklarına göre kovalara dağıtır', () => {
    const lineJewelry = makeLine({ id: 'L-1' });
    const lineWhite = makeLine({ id: 'L-2' });
    const lineSeparate = makeLine({ id: 'L-3' });
    const drafts: Record<string, LineDraft> = {
      'L-1': makeDraft({ destination: 'inventory', classification: 'standard' }),
      'L-2': makeDraft({ destination: 'inventory', classification: 'white_gold' }),
      'L-3': makeDraft({ destination: 'inventory', classification: 'separate_storage' }),
    };
    const groups = buildBucketGroups([makeDocument([lineJewelry, lineWhite, lineSeparate])], drafts);
    expect(groups.jewelry_cleaning).toEqual([lineJewelry]);
    expect(groups.white_gold).toEqual([lineWhite]);
    expect(groups.separate_storage).toEqual([lineSeparate]);
  });

  it('envanter dışı satırları hiçbir kovaya koymaz', () => {
    const undecided = makeLine({ id: 'L-1' });
    const melt = makeLine({ id: 'L-2' });
    const drafts: Record<string, LineDraft> = {
      'L-1': makeDraft({ destination: 'undecided' }),
      'L-2': makeDraft({ destination: 'melt', classification: 'white_gold' }),
    };
    const groups = buildBucketGroups([makeDocument([undecided, melt])], drafts);
    expect(groups.jewelry_cleaning).toHaveLength(0);
    expect(groups.white_gold).toHaveLength(0);
    expect(groups.separate_storage).toHaveLength(0);
  });

  it('taslağı olmayan satırlar için satır varsayılanlarını kullanır', () => {
    const whiteLine = makeLine({ id: 'L-1', metal_type: 'white_gold', operation_destination: 'inventory' });
    const separateLine = makeLine({ id: 'L-2', operation_classification: 'separate_storage', operation_destination: 'inventory' });
    const standardLine = makeLine({ id: 'L-3', operation_destination: 'inventory' });
    const groups = buildBucketGroups([makeDocument([whiteLine, separateLine, standardLine])], {});
    expect(groups.white_gold).toEqual([whiteLine]);
    expect(groups.separate_storage).toEqual([separateLine]);
    expect(groups.jewelry_cleaning).toEqual([standardLine]);
  });

  it('birden çok belgenin satırlarını aynı kovalarda biriktirir', () => {
    const first = makeLine({ id: 'L-1' });
    const second = makeLine({ id: 'L-2', document_number: 'DOC-2' });
    const groups = buildBucketGroups(
      [
        makeDocument([first], { document_number: 'DOC-1', sequence_no: 1 }),
        makeDocument([second], { document_number: 'DOC-2', sequence_no: 2 }),
      ],
      {
        'L-1': makeDraft({ destination: 'inventory', classification: 'jewelry_cleaning' }),
        'L-2': makeDraft({ destination: 'inventory', classification: 'jewelry_cleaning' }),
      },
    );
    expect(groups.jewelry_cleaning).toEqual([first, second]);
    expect(groups.white_gold).toHaveLength(0);
    expect(groups.separate_storage).toHaveLength(0);
  });

  it('taslak varış envanter olsa bile satırı sınıflandırmasına göre ayırır', () => {
    // Taslak standard + envanter → kuyumcu temizliği kovası (beyaz altın metal türü taslakla ezilir).
    const line = makeLine({ id: 'L-1', metal_type: 'white_gold' });
    const groups = buildBucketGroups([makeDocument([line])], {
      'L-1': makeDraft({ destination: 'inventory', classification: 'standard' }),
    });
    expect(groups.jewelry_cleaning).toEqual([line]);
    expect(groups.white_gold).toHaveLength(0);
  });
});
