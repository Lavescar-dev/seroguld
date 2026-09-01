import * as XLSX from 'xlsx';

import type { DocumentArtifactEditableCell, DocumentArtifactSheetPreview } from '@/types';

import type { EmbeddedWorkbookCell, EmbeddedWorkbookSheet } from './types';

function formatWorkbookCell(cell?: XLSX.CellObject): string {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v == null) return '';
  return String(cell.v);
}

function formatEditableWorkbookCell(cell: XLSX.CellObject | undefined, inputKind?: string): string {
  if (!cell) return '';
  if (inputKind === 'date') {
    if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
      const year = cell.v.getFullYear();
      const month = String(cell.v.getMonth() + 1).padStart(2, '0');
      const day = String(cell.v.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
      const parsed = XLSX.SSF.parse_date_code(cell.v);
      if (parsed) {
        return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
    }
    const text = String(cell.v ?? '').trim();
    const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return isoDate ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` : '';
  }
  if (inputKind === 'decimal' || inputKind === 'percent') {
    const raw = cell.v;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      // Excel stores percentages as fractions (0.124 => 12.4%). The API
      // contract accepts the human-facing 0..100 form as well.
      const value = inputKind === 'percent' && Math.abs(raw) <= 1 ? raw * 100 : raw;
      return String(value);
    }
    if (raw != null && String(raw).trim()) {
      return String(raw).replace(/\s/g, '').replace(/%$/, '');
    }
    return '';
  }
  if (inputKind === 'boolean') {
    const raw = String(cell.v ?? '').trim().toLocaleLowerCase('tr-TR');
    return ['1', 'true', 'yes', 'evet', 'ja', 'on', 'aktif', 'açık', 'acik'].includes(raw) ? '1' : '0';
  }
  return formatWorkbookCell(cell);
}

function buildEditableMap(cells: DocumentArtifactEditableCell[]) {
  const map = new Map<string, DocumentArtifactEditableCell>();
  cells.forEach((cell) => map.set(`${cell.sheet}:${cell.cell_ref.toUpperCase()}`, cell));
  return map;
}

function previewFallback(
  previews: DocumentArtifactSheetPreview[],
  _editableMap: Map<string, DocumentArtifactEditableCell>,
): EmbeddedWorkbookSheet[] {
  return previews.map((sheet) => ({
    name: sheet.name,
    mode: sheet.mode,
    systemSync: sheet.system_sync,
    columns: sheet.columns,
    note: sheet.note,
    rows: sheet.rows.map((row, rowIndex) =>
      row.map((value, columnIndex) => {
        const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        return {
          cellRef,
          value: value || '',
          // A failed workbook parse must never manufacture editable cell
          // addresses from preview row indices. Keep this fallback read-only
          // until the original workbook can be parsed.
          editable: false,
          inputKind: undefined,
          label: undefined,
        } satisfies EmbeddedWorkbookCell;
      }),
    ),
  }));
}

/**
 * Read the original workbook only for display metadata (values and merges).
 * This module intentionally has no XLSX.write path: edits go through the
 * controlled artifact PATCH endpoint so .xlsm/VBA content is never rewritten
 * by the browser.
 */
export function parseWorkbookGrid(
  buffer: ArrayBuffer,
  previews: DocumentArtifactSheetPreview[],
  editableCells: DocumentArtifactEditableCell[],
): EmbeddedWorkbookSheet[] {
  const editableMap = buildEditableMap(editableCells);
  try {
    const workbook = XLSX.read(buffer.slice(0), {
      type: 'array',
      // !rows[].hidden yalnız cellStyles açıkken parse edilir — AFG grid
      // satırlarının görünürlüğü backend'de veriye göre belirlenir.
      cellStyles: true,
      cellHTML: false,
      bookVBA: true,
      cellFormula: true,
      cellDates: true,
    });
    const previewByName = new Map(previews.map((sheet) => [sheet.name, sheet]));

    const hiddenSheetNames = new Set(
      (workbook.Workbook?.Sheets || [])
        .filter((entry) => entry.Hidden)
        .map((entry) => entry.name),
    );
    return workbook.SheetNames.filter(
      (sheetName) => sheetName !== '__SERO_SYNC' && !hiddenSheetNames.has(sheetName),
    ).map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const preview = previewByName.get(sheetName);
      const ref = sheet['!ref'] || 'A1:A1';
      const range = XLSX.utils.decode_range(ref);
      const rowMeta = sheet['!rows'] || [];
      const isRowHidden = (rowIndex: number) => rowMeta[rowIndex]?.hidden === true;
      const merges = sheet['!merges'] || [];
      const hiddenCells = new Set<string>();
      const mergeRoots = new Map<string, { colSpan: number; rowSpan: number }>();

      merges.forEach((merge) => {
        // Kökü gizli satırda olan merge düşer; kökü görünür satırda olan
        // merge'in rowSpan'ı yalnız görünür satırları sayar (gizli satırlar
        // grid'den çıkarıldığı için rowspan tabloda kaymaya yol açar).
        if (isRowHidden(merge.s.r)) return;
        let visibleRowCount = 0;
        for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
          if (!isRowHidden(rowIndex)) visibleRowCount += 1;
        }
        const rootKey = `${merge.s.r}:${merge.s.c}`;
        mergeRoots.set(rootKey, {
          colSpan: merge.e.c - merge.s.c + 1,
          rowSpan: visibleRowCount,
        });
        for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
          for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
            if (rowIndex !== merge.s.r || columnIndex !== merge.s.c) {
              hiddenCells.add(`${rowIndex}:${columnIndex}`);
            }
          }
        }
      });

      const rows: Array<Array<EmbeddedWorkbookCell | null>> = [];
      for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
        // Gizli satır grid'e hiç girmez; kalan hücreler orijinal Excel
        // referanslarını (cellRef/rowNumber) korur — PATCH adresleri ve
        // backend parse bozulmaz.
        if (isRowHidden(rowIndex)) continue;
        const row: Array<EmbeddedWorkbookCell | null> = [];
        for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
          if (hiddenCells.has(`${rowIndex}:${columnIndex}`)) {
            row.push(null);
            continue;
          }
          const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
          const sourceCell = sheet[cellRef] as XLSX.CellObject | undefined;
          const definition = editableMap.get(`${sheetName}:${cellRef}`);
          const isFormula = Boolean(sourceCell?.f) || (typeof sourceCell?.v === 'string' && sourceCell.v.startsWith('='));
          row.push({
            cellRef,
            rowNumber: rowIndex + 1,
            value: formatEditableWorkbookCell(sourceCell, definition?.input_kind),
            editable: Boolean(definition) && preview?.mode !== 'readonly' && !isFormula,
            inputKind: definition?.input_kind,
            label: definition?.label,
            formula: isFormula,
            ...mergeRoots.get(`${rowIndex}:${columnIndex}`),
          });
        }
        rows.push(row);
      }

      return {
        name: sheetName,
        mode: preview?.mode || 'derived',
        systemSync: preview?.system_sync || false,
        columns: Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => XLSX.utils.encode_col(range.s.c + index)),
        rows,
        note: preview?.note,
      } satisfies EmbeddedWorkbookSheet;
    });
  } catch {
    return previewFallback(previews, editableMap);
  }
}

export function overlayWorkbookEdits(
  sheets: EmbeddedWorkbookSheet[],
  edits: Record<string, string>,
): EmbeddedWorkbookSheet[] {
  if (Object.keys(edits).length === 0) return sheets;
  return sheets.map((sheet) => ({
    ...sheet,
    rows: sheet.rows.map((row) =>
      row.map((cell) => {
        if (!cell) return null;
        const value = edits[`${sheet.name}:${cell.cellRef}`];
        return value === undefined ? cell : { ...cell, value };
      }),
    ),
  }));
}
