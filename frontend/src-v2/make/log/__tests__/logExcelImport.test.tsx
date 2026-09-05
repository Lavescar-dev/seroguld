// A15 — /excel-preview akışının log ekranına bağlanması:
// 1) LogPage workspace header'ında "Excel'den İçe Aktar" butonu görünür,
// 2) excelImportPath varken tıklama /excel-preview/{kind}/{key} rotasına götürür,
// 3) seçili AFG kaydı yokken buton disable'dır ve tooltip gösterir,
// 4) useLogMakeState excelImportPath'i aktif key'e (seçili belge session_id) bağlar.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AfgWorkspaceDocument,
  LogBucketWorkspace,
  LogWorkspace,
} from '@/types';

import { LogPage, type LogPageProps } from '../LogPage';
import { useLogMakeState } from '../useLogMakeState';

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

vi.mock('@/components/ConfirmDialog', () => ({
  useConfirm: () => (async () => true),
}));

vi.mock('@/lib/artifactSync', () => ({
  emitArtifactSync: vi.fn(),
  listenArtifactSync: vi.fn(() => () => undefined),
  signalMatches: vi.fn(() => false),
}));

const IMPORT_BUTTON_NAME = /excel'den İçe Aktar/i;
const DISABLED_TOOLTIP = 'İçe aktarmak için önce bir AFG kaydı seçin';

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
    activeView: 'system',
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

function LocationProbe({ probeId }: { probeId: string }) {
  const location = useLocation();
  return <div data-testid={probeId}>{location.pathname}</div>;
}

function renderLogPage(props: LogPageProps) {
  return render(
    <MemoryRouter initialEntries={['/log']}>
      <Routes>
        <Route path="/log" element={<LogPage {...props} />} />
        <Route path="/excel-preview/:kind/:key" element={<LocationProbe probeId="excel-preview-probe" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function getImportButton() {
  return screen.getByRole('button', { name: IMPORT_BUTTON_NAME });
}

describe('LogPage — Excel içe aktar butonu (A15)', () => {
  it('workspace headerında butonu render eder ve excelImportPath varken aktiftir', () => {
    renderLogPage(buildProps({ excelImportPath: '/excel-preview/alis-workspace/session-1' }));

    const button = getImportButton();
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('içe aktar'));
    expect(button).not.toHaveAttribute('title', DISABLED_TOOLTIP);
  });

  it('butona tıklama /excel-preview/alis-workspace/{session} rotasına götürür', () => {
    renderLogPage(buildProps({ excelImportPath: '/excel-preview/alis-workspace/session-1' }));

    fireEvent.click(getImportButton());

    expect(screen.getByTestId('excel-preview-probe')).toHaveTextContent(
      '/excel-preview/alis-workspace/session-1',
    );
  });

  it('excelImportPath yokken (seçili AFG kaydı yok) buton disable ve tooltip\'lidir, tıklama rota değiştirmez', () => {
    renderLogPage(buildProps({ excelImportPath: null }));

    const button = getImportButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', DISABLED_TOOLTIP);

    fireEvent.click(button);
    expect(screen.queryByTestId('excel-preview-probe')).toBeNull();
    // Hâlâ log ekranındayız: buton yerinde, /excel-preview rotasına geçilmedi.
    expect(getImportButton()).toBeInTheDocument();
  });
});

describe('useLogMakeState — excelImportPath aktif key bağlaması (A15)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  function renderLogState() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/log']}>
          <Routes>
            <Route path="*" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return renderHook(() => useLogMakeState(), { wrapper: Wrapper });
  }

  function mockWorkspace(documents: AfgWorkspaceDocument[]) {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.startsWith('/api/v2/log/workspace')) {
        return Promise.resolve(buildWorkspace(documents));
      }
      return Promise.resolve({});
    });
  }

  it('workspace yüklenince otomatik seçilen ilk belgenin session_id ile /excel-preview rotası kurar', async () => {
    mockWorkspace([
      buildDocument({ sequence_no: 1, session_id: 'session-1' }),
      buildDocument({ sequence_no: 2, session_id: 'session-2' }),
    ]);
    const state = renderLogState();

    await waitFor(() =>
      expect(state.result.current.excelImportPath).toBe('/excel-preview/alis-workspace/session-1'),
    );
    expect(state.result.current.expandedDocument).toBe(1);
  });

  it('başka AFG kaydı seçilince rota aktif key\'i günceller', async () => {
    mockWorkspace([
      buildDocument({ sequence_no: 1, session_id: 'session-1' }),
      buildDocument({ sequence_no: 2, session_id: 'session-2' }),
    ]);
    const state = renderLogState();
    await waitFor(() =>
      expect(state.result.current.excelImportPath).toBe('/excel-preview/alis-workspace/session-1'),
    );

    state.result.current.onToggleDocument(2);

    await waitFor(() =>
      expect(state.result.current.excelImportPath).toBe('/excel-preview/alis-workspace/session-2'),
    );
  });

  it('hiç AFG kaydı yokken excelImportPath null kalır (buton kilidi)', async () => {
    mockWorkspace([]);
    const state = renderLogState();

    await waitFor(() => expect(state.result.current.isLoading).toBe(false));
    expect(state.result.current.excelImportPath).toBeNull();
  });
});
