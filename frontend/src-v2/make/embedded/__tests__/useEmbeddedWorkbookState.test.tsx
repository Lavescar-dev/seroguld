import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return {
    ApiError,
    apiRequest: apiRequestMock,
    localizeApiError: (error: unknown) => String(error),
    buildApiUrl: (path: string) => `http://127.0.0.1:8000${path}`,
    downloadAuthedDocument: vi.fn(),
  };
});

// A2 deseni: modülün kullandığı tüm exportlar tek tek mocklanır.
vi.mock('@/lib/desktop', () => ({
  isTauriRuntime: vi.fn(() => false),
  getExcelAvailability: vi.fn(async () => ({ available: true })),
  probeExcelComAvailability: vi.fn(async () => ({ available: false, confidence: 'high', error: null })),
  launchExcelBridge: vi.fn(async () => ({ running: true })),
  focusManagedExcelSession: vi.fn(async () => true),
  closeManagedExcelSession: vi.fn(async () => true),
  exportDocumentBytes: vi.fn(async () => ({ path: 'C:/exports/cikti.xlsx', mode: 'save-dialog' })),
  getDesktopStartupState: vi.fn(async () => ({ state: 'ready', message: 'ok', excel_bridge_running: true })),
  writeUiDiagnostic: vi.fn(async () => ({ path: 'C:/logs/ui-diagnostics.jsonl' })),
}));

vi.mock('@/lib/saveCoordinator', () => ({
  isPendingSaveDiscarded: vi.fn(() => false),
  registerPendingSaveHandler: vi.fn(() => () => undefined),
}));

import { ApiError, downloadAuthedDocument } from '@/lib/api';
import {
  exportDocumentBytes,
  getDesktopStartupState,
  getExcelAvailability,
  isTauriRuntime,
  launchExcelBridge,
  probeExcelComAvailability,
  writeUiDiagnostic,
} from '@/lib/desktop';
import { isPendingSaveDiscarded } from '@/lib/saveCoordinator';
import { t } from '@/lib/locale';
import type {
  DocumentArtifactCellsPatchOut,
  DocumentArtifactPreview,
  DocumentArtifactRecord,
} from '@/types';

import { useEmbeddedWorkbookState } from '../useEmbeddedWorkbookState';

// ---------------------------------------------------------------------------
// Gerçek xlsx bayt akışı (SheetJS mock'lanmaz)
// ---------------------------------------------------------------------------

