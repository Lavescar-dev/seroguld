// M3 — klasik Log Excel içe aktarma yüzeyi: Excel sekmesinde reconcile-preview
// + blocking_errors + apply güvenli akışı vardır (klasik temada daha önce
// hiç import girişi yoktu; backend'deki reconcile-preview ucu kullanılmıyordu).
// 1) Excel seçildiğinde ÖNCE /log/workbook/reconcile-preview çağrılır,
// 2) önizleme modalında değişiklikler listelenir, apply ikinci adımdadır,
// 3) blocking_errors varken "İçe aktar" disable'dır ve engel görünür,
// 4) onayla → /log/workbook/import uygulanır.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AfgWorkspaceDocument,
  LogBucketWorkspace,
  LogWorkspace,
} from '@/types';

import { LogPage, type LogPageProps } from '../LogPage';

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiRequest: apiRequestMock,
  downloadAuthedDocument: vi.fn(),
  fetchAuthedText: vi.fn(),
  localizeApiError: (error: unknown) => String(error),
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../embedded/EmbeddedWorkbookPanel', () => ({
  EmbeddedWorkbookPanel: () => <div data-testid="embedded-workbook-stub" />,
}));

function buildDocument(partial: Partial<AfgWorkspaceDocument> = {}): AfgWorkspaceDocument {
  return {
    sequence_no: 1,
    document_number: 'AFG-1',
    session_id: 'session-1',
    document_kind: 'afregningsbilag',
    document_title: 'AFG-1',
    status: 'confirmed',
    trade_side: 'buy_from_customer',
    customer_name: 'Ada Yılmaz',
    customer_phone: null,
    customer_email: null,
    customer_address: null,
    issued_at: '2026-08-01T10:00:00Z',
    confirmed_at: null,
    gross_amount_dkk: '4000',
    net_amount_dkk: '4000',
    total_weight_grams: '10',
    total_pure_gold_grams: '5.85',
    line_count: 1,
    operation_state: 'awaiting_decision',
    has_locked_products: false,
    lines: [],
    ...partial,
  };
}

