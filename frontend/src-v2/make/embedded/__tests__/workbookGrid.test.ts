import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import type { DocumentArtifactEditableCell, DocumentArtifactSheetPreview } from '@/types';

import { overlayWorkbookEdits, parseWorkbookGrid } from '../workbookGrid';

/**
 * Bu test gerçek bir xlsx bayt akışı kullanır (SheetJS mock'lanmaz):
 * workbookGrid tarayıcıda da tam bu yolu izler — XLSX.read ile parse,
 * XLSX.write ile üretilen dosyayı okur.
 */
function buildWorkbookArrayBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Malzeme', 'Adet', 'Oran', 'Tarih', 'Formül'],
    ['Kablo', 12.5, 0.125, null, null],
    ['Priz', 'not', null, null, null],
    ['Toplam', null, null, null, null],
  ]);
  ws['D2'] = { t: 'd', v: new Date(2026, 0, 15) };
  ws['E2'] = { t: 's', v: '=1+1' };
  ws['!ref'] = 'A1:E4';
  ws['!merges'] = [{ s: { r: 3, c: 0 }, e: { r: 3, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, ws, 'Envanter');

  const hidden = XLSX.utils.aoa_to_sheet([['gizli veri']]);
  XLSX.utils.book_append_sheet(wb, hidden, 'Gizli');
  const sync = XLSX.utils.aoa_to_sheet([['sync']]);
  XLSX.utils.book_append_sheet(wb, sync, '__SERO_SYNC');

  const meta = (wb.Workbook ??= {}) as { Sheets?: Array<{ Hidden?: number }> };
  meta.Sheets = meta.Sheets || [];
  while (meta.Sheets.length < wb.SheetNames.length) meta.Sheets.push({});
  meta.Sheets[1].Hidden = 1;

  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as unknown as ArrayBuffer;
  // write bu sürümde ArrayBuffer döner; her ihtimale karşı kopya buffer al.
  return new Uint8Array(bytes).buffer;
}

const editableCells: DocumentArtifactEditableCell[] = [
  // cell_ref kasıtlı olarak küçük harf: buildEditableMap toUpperCase ile eşleşmeli.
  { sheet: 'Envanter', cell_ref: 'b2', label: 'Adet', input_kind: 'decimal' },
  { sheet: 'Envanter', cell_ref: 'C2', label: 'İskonto', input_kind: 'percent' },
  { sheet: 'Envanter', cell_ref: 'D2', label: 'Tarih', input_kind: 'date' },
  { sheet: 'Envanter', cell_ref: 'E2', label: 'Formül hücresi', input_kind: 'decimal' },
];

const previews: DocumentArtifactSheetPreview[] = [
  {
    name: 'Envanter',
    mode: 'editable',
    system_sync: true,
    columns: ['A', 'B', 'C'],
    rows: [
      ['Malzeme', 'Adet', 'Oran'],
      ['Kablo', '12.5', '12.5%'],
    ],
    note: 'envanter notu',
  },
];

describe('parseWorkbookGrid (gerçek xlsx)', () => {
  it('çalışma kitabını ayrıştırır ve editable_cells haritasını uygular', () => {
    const sheets = parseWorkbookGrid(buildWorkbookArrayBuffer(), previews, editableCells);

    // 'Gizli' (Hidden) ve '__SERO_SYNC' sayfaları dışlanır.
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    expect(sheet.name).toBe('Envanter');
    expect(sheet.mode).toBe('editable');
    expect(sheet.systemSync).toBe(true);
    expect(sheet.note).toBe('envanter notu');
    expect(sheet.columns).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(sheet.rows).toHaveLength(4);

    const row2 = sheet.rows[1];
    expect(row2).toHaveLength(5);
    expect(row2[0]).toMatchObject({ cellRef: 'A2', rowNumber: 2, value: 'Kablo', editable: false });
    expect(row2[1]).toMatchObject({
      cellRef: 'B2',
      rowNumber: 2,
      value: '12.5',
      editable: true,
      inputKind: 'decimal',
      label: 'Adet',
    });
    // percent: 0.125 -> 12.5 (0..1 kesri insan formuna çevrilir).
    expect(row2[2]).toMatchObject({ cellRef: 'C2', value: '12.5', editable: true, inputKind: 'percent' });
    // date: Date hücresi YYYY-MM-DD'e indirgenir.
    expect(row2[3]).toMatchObject({ cellRef: 'D2', value: '2026-01-15', editable: true, inputKind: 'date' });
    // '=' ile başlayan metin formül sayılır ve tanım olsa bile düzenlenemez.
    expect(row2[4]).toMatchObject({ cellRef: 'E2', value: '=1+1', formula: true, editable: false });
  });

  it('birleştirme köküne colSpan/rowSpan yazar ve örtük hücreleri null yapar', () => {
    const sheets = parseWorkbookGrid(buildWorkbookArrayBuffer(), previews, editableCells);
    const row4 = sheets[0].rows[3];
    expect(row4[0]).toMatchObject({ cellRef: 'A4', value: 'Toplam', colSpan: 2, rowSpan: 1 });
    expect(row4[1]).toBeNull();
  });

  it('tanımsız hücreleri hatasız boş değerle doldurur', () => {
    const sheets = parseWorkbookGrid(buildWorkbookArrayBuffer(), previews, editableCells);
    // B3 'not' metni; C3/E3 boş.
    const row3 = sheets[0].rows[2];
    expect(row3[1]).toMatchObject({ cellRef: 'B3', value: 'not', editable: false });
    expect(row3[2]).toMatchObject({ cellRef: 'C3', value: '', editable: false });
    expect(row3[4]).toMatchObject({ cellRef: 'E3', value: '', editable: false });
  });

  it('readonly önizleme modunda tanımlı hücreler bile düzenlenemez', () => {
    const readonlyPreviews: DocumentArtifactSheetPreview[] = [
      { ...previews[0], mode: 'readonly' },
    ];
    const sheets = parseWorkbookGrid(buildWorkbookArrayBuffer(), readonlyPreviews, editableCells);
    expect(sheets[0].mode).toBe('readonly');
    expect(sheets[0].rows[1][1]).toMatchObject({ cellRef: 'B2', editable: false });
  });

  it('bozuk bayt akışında önizleme satırlarından salt okunur yedek ızgara üretir', () => {
    // ZIP imzası taşıyan ama içinde zip olmayan akış: XLSX.read gerçekten
    // patlar ('Unsupported ZIP file') ve parseWorkbookGrid yedek yola düşer.
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]).buffer as ArrayBuffer;
    const sheets = parseWorkbookGrid(garbage, previews, editableCells);

    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    expect(sheet.name).toBe('Envanter');
    expect(sheet.mode).toBe('editable');
    expect(sheet.systemSync).toBe(true);
    expect(sheet.columns).toEqual(['A', 'B', 'C']);
    // Yedek yolu düzenlenebilir hücre üretmez — önizleme satır indeksinden
    // adres üretilmesi yasaktır.
    expect(sheet.rows[0][0]).toMatchObject({ cellRef: 'A1', value: 'Malzeme', editable: false });
    expect(sheet.rows[1][0]).toMatchObject({ cellRef: 'A2', value: 'Kablo', editable: false });
    expect(sheet.rows[1][2]).toMatchObject({ cellRef: 'C2', value: '12.5%', editable: false });
    // Düzenlenebilir tanımı B2 için var ama yedek ızgara onu düzenlenebilir yapmamalı.
    expect(sheet.rows[1][1]).toMatchObject({ cellRef: 'B2', editable: false });
  });
});