function buildWorkbookBlob(): Blob {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Malzeme', 'Adet', 'Oran'],
    ['Kablo', 12.5, 0.125],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Envanter');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as unknown as ArrayBuffer;
  return new Blob([new Uint8Array(bytes)], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
}

const workbookBlob = buildWorkbookBlob();

const artifactRecord: DocumentArtifactRecord = {
  id: 'artifact-1',
  artifact_key: 'live',
  module_name: 'depolama',
  document_type: 'inventory',
  business_key: 'live',
  version_kind: 'draft',
  is_live: true,
  file_name: 'depolama-envanter.xlsm',
  mime_type: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  size_bytes: workbookBlob.size,
  revision: 3,
  updated_at: '2026-08-30T10:00:00Z',
};

const previewPayload: DocumentArtifactPreview = {
  title: 'Depolama Envanteri',
  download_path: '/api/v2/document-artifacts/depolama/live/download',
  import_supported: false,
  external_edit_supported: true,
  artifact: artifactRecord,
  editable_cells: [
    { sheet: 'Envanter', cell_ref: 'B2', label: 'Adet', input_kind: 'decimal' },
    { sheet: 'Envanter', cell_ref: 'C2', label: 'İskonto', input_kind: 'percent' },
  ],
  sheets: [
    {
      name: 'Envanter',
      mode: 'editable',
      system_sync: false,
      columns: ['A', 'B', 'C'],
      rows: [
        ['Malzeme', 'Adet', 'Oran'],
        ['Kablo', '12.5', '12.5%'],
      ],
    },
  ],
};

const appliedPatch = {
  revision: 8,
  status: 'applied' as const,
  applied_changes: [{ sheet: 'Envanter', cell_ref: 'B2', value: '20' }],
  warnings: [],
  cell_errors: [],
};

type ApiRequestOptions = { method?: string; body?: string };
type PatchHandler = (path: string, options?: ApiRequestOptions) => unknown;

let patchHandler: PatchHandler | null = null;

function routeApiRequest(path: string, options?: ApiRequestOptions) {
  if (path.startsWith('/api/v2/excel-preview/')) return previewPayload;
  if (options?.method === 'PATCH') {
    if (patchHandler) return patchHandler(path, options);
    return appliedPatch;
  }
  return workbookBlob;
}

// ---------------------------------------------------------------------------
// Mock referansları ve yardımcılar
// ---------------------------------------------------------------------------

const mockedIsTauri = vi.mocked(isTauriRuntime);
const mockedGetAvail = vi.mocked(getExcelAvailability);
const mockedProbe = vi.mocked(probeExcelComAvailability);
const mockedExportBytes = vi.mocked(exportDocumentBytes);
const mockedDownload = vi.mocked(downloadAuthedDocument);
const mockedIsDiscarded = vi.mocked(isPendingSaveDiscarded);
const mockedLaunch = vi.mocked(launchExcelBridge);
const mockedStartupState = vi.mocked(getDesktopStartupState);
const mockedWriteDiagnostic = vi.mocked(writeUiDiagnostic);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

function renderWorkbookHook(kind = 'depolama', artifactKey = 'live') {
  return renderHook(() => useEmbeddedWorkbookState(kind, artifactKey), { wrapper: createWrapper() });
}

beforeEach(() => {
  vi.clearAllMocks();
  patchHandler = null;
  mockedIsTauri.mockReturnValue(false);
  mockedGetAvail.mockResolvedValue({ available: true });
  mockedProbe.mockResolvedValue({ available: false, confidence: 'high', error: null });
  mockedExportBytes.mockResolvedValue({ path: 'C:/exports/cikti.xlsx', mode: 'save-dialog' });
  mockedIsDiscarded.mockReturnValue(false);
  apiRequestMock.mockImplementation(routeApiRequest);
});

function findPatchCall(): { path: string; body: unknown } {
  const call = apiRequestMock.mock.calls.find(
    ([path, options]) => options?.method === 'PATCH' && String(path).includes('/cells'),
  );
  expect(call).toBeDefined();
  const [path, options] = call as [string, ApiRequestOptions];
  return { path, body: JSON.parse(options.body ?? '{}') };
}

// ---------------------------------------------------------------------------
// Kayıt durum makinesi
// ---------------------------------------------------------------------------

describe('useEmbeddedWorkbookState saveState makinesi', () => {
  it('idle başlar, hücre değişimini overlay ile gösterir ve 1.2 sn sonra PATCH gönderir', async () => {
    // PATCH isteği bekletilir: 'saving' durumu gözlemlenebilir kalsın.
    const deferredPatch = deferred<DocumentArtifactCellsPatchOut>();
    patchHandler = () => deferredPatch.promise;

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReadOnly).toBe(false);
    expect(result.current.saveState).toBe('idle');
    expect(result.current.revision).toBe(3);

    // Gerçek xlsx parse edildi: B2 (12.5) düzenlenebilir.
    const b2 = result.current.sheets[0].rows[1][1];
    expect(b2).toMatchObject({ cellRef: 'B2', value: '12.5', editable: true });

    act(() => {
      result.current.onCellChange('Envanter', 'B2', '20');
    });
    expect(result.current.dirtyCount).toBe(1);
    expect(result.current.saveState).toBe('idle');
    // Overlay anında uygulanır.
    expect(result.current.sheets[0].rows[1][1]?.value).toBe('20');

    // Debounce (1_200 ms) tetiklenene kadar bekle.
    await act(async () => {
      await sleep(1_400);
    });

    expect(result.current.saveState).toBe('saving');
    const { path, body } = findPatchCall();
    expect(path).toBe('/api/v2/document-artifacts/depolama/live/cells');
    expect(body).toEqual({
      base_revision: 3,
      source: 'embedded',
      changes: [{ sheet: 'Envanter', cell_ref: 'B2', value: '20' }],
    });

    // Askıda kalan isteği kapat (saved akışı ayrı testte).
    await act(async () => {
      deferredPatch.resolve({ ...appliedPatch });
    });
    await waitFor(() => expect(result.current.saveState).toBe('saved'));
  });

  it('başarılı PATCH sonrası saved durumuna geçer ve taslakları temizler', async () => {
    patchHandler = () => Promise.resolve({ ...appliedPatch });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    act(() => {
      result.current.onCellChange('Envanter', 'B2', '20');
    });
    await act(async () => {
      await sleep(1_400);
    });

    await waitFor(() => expect(result.current.saveState).toBe('saved'));
    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.cellErrors).toEqual({});
  });

  it('reddedilen PATCH hücre hatalarını yazar ve error durumuna geçer', async () => {
    patchHandler = () =>
      Promise.resolve({
        revision: 3,
        status: 'rejected',
        applied_changes: [],
        warnings: [],
        cell_errors: [{ sheet: 'Envanter', cell_ref: 'B2', message: 'Hatalı adet' }],
      });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    act(() => {
      result.current.onCellChange('Envanter', 'B2', '-5');
    });
    await act(async () => {
      await sleep(1_400);
    });

    await waitFor(() => expect(result.current.saveState).toBe('error'));
    expect(result.current.cellErrors['Envanter:B2']).toEqual({ message: 'Hatalı adet' });
    expect(result.current.revision).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Çakışma ve yeniden yükleme
// ---------------------------------------------------------------------------

describe('useEmbeddedWorkbookState conflict ve reload', () => {
  it('409 çakışmasında conflict durumuna geçer ve onReload ile idle döner', async () => {
    patchHandler = () => Promise.reject(new ApiError(409, 'revision conflict'));

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    act(() => {
      result.current.onCellChange('Envanter', 'B2', '30');
    });
    await act(async () => {
      await sleep(1_400);
    });
    await waitFor(() => expect(result.current.saveState).toBe('conflict'));
    // Kullanıcı değeri korunur: sessiz veri kaybı yok.
    expect(result.current.dirtyCount).toBe(1);

    await act(async () => {
      await result.current.onReload();
    });
    expect(result.current.saveState).toBe('idle');
    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.cellErrors).toEqual({});
  });

  it('sunucu hatasında error durumuna geçer', async () => {
    patchHandler = () => Promise.reject(new ApiError(500, 'sunucu hatası'));

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    act(() => {
      result.current.onCellChange('Envanter', 'C2', '5');
    });
    await act(async () => {
      await sleep(1_400);
    });
    await waitFor(() => expect(result.current.saveState).toBe('error'));
  });
});

// ---------------------------------------------------------------------------
// Salt okunur ve Excel kullanılabilirliği
// ---------------------------------------------------------------------------

describe('useEmbeddedWorkbookState readonly ve Excel tespiti', () => {
  it('readonly anahtarında hücre düzenlemesini yok sayar ve PATCH göndermez', async () => {
    const { result } = renderWorkbookHook('depolama', 'arsiv');
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isReadOnly).toBe(true);
    act(() => {
      result.current.onCellChange('Envanter', 'B2', '20');
    });
    expect(result.current.dirtyCount).toBe(0);

    await act(async () => {
      await sleep(1_400);
    });
    const patchCalls = apiRequestMock.mock.calls.filter(([, options]) => options?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);
    // Tauri dışı ortamda Excel durumu belirsiz kalır.
    expect(result.current.excelAvailable).toBeNull();
  });

  it('Tauri çalışma zamanında kayıt defteri Excel varsa true döner', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedGetAvail.mockResolvedValue({ available: true });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.excelAvailable).toBe(true));
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it('kayıt defteri olumsuzsa COM probe sonucuna göre karar verir', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedGetAvail.mockResolvedValue({ available: false, reason: 'registry miss' });
    mockedProbe.mockResolvedValue({ available: false, confidence: 'high', error: null });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.excelAvailable).toBe(false));
  });

  it('IPC hatasında Excel yok gibi kilitlemez ve durumu belirsiz bırakır', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedGetAvail.mockResolvedValue({ available: false, ipc_error: true });
    mockedProbe.mockResolvedValue({ available: false, confidence: 'ipc-error', error: 'ipc kapali' });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.excelAvailable).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

