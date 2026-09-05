import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import type {
  DocumentArtifactPreview,
  DocumentArtifactReconcilePreview,
} from '@/types';

const {
  apiRequestMock,
  toastErrorMock,
  downloadAuthedDocumentMock,
  exportDocumentBytesMock,
  isTauriRuntimeMock,
  pickDocumentImportFileMock,
} = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  toastErrorMock: vi.fn(),
  downloadAuthedDocumentMock: vi.fn(),
  exportDocumentBytesMock: vi.fn(),
  isTauriRuntimeMock: vi.fn(() => false),
  pickDocumentImportFileMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  localizeApiError: (e: unknown) => String(e),
  downloadAuthedDocument: downloadAuthedDocumentMock,
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/lib/desktop', () => ({
  exportDocumentBytes: exportDocumentBytesMock,
  isTauriRuntime: isTauriRuntimeMock,
  pickDocumentImportFile: pickDocumentImportFileMock,
}));

import { flushPendingSaves, PendingSaveError } from '@/lib/saveCoordinator';

import { useExcelPreviewState } from '../useExcelPreviewState';

const PREVIEW_URL = '/api/v2/excel-preview/alis-workspace/WS-1';
const DOWNLOAD_PATH = '/api/v2/documents/art-1/download';
const RECONCILE_PREVIEW_URL = '/api/v2/alis/workspace/WS-1/artifact/reconcile-preview';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const previewData: DocumentArtifactPreview = {
  title: 'Alış çalışma alanı',
  subtitle: 'WS-1',
  artifact: {
    id: 'art-1',
    artifact_key: 'WS-1',
    module_name: 'alis',
    document_type: 'workspace',
    business_key: 'WS-1',
    version_kind: 'draft',
    is_live: true,
    file_name: 'alis-ws.xlsx',
    mime_type: XLSX_MIME,
    size_bytes: 4096,
    updated_at: '2026-08-30T10:00:00Z',
  },
  revision: 1,
  download_path: DOWNLOAD_PATH,
  import_supported: true,
  external_edit_supported: true,
  editable_cells: [{ sheet: 'Sayfa1', cell_ref: 'B2', label: 'Miktar', input_kind: 'number' }],
  sheets: [],
};

function buildWorkbookBlob(): Blob {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Doküman', ''],
    ['Miktar', '10'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sayfa1');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as unknown as BlobPart;
  return new Blob([bytes], { type: XLSX_MIME });
}

type MockApiOptions = {
  preview?: DocumentArtifactPreview;
  workbook?: Blob;
  reconcilePreview?: DocumentArtifactReconcilePreview;
  reconcileApply?: Record<string, unknown>;
};

function mockApiRoutes(options: MockApiOptions = {}) {
  const {
    preview = previewData,
    workbook = buildWorkbookBlob(),
    reconcilePreview = { editable: true, changes: [], warnings: [] },
    reconcileApply = {},
  } = options;
  apiRequestMock.mockImplementation((url: unknown) => {
    if (typeof url !== 'string') return Promise.resolve(preview);
    if (url.startsWith('/api/v2/excel-preview/')) return Promise.resolve(preview);
    if (url === DOWNLOAD_PATH) return Promise.resolve(workbook);
    if (url.includes('/reconcile-preview')) return Promise.resolve(reconcilePreview);
    if (url.includes('/reconcile-apply')) return Promise.resolve(reconcileApply);
    return Promise.resolve(preview);
  });
}

function renderExcelState(initialEntry = '/excel/alis-workspace/WS-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/excel" element={children} />
          <Route path="/excel/:kind" element={children} />
          <Route path="/excel/:kind/:key" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => useExcelPreviewState(), { wrapper: Wrapper });
}

type ExcelState = ReturnType<typeof renderExcelState>;

function findCell(state: ExcelState, sheetName: string, cellRef: string) {
  const sheet = state.result.current.workbook?.sheets.find((entry) => entry.name === sheetName);
  return sheet?.rows.flat().find((cell) => cell?.cellRef === cellRef) ?? null;
}

