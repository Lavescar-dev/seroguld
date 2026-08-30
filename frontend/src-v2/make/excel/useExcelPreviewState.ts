import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';

import { apiRequest, downloadAuthedDocument, localizeApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { exportDocumentBytes, isTauriRuntime, pickDocumentImportFile } from '@/lib/desktop';
import type {
  DocumentArtifactEditableCell,
  DocumentArtifactPreview,
  DocumentArtifactReconcilePreview,
} from '@/types';

import type {
  ExcelPreviewPageProps,
  ExcelWorkbookCellPreview,
  ExcelWorkbookPreview,
  ExcelWorkbookSheetPreview,
} from './ExcelPreviewPage';

type WorkbookSource = {
  rawBuffer: ArrayBuffer;
  fileName: string;
  sheets: ExcelWorkbookSheetPreview[];
};

function formatWorkbookCell(cell?: XLSX.CellObject): string {
  if (!cell) return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v == null) return '';
  return String(cell.v);
}

function buildEditableMap(cells: DocumentArtifactEditableCell[]) {
  const map = new Map<string, DocumentArtifactEditableCell>();
  cells.forEach((cell) => {
    map.set(`${cell.sheet}:${cell.cell_ref}`, cell);
  });
  return map;
}

function parseWorkbook(buffer: ArrayBuffer, editableCells: DocumentArtifactEditableCell[]): ExcelWorkbookSheetPreview[] {
  const editableMap = buildEditableMap(editableCells);
  const workbook = XLSX.read(buffer.slice(0), { type: 'array', cellStyles: false, cellHTML: false, bookVBA: true });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet['!ref'] || 'A1:A1';
    const range = XLSX.utils.decode_range(ref);
    const columnCount = range.e.c - range.s.c + 1;
    const rowCount = range.e.r - range.s.r + 1;
    const merges = sheet['!merges'] || [];
    const hiddenCells = new Set<string>();
    const mergeRoots = new Map<string, { colSpan: number; rowSpan: number }>();

    merges.forEach((merge) => {
      const rootKey = `${merge.s.r}:${merge.s.c}`;
      mergeRoots.set(rootKey, {
        colSpan: merge.e.c - merge.s.c + 1,
        rowSpan: merge.e.r - merge.s.r + 1,
      });
      for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
        for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
          if (rowIndex === merge.s.r && columnIndex === merge.s.c) continue;
          hiddenCells.add(`${rowIndex}:${columnIndex}`);
        }
      }
    });

    const rows: Array<Array<ExcelWorkbookCellPreview | null>> = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const absoluteRow = range.s.r + rowIndex;
      const row: Array<ExcelWorkbookCellPreview | null> = [];
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const absoluteColumn = range.s.c + columnIndex;
        const key = `${absoluteRow}:${absoluteColumn}`;
        if (hiddenCells.has(key)) {
          row.push(null);
          continue;
        }

        const cellRef = XLSX.utils.encode_cell({ r: absoluteRow, c: absoluteColumn });
        const mergeRoot = mergeRoots.get(key);
        const editableCell = editableMap.get(`${sheetName}:${cellRef}`);
        row.push({
          cellRef,
          value: formatWorkbookCell(sheet[cellRef]),
          editable: Boolean(editableCell),
          inputKind: editableCell?.input_kind,
          label: editableCell?.label,
          colSpan: mergeRoot?.colSpan,
          rowSpan: mergeRoot?.rowSpan,
        });
      }
      rows.push(row);
    }

    return {
      name: sheetName,
      columns: Array.from({ length: columnCount }, (_, index) => XLSX.utils.encode_col(range.s.c + index)),
      rows,
    };
  });
}

function applyEditsToSheets(
  sheets: ExcelWorkbookSheetPreview[],
  edits: Record<string, string>,
): ExcelWorkbookSheetPreview[] {
  if (Object.keys(edits).length === 0) {
    return sheets;
  }

  return sheets.map((sheet) => ({
    ...sheet,
    rows: sheet.rows.map((row) =>
      row.map((cell) => {
        if (!cell) return null;
        const nextValue = edits[`${sheet.name}:${cell.cellRef}`];
        if (nextValue == null) {
          return cell;
        }
        return {
          ...cell,
          value: nextValue,
        };
      }),
    ),
  }));
}

function buildWorkbookFile(
  rawBuffer: ArrayBuffer,
  edits: Record<string, string>,
  fileName: string,
): File {
  const workbook = XLSX.read(rawBuffer.slice(0), { type: 'array', bookVBA: true });
  Object.entries(edits).forEach(([key, value]) => {
    const separator = key.indexOf(':');
    const sheetName = key.slice(0, separator);
    const cellRef = key.slice(separator + 1);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    sheet[cellRef] = {
      t: 's',
      v: value,
      w: value,
    };
    if (!sheet['!ref']) {
      sheet['!ref'] = `${cellRef}:${cellRef}`;
    }
  });

  const extension = fileName.toLowerCase().endsWith('.xlsm') ? 'xlsm' : 'xlsx';
  const nextArray = XLSX.write(workbook, {
    type: 'array',
    bookType: extension,
    bookVBA: extension === 'xlsm',
  }) as ArrayBuffer;
  const mimeType =
    extension === 'xlsm'
      ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return new File([nextArray], fileName, { type: mimeType });
}