function buildBucket(partial: Partial<LogBucketWorkspace> = {}): LogBucketWorkspace {
  return {
    metal_bucket: 'gold',
    summary: {
      total_documents: 1,
      total_lines: 1,
      awaiting_lines: 1,
      routed_lines: 0,
      split_line_count: 0,
      melt_line_count: 0,
      melt_lot_count: 0,
      total_weight_grams: '10',
      total_pure_gold_grams: '5.85',
      total_amount_dkk: '4000',
    },
    documents: [],
    split_groups: [
      { key: 'jewelry_cleaning', label: 'Smykker Lager', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
      { key: 'white_gold', label: 'Hvidguld', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
      { key: 'separate_storage', label: 'Spandlager', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
    ],
    melt_queue: {
      line_count: 0,
      total_weight_grams: '0',
      total_pure_gold_grams: '0',
      total_amount_dkk: '0',
      earliest_purchase_date: null,
      latest_purchase_date: null,
      document_numbers: [],
    },
    melt_lots: [],
    ...partial,
  };
}

function buildWorkspace(documents: AfgWorkspaceDocument[]): LogWorkspace {
  return {
    summary: {
      total_documents: documents.length,
      awaiting_documents: documents.length,
      inventory_documents: 0,
      undecided_documents: 0,
      melted_documents: 0,
      total_amount_dkk: '4000',
      total_pure_gold_grams: '5.85',
    },
    gold: buildBucket({ documents }),
    silver: buildBucket({ metal_bucket: 'silver', documents: [] }),
  };
}

function buildProps(overrides: Partial<LogPageProps> = {}): LogPageProps {
  return {
    workspace: buildWorkspace([
      buildDocument({ sequence_no: 1, session_id: 'session-1' }),
    ]),
    isLoading: false,
    isError: false,
    onRetryWorkspace: () => undefined,
    activeView: 'excel',
    onActiveViewChange: () => undefined,
    activeTab: 'gold',
    onActiveTabChange: () => undefined,
    query: '',
    onQueryChange: () => undefined,
    expandedDocument: 1,
    onToggleDocument: () => undefined,
    showMeltSection: false,
    onToggleMeltSection: () => undefined,
    lineDrafts: {},
    onDraftChange: () => undefined,
    lotDrafts: {},
    onLotDraftChange: () => undefined,
    routeBusy: false,
    meltBusy: false,
    createMeltBusy: false,
    finalizeBusy: false,
    deleteBusy: false,
    pendingRouteCount: 0,
    pendingRouteSummary: { count: 0, weight: 0, amount: 0, pure: 0 },
    onDiscardRouteReview: () => undefined,
    onApplyRouteReview: () => undefined,
    onRoute: () => undefined,
    onSaveLot: () => undefined,
    onCreateMeltLot: () => undefined,
    onFinalizeLot: () => undefined,
    onDeleteLot: () => undefined,
    onDownloadLotPdf: () => undefined,
    onOpenLotHistory: () => undefined,
    onCloseLotHistory: () => undefined,
    historyLotId: null,
    lotHistory: [],
    lotHistoryLoading: false,
    onOpenLotLines: () => undefined,
    onCloseLotLines: () => undefined,
    linesLotId: null,
    lotLines: [],
    lotLinesLoading: false,
    selectedYear: 2026,
    onSelectedYearChange: () => undefined,
    ...overrides,
  };
}

function renderLogPage(props: LogPageProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/log']}>
        <LogPage {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function selectExcelFile(name = 'Log-2026.xlsx') {
  const input = document.querySelector('input[type="file"][aria-label="Log Excel dosyası seç"]');
  if (!input) throw new Error('Log Excel file input bulunamadı');
  const file = new File(['workbook-bytes'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('LogPage — klasik Log Excel içe aktarma (M3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('Excel seçimi önce reconcile-preview çağırır ve önizleme modalında değişiklikleri listeler', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/v2/log/workbook/reconcile-preview')) {
        return Promise.resolve({
          editable: true,
          changes: [
            { sheet: 'Ruter', cell_ref: 'C5', label: 'Rota — AFG-1', old_value: 'undecided', new_value: 'inventory' },
          ],
          warnings: ['Bu işlem 1 lot kaydını değiştirebilir.'],
          blocking_errors: [],
        });
      }
      return Promise.resolve({});
    });
    renderLogPage(buildProps());

    selectExcelFile();

    await waitFor(() => expect(screen.getByText('Değişiklikleri kontrol et')).toBeInTheDocument());
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(String(apiRequestMock.mock.calls[0][0])).toContain('/api/v2/log/workbook/reconcile-preview');
    expect(String(apiRequestMock.mock.calls[0][0])).toContain('year=2026');
    expect(screen.getByText('1 kontrollü değişiklik')).toBeInTheDocument();
    // import henüz çağrılmadı
    expect(apiRequestMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/v2/log/workbook/import'), expect.anything());
  });

  it('blocking_errors varken import engellenir: "İçe aktar" disable ve engel mesajı görünür', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/v2/log/workbook/reconcile-preview')) {
        return Promise.resolve({
          editable: false,
          changes: [],
          warnings: [],
          blocking_errors: ['Log artifact conflict_state=conflict; önce yenileyin; apply yapılmadı.'],
        });
      }
      return Promise.resolve({});
    });
    renderLogPage(buildProps());

    selectExcelFile();

    await waitFor(() => expect(screen.getByText('Import engellendi')).toBeInTheDocument());
    const applyButton = screen.getByRole('button', { name: /İçe aktar/ });
    expect(applyButton).toBeDisabled();
    // import isteği hiç gitmemeli
    expect(apiRequestMock.mock.calls.every(([url]) => !String(url).includes('/log/workbook/import'))).toBe(true);
  });

  it('onizlemeden sonra "İçe aktar" tıklaması /log/workbook/import uygular', async () => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('/api/v2/log/workbook/reconcile-preview')) {
        return Promise.resolve({ editable: true, changes: [], warnings: [], blocking_errors: [] });
      }
      return Promise.resolve({});
    });
    renderLogPage(buildProps());

    selectExcelFile();
    await waitFor(() => expect(screen.getByText('Değişiklikleri kontrol et')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /İçe aktar/ }));

    await waitFor(() =>
      expect(apiRequestMock.mock.calls.some(([url]) => String(url).includes('/log/workbook/import?year=2026'))).toBe(true),
    );
  });

  it('xlsx/xlsm dışı dosya önizlemeye gitmeden reddedilir', async () => {
    renderLogPage(buildProps());

    selectExcelFile('not-an-excel.pdf');

    await waitFor(() => expect(screen.getByText(/Yalnızca .xlsx veya .xlsm/)).toBeInTheDocument());
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
