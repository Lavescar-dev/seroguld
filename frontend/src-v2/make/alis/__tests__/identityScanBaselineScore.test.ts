// D7 — Windows-OCR/regex taban doğruluk sayacı (0.3.39 WP6).
//
// Gerçek parseIdentityScan, backend/tests/fixtures/ocr altındaki SENTETİK
// görsellerin GERÇEK Windows.Media.Ocr kayıtları (raw_ocr_da.json + raw_ocr_tr.json)
// üzerinde koşturulur ve fixtures.json ground-truth'una karşı alan bazında
// skorlanır. Çıktı, yerel RapidOCR motorunun (WP9 benchmark kapısı) geçmesi
// gereken Windows taban çizgisidir: test çıktısındaki tablo CI günlüğünde
// görünür kalır, TABAN sabitlerinin altına düşüş doğrudan regresyondur.
//
// Skorlama kuralları (backend ocr_benchmark.py ile aynı sözleşme):
// - full_name ve city: harf-katlanmış (foldDanish) birebir eşleşme.
// - cpr_first6 / document_number / postal_code: birebir eşleşme.
// - Ground-truth'ta olmayan alan fırsat SAYILMAZ (boşluğa ceza yok).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseIdentityScan } from '../identityScan';

const FIXTURE_ROOT = resolve(__dirname, '../../../../../backend/tests/fixtures/ocr');

type GroundTruth = {
  fixtures: Array<{
    file: string;
    document_type: 'pas' | 'idkort' | 'koerekort' | 'sundhedskort';
    capture_condition: 'clean' | 'rotate' | 'blur_noise' | 'lowlight' | 'glare';
    expected_fields: {
      full_name?: string;
      cpr_first6?: string;
      document_number?: string;
      postal_code?: string;
      city?: string;
    };
  }>;
};

type RawOcrRecord = { results: Record<string, string[]> };

const groundTruth = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'fixtures.json'), 'utf-8')) as GroundTruth;
const rawRecords = {
  da: JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'raw_ocr_da.json'), 'utf-8')) as RawOcrRecord,
  tr: JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'raw_ocr_tr.json'), 'utf-8')) as RawOcrRecord,
} as const;

const SCORE_FIELDS = ['full_name', 'cpr_first6', 'document_number', 'postal_code', 'city'] as const;
type ScoreField = (typeof SCORE_FIELDS)[number];

// Kayıt motorunun bilinen harf katlamaları (tr paketi: Æ→E, Ø→O, Å/Â→A).
function foldDanish(value: string): string {
  return value
    .toUpperCase()
    .replace(/Æ/g, 'E')
    .replace(/Ø/g, 'O')
    .replace(/[ÅÂ]/g, 'A')
    .replace(/[^A-Z0-9 '-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse sonucundaki alanı ground-truth anahtarına eşler (backend sözleşmesi).
function parsedValueFor(field: ScoreField, result: ReturnType<typeof parseIdentityScan>): string {
  switch (field) {
    case 'full_name':
      return foldDanish(result.fields.name?.value ?? '');
    case 'cpr_first6':
      return result.fields.cpr_number?.value ?? '';
    case 'document_number':
      return result.fields.identity_doc_number?.value ?? '';
    case 'postal_code':
      return result.fields.postal_code?.value ?? '';
    case 'city':
      return foldDanish(result.fields.city?.value ?? '');
  }
}

function expectedValueFor(field: ScoreField, expected: GroundTruth['fixtures'][number]['expected_fields']): string {
  const raw = expected[field];
  return field === 'full_name' || field === 'city' ? foldDanish(raw ?? '') : (raw ?? '');
}

type FieldScore = { hits: number; opportunities: number };

function scoreRecord(record: RawOcrRecord): Record<ScoreField, FieldScore> {
  const scores = Object.fromEntries(SCORE_FIELDS.map((field) => [field, { hits: 0, opportunities: 0 }])) as Record<ScoreField, FieldScore>;
  for (const fixture of groundTruth.fixtures) {
    const lines = record.results[fixture.file.replace('images/', '')];
    if (!lines) continue;
    const parsed = parseIdentityScan(lines.join('\n'));
    for (const field of SCORE_FIELDS) {
      const expected = expectedValueFor(field, fixture.expected_fields);
      if (!expected) continue; // ground-truth yok → fırsat sayılmaz
      scores[field].opportunities += 1;
      if (parsedValueFor(field, parsed) === expected) scores[field].hits += 1;
    }
  }
  return scores;
}

function accuracy(score: FieldScore): number {
  return score.opportunities ? score.hits / score.opportunities : 1;
}

// TABAN — 0.3.39 WP6 sonrası ölçülen değerler (bu testin kendi çıktısındaki
// tablo). Amaç DÜŞÜŞÜ YAKALAMAK: mevcut değerler aynen koda yazıldı, bir
// altına düşen her alan parse regresyonudur (iyileşme serbesttir).
const BASELINE = {
  da: { full_name: 18 / 20, cpr_first6: 9 / 20, document_number: 14 / 15, postal_code: 5 / 5, city: 5 / 5 },
  tr: { full_name: 17 / 20, cpr_first6: 10 / 20, document_number: 14 / 15, postal_code: 5 / 5, city: 5 / 5 },
} as Record<keyof typeof rawRecords, Record<ScoreField, number>>;

describe('Windows-OCR/regex taban doğruluk sayacı (D7 — WP6)', () => {
  it.each([['da'], ['tr']] as const)('%s kaydı: alan bazlı doğruluk tabanı korunur', (engine) => {
    const scores = scoreRecord(rawRecords[engine]);

    // CI günlüğünde okunur kalan tablo (yerel motor benchmark'ının tabanı).
    const header = `taban-${engine} | ${'alan'.padEnd(17)} | isabet | fırsat | doğruluk`;
    console.log(header);
    console.log('-'.repeat(header.length));
    let totalHits = 0;
    let totalOpportunities = 0;
    for (const field of SCORE_FIELDS) {
      const score = scores[field];
      totalHits += score.hits;
      totalOpportunities += score.opportunities;
      console.log(
        `taban-${engine} | ${field.padEnd(17)} | ${String(score.hits).padStart(6)} | ${String(score.opportunities).padStart(6)} | ${(accuracy(score) * 100).toFixed(1)}%`,
      );
    }
    console.log(
      `taban-${engine} | ${'TOPLAM'.padEnd(17)} | ${String(totalHits).padStart(6)} | ${String(totalOpportunities).padStart(6)} | ${(totalHits / Math.max(1, totalOpportunities) * 100).toFixed(1)}%`,
    );

    for (const field of SCORE_FIELDS) {
      const floor = BASELINE[engine][field];
      const current = accuracy(scores[field]);
      expect(current, `${engine}/${field} taban doğruluğun altında`).toBeGreaterThanOrEqual(floor);
    }
  });
});