function fileFromPickedImport(fileName: string, dataBase64: string): File {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, {
    type: fileName.toLowerCase().endsWith('.xlsm')
      ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function useExcelPreviewState(): ExcelPreviewPageProps {
  const params = useParams<{ kind: string; key: string }>();
  const kind = params.kind || '';
  const artifactKey = params.key || '';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cellEdits, setCellEdits] = useState<Record<string, string>>({});
  const [reconcilePreview, setReconcilePreview] = useState<DocumentArtifactReconcilePreview | null>(null);
  const [pendingWorkbookFile, setPendingWorkbookFile] = useState<File | null>(null);

  const previewQuery = useQuery({
    queryKey: ['excel-preview', kind, artifactKey],
    enabled: Boolean(kind && artifactKey),
    queryFn: () => apiRequest<DocumentArtifactPreview>(`/api/v2/excel-preview/${kind}/${artifactKey}`),
  });

  const workbookQuery = useQuery({
    queryKey: ['excel-preview-workbook', kind, artifactKey, previewQuery.data?.download_path, previewQuery.data?.editable_cells],
    enabled: Boolean(previewQuery.data?.download_path),
    queryFn: async () => {
      const blob = await apiRequest<Blob>(previewQuery.data!.download_path);
      const rawBuffer = await blob.arrayBuffer();
      const fileName = previewQuery.data?.artifact?.file_name || `${kind}-${artifactKey}.xlsx`;
      return {
        rawBuffer,
        fileName,
        sheets: parseWorkbook(rawBuffer, previewQuery.data?.editable_cells || []),
      } as WorkbookSource;
    },
  });

  useEffect(() => {
    setCellEdits({});
    setReconcilePreview(null);
    setPendingWorkbookFile(null);
  }, [kind, artifactKey, workbookQuery.data?.fileName]);

  const isEditable = kind === 'alis-workspace' && previewQuery.data?.artifact?.version_kind === 'draft';
  const workbook = useMemo<ExcelWorkbookPreview | null>(() => {
    if (!workbookQuery.data) return null;
    return {
      sheets: applyEditsToSheets(workbookQuery.data.sheets, cellEdits),
    };
  }, [cellEdits, workbookQuery.data]);

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('workbook', file);
      return apiRequest<DocumentArtifactReconcilePreview>(`/api/v2/alis/workspace/${artifactKey}/artifact/reconcile-preview`, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: (data) => {
      setReconcilePreview(data);
    },
    onError: (error) => {
      // Hata durumunda cellEdits korunur — kullanıcı düzenlemeleri kaybolmaz.
      toast.error('Değişiklikler önizlenemedi', localizeApiError(error));
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('workbook', file);
      return apiRequest(`/api/v2/alis/workspace/${artifactKey}/artifact/reconcile-apply`, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: async () => {
      setCellEdits({});
      setReconcilePreview(null);
      setPendingWorkbookFile(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['excel-preview', kind, artifactKey] }),
        queryClient.invalidateQueries({ queryKey: ['excel-preview-workbook', kind, artifactKey] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'workspace', 'open-draft'] }),
      ]);
    },
    onError: (error) => {
      // Hata durumunda cellEdits korunur — kullanıcı düzenlemeleri kaybolmaz.
      toast.error('Değişiklikler uygulanamadı', localizeApiError(error));
    },
  });

  async function buildPendingFile(): Promise<File | null> {
    if (pendingWorkbookFile) {
      return pendingWorkbookFile;
    }
    if (!workbookQuery.data) {
      return null;
    }
    return buildWorkbookFile(workbookQuery.data.rawBuffer, cellEdits, workbookQuery.data.fileName);
  }

  return {
    kind,
    artifactKey,
    preview: previewQuery.data || null,
    workbook,
    isLoading: previewQuery.isLoading || workbookQuery.isLoading,
    isError: previewQuery.isError || workbookQuery.isError,
    isEditable,
    dirtyCount: Object.keys(cellEdits).length,
    reconcilePreview,
    isPreviewingChanges: previewMutation.isPending,
    isApplyingChanges: applyMutation.isPending,
    useNativeImportDialog: isTauriRuntime(),
    onExport: async () => {
      if (!previewQuery.data?.download_path) return;
      const fileName = previewQuery.data.artifact?.file_name || `${kind}-${artifactKey}.xlsx`;
      const blob = await apiRequest<Blob>(previewQuery.data.download_path);
      if (isTauriRuntime()) {
        const dataBase64 = await blobToBase64(blob);
        await exportDocumentBytes(fileName, dataBase64);
        return;
      }
      void downloadAuthedDocument(previewQuery.data.download_path, fileName);
    },
    onImportFromDialog: async () => {
      if (!isTauriRuntime()) return;
      const picked = await pickDocumentImportFile();
      if (!picked) return;
      const file = fileFromPickedImport(picked.file_name, picked.data_base64);
      setPendingWorkbookFile(file);
      setReconcilePreview(null);
      await previewMutation.mutateAsync(file).catch(() => undefined);
    },
    onImportFile: async (file: File) => {
      setPendingWorkbookFile(file);
      setReconcilePreview(null);
      await previewMutation.mutateAsync(file).catch(() => undefined);
    },
    onCellChange: (sheetName, cellRef, value) => {
      setPendingWorkbookFile(null);
      setReconcilePreview(null);
      setCellEdits((current) => ({
        ...current,
        [`${sheetName}:${cellRef}`]: value,
      }));
    },
    onPreviewChanges: async () => {
      const file = await buildPendingFile();
      if (!file) return;
      await previewMutation.mutateAsync(file).catch(() => undefined);
    },
    onApplyChanges: async () => {
      const file = await buildPendingFile();
      if (!file) return;
      await applyMutation.mutateAsync(file).catch(() => undefined);
    },
  };
}