describe('useEmbeddedWorkbookState onExport', () => {
  it('Tauri ortamında baytları base64 ile exportDocumentBytes a verir', async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedExportBytes.mockResolvedValue({ path: 'C:/exports/depolama-envanter.xlsm', mode: 'save-dialog' });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    await act(async () => {
      await result.current.onExport();
    });

    expect(mockedExportBytes).toHaveBeenCalledTimes(1);
    const [fileName, base64] = mockedExportBytes.mock.calls[0];
    expect(fileName).toBe('depolama-envanter.xlsm');

    const bytes = new Uint8Array(await workbookBlob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    expect(base64).toBe(btoa(binary));
    expect(result.current.excelMessage).toBe('C:/exports/depolama-envanter.xlsm');
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('tarayıcıda authed indirme yolunu kullanır', async () => {
    mockedIsTauri.mockReturnValue(false);

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    await act(async () => {
      await result.current.onExport();
    });

    expect(mockedDownload).toHaveBeenCalledWith(
      '/api/v2/document-artifacts/depolama/live/download',
      'depolama-envanter.xlsm',
    );
    expect(mockedExportBytes).not.toHaveBeenCalled();
  });

  it('dışa aktarma hatası sessiz yutulmaz: hata mesajı yüzeye taşınır', async () => {
    // download_path hem grid hem export tarafından kullanılır; ilk indirme
    // (grid yüklemesi) başarılı, export indirmesi başarısız olur.
    let downloadCalls = 0;
    apiRequestMock.mockImplementation((path: unknown, options?: ApiRequestOptions) => {
      const target = String(path);
      if (target.startsWith('/api/v2/excel-preview/')) return previewPayload;
      if (options?.method === 'PATCH') return appliedPatch;
      downloadCalls += 1;
      if (downloadCalls === 1) return workbookBlob;
      return Promise.reject(new Error('indirme başarısız'));
    });

    const { result } = renderWorkbookHook();
    await waitFor(() => expect(result.current.sheets.length).toBe(1));

    await act(async () => {
      await result.current.onExport();
    });

    expect(result.current.excelMessage).toContain('indirme başarısız');
    expect(mockedExportBytes).not.toHaveBeenCalled();
    expect(mockedDownload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onOpenExcel — Excel köprüsü akışı (tüm "Excel'de aç" yüzeylerinin ortak yolu)
// ---------------------------------------------------------------------------

const excelSessionPayload = {
  session_id: 'sess-1',
  bearer_token: 'tok-1',
  status: 'active',
  can_write: true,
  revision: 3,
  file_name: 'afg.xlsm',
  working_file_name: 'afg.xlsm',
  message: null,
};

function excelRequestSession(): void {
  apiRequestMock.mockImplementation((path: unknown, options?: ApiRequestOptions) => {
    const target = String(path);
    if (target.startsWith('/api/v2/excel-preview/')) return previewPayload;
    if (target.endsWith('/excel-sessions') && options?.method === 'POST') return excelSessionPayload;
    if (options?.method === 'PATCH') return appliedPatch;
    return workbookBlob;
  });
}

function findReleaseDeleteCall(): { path: string; headers: Record<string, string> } | null {
  const call = vi.mocked(globalThis.fetch).mock.calls.find(
    ([input, init]) =>
      String(input).includes('/api/v2/excel-sessions/')
      && (init as RequestInit | undefined)?.method === 'DELETE',
  );
  if (!call) return null;
  const headers = ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
  return { path: String(call[0]), headers };
}

describe('useEmbeddedWorkbookState onOpenExcel — Excel köprüsü akışı', () => {
  beforeEach(() => {
    mockedIsTauri.mockReturnValue(true);
    mockedGetAvail.mockResolvedValue({ available: true });
    mockedStartupState.mockResolvedValue({
      state: 'ready',
      message: 'ok',
      excel_bridge_running: true,
    });
    mockedLaunch.mockResolvedValue({ running: true, pid: 4242, message: 'Excel bridge başlatıldı' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ revision: 3, message: null }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it('mutlu yol: köprü oturum verisiyle başlatılır ve yönetim kilidi açılır', async () => {
    excelRequestSession();
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });

    expect(result.current.managedExcelOpen).toBe(true);
    expect(result.current.excelMessage).toBe(t('workbook.excelEditing'));
    expect(mockedLaunch).toHaveBeenCalledTimes(1);
    expect(mockedLaunch).toHaveBeenCalledWith({
      workbook_path: 'sess-1/afg.xlsm',
      sync_url: 'http://127.0.0.1:8000/api/v2/excel-sessions/sess-1/sync',
      close_url: 'http://127.0.0.1:8000/api/v2/excel-sessions/sess-1',
      session_token: 'tok-1',
      base_revision: 3,
      can_write: true,
    });
    // Başarılı açılış tanı gürültüsü üretmez.
    expect(mockedWriteDiagnostic).not.toHaveBeenCalled();
  });

  it('Masaüstü uygulaması değilse oturum açmadan bilgilendirir', async () => {
    mockedIsTauri.mockReturnValue(false);
    excelRequestSession();
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });

    expect(result.current.excelMessage).toBe(t('workbook.excelUnavailable'));
    expect(mockedLaunch).not.toHaveBeenCalled();
    expect(
      apiRequestMock.mock.calls.some(([path, options]) => String(path).endsWith('/excel-sessions') && options?.method === 'POST'),
    ).toBe(false);
    expect(mockedWriteDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'excel-open:tauri-missing' }),
    );
  });

  it('409 çakışmasında kurtarma bandını açar ve köprüyü hiç başlatmaz', async () => {
    apiRequestMock.mockImplementation((path: unknown, options?: ApiRequestOptions) => {
      const target = String(path);
      if (target.startsWith('/api/v2/excel-preview/')) return previewPayload;
      if (target.endsWith('/excel-sessions') && options?.method === 'POST') {
        throw new ApiError(409, 'Başka bir Excel belgesi düzenleniyor.');
      }
      if (options?.method === 'PATCH') return appliedPatch;
      return workbookBlob;
    });
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });

    expect(result.current.excelConflict).toBe(true);
    expect(result.current.managedExcelOpen).toBe(false);
    expect(mockedLaunch).not.toHaveBeenCalled();
    // Oturum rezerve edilemedi: serbest bırakma DELETE'i yapılmaz.
    expect(findReleaseDeleteCall()).toBeNull();
    expect(mockedWriteDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'excel-open:conflict' }),
    );
  });

  it('köprü running:false dönerse oturum DELETE ile serbest kalır ve hata görünür olur', async () => {
    excelRequestSession();
    mockedLaunch.mockResolvedValue({ running: false, pid: null, message: 'Excel bulunamadı' });
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });

    expect(result.current.managedExcelOpen).toBe(false);
    expect(result.current.excelMessage).toContain('Excel bulunamadı');
    const release = findReleaseDeleteCall();
    expect(release).not.toBeNull();
    expect(release?.path).toContain('/api/v2/excel-sessions/sess-1');
    expect(release?.headers.Authorization).toBe('Bearer tok-1');
    expect(mockedWriteDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'excel-open:bridge-failed' }),
    );
  });

  it('köprü IPC hatası verirse neden kullanıcıya taşınır ve oturum serbest kalır', async () => {
    excelRequestSession();
    mockedLaunch.mockRejectedValue(new Error('Tauri runtime bulunamadı'));
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });

    expect(result.current.managedExcelOpen).toBe(false);
    expect(result.current.excelMessage).toContain('Tauri runtime bulunamadı');
    expect(findReleaseDeleteCall()).not.toBeNull();
    expect(mockedWriteDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'excel-open:bridge-failed' }),
    );
  });

  it('çalışma kopyası hatası aşama koduyla tanıya yazılır', async () => {
    apiRequestMock.mockImplementation((path: unknown, options?: ApiRequestOptions) => {
      const target = String(path);
      if (target.startsWith('/api/v2/excel-preview/')) return previewPayload;
      if (target.endsWith('/excel-sessions') && options?.method === 'POST') {
        throw new ApiError(500, 'sunucu hatası');
      }
      if (options?.method === 'PATCH') return appliedPatch;
      return workbookBlob;
    });
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });

    expect(result.current.excelMessage).toContain('sunucu hatası');
    expect(mockedLaunch).not.toHaveBeenCalled();
    expect(findReleaseDeleteCall()).toBeNull();
    expect(mockedWriteDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'excel-open:working-copy:500' }),
    );
  });

  it('köprü açıldıktan sonra ölürse yoklama oturumu serbest bırakır (kendini onarma)', async () => {
    excelRequestSession();
    const { result } = renderWorkbookHook('alis-workspace', '1');
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    await act(async () => {
      await result.current.onOpenExcel();
    });
    expect(result.current.managedExcelOpen).toBe(true);

    // Rust açılış penceresinden sonra köprü öldü: native durum köprüyü görmüyor.
    mockedStartupState.mockResolvedValue({
      state: 'ready',
      message: 'ok',
      excel_bridge_running: false,
      excel_close_failed: true,
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ revision: 3, message: null }), { status: 200 }),
    );

    await act(async () => {
      await sleep(1_700);
    });

    expect(result.current.managedExcelOpen).toBe(false);
    expect(result.current.excelMessage).toBe(t('workbook.excelBridgeDied'));
    const release = findReleaseDeleteCall();
    expect(release).not.toBeNull();
    expect(release?.path).toContain('/api/v2/excel-sessions/sess-1');
  });
});