describe('overlayWorkbookEdits', () => {
  const sheets = parseWorkbookGrid(buildWorkbookArrayBuffer(), previews, editableCells);

  it('boş edits ile aynı referansı döndürür', () => {
    expect(overlayWorkbookEdits(sheets, {})).toBe(sheets);
  });

  it('editleri hedef hücreye uygular ve kaynağı değiştirmez', () => {
    const originalB2 = sheets[0].rows[1][1];
    expect(originalB2).not.toBeNull();
    const overlaid = overlayWorkbookEdits(sheets, { 'Envanter:B2': '20' });

    expect(overlaid).not.toBe(sheets);
    const edited = overlaid[0].rows[1][1];
    expect(edited).not.toBeNull();
    expect(edited!.value).toBe('20');
    // Düzenlenmeyen hücre aynı referansı korur.
    expect(overlaid[0].rows[1][0]).toBe(sheets[0].rows[1][0]);
    // Kaynak dizi değişmemeli.
    expect(originalB2!.value).toBe('12.5');
  });

  it('bilinmeyen hücre anahtarları ızgarayı değiştirmez', () => {
    const overlaid = overlayWorkbookEdits(sheets, { 'Envanter:Z99': '20' });
    expect(overlaid).not.toBe(sheets);
    expect(overlaid[0].rows[1][1]).toBe(sheets[0].rows[1][1]);
  });
});