function callsTo(urlPart: string): Array<Array<unknown>> {
  return apiRequestMock.mock.calls.filter((call) => String(call[0]).includes(urlPart));
}

describe('useExcelPreviewState', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastErrorMock.mockReset();
    downloadAuthedDocumentMock.mockReset();
    exportDocumentBytesMock.mockReset();
    pickDocumentImportFileMock.mockReset();
    isTauriRuntimeMock.mockReset();
    isTauriRuntimeMock.mockReturnValue(false);
  });

  describe('preview sorgusu route parametrelerine bagli', () => {
    it('iki parametre de bosken preview sorgusu calismaz', () => {
      mockApiRoutes();
      const state = renderExcelState('/excel');

      expect(state.result.current.kind).toBe('');
      expect(state.result.current.artifactKey).toBe('');
      expect(state.result.current.preview).toBeNull();
      expect(state.result.current.isError).toBe(false);
      expect(apiRequestMock).not.toHaveBeenCalled();
    });

    it('yalnizca kind doluyken (key bos) preview sorgusu calismaz', () => {
      mockApiRoutes();
      const state = renderExcelState('/excel/alis-workspace');

      expect(state.result.current.kind).toBe('alis-workspace');
      expect(state.result.current.artifactKey).toBe('');
      expect(state.result.current.preview).toBeNull();
      expect(apiRequestMock).not.toHaveBeenCalled();
    });

    it('iki parametre doluyken preview ve workbook yukler', async () => {
      mockApiRoutes();
      const state = renderExcelState();

      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());
      await waitFor(() => expect(state.result.current.isLoading).toBe(false));

      expect(apiRequestMock).toHaveBeenCalledWith(PREVIEW_URL);
      expect(state.result.current.preview?.title).toBe('Alış çalışma alanı');
      expect(state.result.current.kind).toBe('alis-workspace');
      expect(state.result.current.artifactKey).toBe('WS-1');

      const sheet = state.result.current.workbook?.sheets[0];
      expect(sheet?.name).toBe('Sayfa1');
      expect(sheet?.columns).toEqual(['A', 'B']);
      expect(findCell(state, 'Sayfa1', 'A1')?.value).toBe('Doküman');
      expect(findCell(state, 'Sayfa1', 'B2')?.value).toBe('10');
      expect(findCell(state, 'Sayfa1', 'B2')?.editable).toBe(true);
      expect(findCell(state, 'Sayfa1', 'B2')?.label).toBe('Miktar');
      expect(findCell(state, 'Sayfa1', 'A1')?.editable).toBe(false);

      expect(state.result.current.isEditable).toBe(true);
      expect(state.result.current.dirtyCount).toBe(0);
      expect(state.result.current.reconcilePreview).toBeNull();
      expect(state.result.current.useNativeImportDialog).toBe(false);
    });
  });

  describe('hücre düzenleme state', () => {
    it('onCellChange duzenlemeyi kaydeder ve workbook hucre degerini gunceller', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });

      expect(state.result.current.dirtyCount).toBe(1);
      expect(findCell(state, 'Sayfa1', 'B2')?.value).toBe('42');
      expect(state.result.current.reconcilePreview).toBeNull();

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'C1', 'ek');
      });
      expect(state.result.current.dirtyCount).toBe(2);
    });
  });

  describe('onPreviewChanges', () => {
    it('duzenlenmis workbook ile reconcile-preview ucu POST eder ve onizlemeyi tutar', async () => {
      const reconcilePreview: DocumentArtifactReconcilePreview = {
        editable: true,
        changes: [
          { sheet: 'Sayfa1', cell_ref: 'B2', label: 'Miktar', old_value: '10', new_value: '42' },
        ],
        warnings: [],
      };
      mockApiRoutes({ reconcilePreview });
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });
      await act(async () => {
        await state.result.current.onPreviewChanges();
      });

      await waitFor(() => expect(state.result.current.reconcilePreview).not.toBeNull());
      expect(state.result.current.reconcilePreview?.changes).toHaveLength(1);

      const previewCalls = callsTo('/reconcile-preview');
      expect(previewCalls).toHaveLength(1);
      expect(previewCalls[0][0]).toBe(RECONCILE_PREVIEW_URL);
      const options = previewCalls[0][1] as { method: string; body: FormData };
      expect(options.method).toBe('POST');
      const file = options.body.get('workbook');
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe('alis-ws.xlsx');

      // Yeni hücre düzenlemesi önceki reconcile önizlemesini temizler.
      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '43');
      });
      expect(state.result.current.reconcilePreview).toBeNull();
      expect(state.result.current.dirtyCount).toBe(1);
      expect(findCell(state, 'Sayfa1', 'B2')?.value).toBe('43');
    });

    it('md9: previewMutation onError toast.error cagirir ve cellEdits korunur', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });

      apiRequestMock.mockRejectedValueOnce(new Error('onizleme sunucu hatasi'));
      await act(async () => {
        await state.result.current.onPreviewChanges();
      });

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Değişiklikler önizlenemedi',
        'Error: onizleme sunucu hatasi',
      );

      // md9 düzeltmesi: hata durumunda kullanıcı düzenlemeleri kaybolmaz.
      expect(state.result.current.dirtyCount).toBe(1);
      expect(findCell(state, 'Sayfa1', 'B2')?.value).toBe('42');
      expect(state.result.current.reconcilePreview).toBeNull();
      expect(state.result.current.isError).toBe(false);
    });
  });

  describe('onApplyChanges', () => {
    it('basarili apply duzenlemeleri sifirlar ve sorgulari tazeler', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });
      await act(async () => {
        await state.result.current.onApplyChanges();
      });

      await waitFor(() => expect(state.result.current.dirtyCount).toBe(0));
      expect(state.result.current.reconcilePreview).toBeNull();
      expect(callsTo('/reconcile-apply')).toHaveLength(1);

      // invalidateQueries sonrasi preview sorgusu yeniden cekilir.
      await waitFor(() => {
        const previewCalls = apiRequestMock.mock.calls.filter(
          (call) => String(call[0]) === PREVIEW_URL,
        );
        expect(previewCalls.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('md9: applyMutation onError toast.error cagirir ve cellEdits korunur', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });

      apiRequestMock.mockRejectedValueOnce(new Error('uygulama sunucu hatasi'));
      await act(async () => {
        await state.result.current.onApplyChanges();
      });

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Değişiklikler uygulanamadı',
        'Error: uygulama sunucu hatasi',
      );

      // md9 düzeltmesi: hata durumunda kullanıcı düzenlemeleri kaybolmaz,
      // sorgular da invalidate edilmez.
      expect(state.result.current.dirtyCount).toBe(1);
      expect(findCell(state, 'Sayfa1', 'B2')?.value).toBe('42');
      expect(state.result.current.reconcilePreview).toBeNull();
      const previewCalls = apiRequestMock.mock.calls.filter(
        (call) => String(call[0]) === PREVIEW_URL,
      );
      expect(previewCalls).toHaveLength(1);
    });
  });

  describe('onExport', () => {
    it('tarayici modunda downloadAuthedDocument kullanir', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      await act(async () => {
        await state.result.current.onExport();
      });

      expect(downloadAuthedDocumentMock).toHaveBeenCalledTimes(1);
      expect(downloadAuthedDocumentMock).toHaveBeenCalledWith(DOWNLOAD_PATH, 'alis-ws.xlsx');
      expect(exportDocumentBytesMock).not.toHaveBeenCalled();
    });

    it('tauri modunda exportDocumentBytes kullanir', async () => {
      isTauriRuntimeMock.mockReturnValue(true);
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());
      expect(state.result.current.useNativeImportDialog).toBe(true);

      await act(async () => {
        await state.result.current.onExport();
      });

      expect(exportDocumentBytesMock).toHaveBeenCalledTimes(1);
      const [fileName, dataBase64] = exportDocumentBytesMock.mock.calls[0] as [string, string];
      expect(fileName).toBe('alis-ws.xlsx');
      expect(typeof dataBase64).toBe('string');
      expect(dataBase64.length).toBeGreaterThan(0);
      expect(downloadAuthedDocumentMock).not.toHaveBeenCalled();
    });
  });

  describe('ice aktarim', () => {
    it('basarili ice aktarim cellEdits temizler: eski duzenlemeler diff e karismaz', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });
      expect(state.result.current.dirtyCount).toBe(1);

      const pickedFile = new File(['import'], 'degisiklik.xlsx', { type: XLSX_MIME });
      await act(async () => {
        await state.result.current.onImportFile(pickedFile);
      });

      await waitFor(() => expect(state.result.current.reconcilePreview).not.toBeNull());
      // İçe aktarılan dosya gönderim kaynağıdır; hücre düzenlemeleri sıfırlanır.
      expect(state.result.current.dirtyCount).toBe(0);
      expect(state.result.current.pendingImportFileName).toBe('degisiklik.xlsx');
    });

    it('editable false veya blocking_errors dolu preview da apply engellenir', async () => {
      mockApiRoutes({
        reconcilePreview: {
          editable: false,
          changes: [{ sheet: 'Sayfa1', cell_ref: 'B2', label: 'Miktar', old_value: '10', new_value: '42' }],
          warnings: [],
          blocking_errors: ['Tamamlanmış belge düzenlenemez'],
        },
      });
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      const pickedFile = new File(['import'], 'degisiklik.xlsx', { type: XLSX_MIME });
      await act(async () => {
        await state.result.current.onImportFile(pickedFile);
      });
      await waitFor(() => expect(state.result.current.reconcilePreview).not.toBeNull());

      await act(async () => {
        await state.result.current.onApplyChanges();
      });

      expect(callsTo('/reconcile-apply')).toHaveLength(0);
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Değişiklikler uygulanamadı',
        'Tamamlanmış belge düzenlenemez',
      );
    });

    it('kirli hücre varken pending save handler close akışını reddeder', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      // Temiz durumda flush sorunsuz tamamlanır.
      await expect(flushPendingSaves()).resolves.toBeUndefined();

      act(() => {
        state.result.current.onCellChange('Sayfa1', 'B2', '42');
      });

      // make/excel'de otomatik kayıt yok: kirli durum close akışını
      // karar diyaloğuna düşürür.
      await expect(flushPendingSaves()).rejects.toBeInstanceOf(PendingSaveError);

      state.unmount();
    });

    it('onImportFromDialog tauri olmadan islem yapmaz', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      await act(async () => {
        await state.result.current.onImportFromDialog();
      });

      expect(pickDocumentImportFileMock).not.toHaveBeenCalled();
      expect(callsTo('/reconcile')).toHaveLength(0);
    });

    it('onImportFile secilen dosyayla reconcile-preview tetikler', async () => {
      mockApiRoutes();
      const state = renderExcelState();
      await waitFor(() => expect(state.result.current.workbook).not.toBeNull());

      const pickedFile = new File(['import'], 'degisiklik.xlsx', { type: XLSX_MIME });
      await act(async () => {
        await state.result.current.onImportFile(pickedFile);
      });

      await waitFor(() => expect(state.result.current.reconcilePreview).not.toBeNull());
      const previewCalls = callsTo('/reconcile-preview');
      expect(previewCalls).toHaveLength(1);
      expect(previewCalls[0][0]).toBe(RECONCILE_PREVIEW_URL);
      const formData = (previewCalls[0][1] as { body: FormData }).body;
      expect((formData.get('workbook') as File).name).toBe('degisiklik.xlsx');
    });
  });
});
