// Log modern yüzey testleri için ortak fixture kurucular (Classic + Modern aynı
// useLogMakeState sözleşmesini kullanır).
import type { LogPageProps } from '@/make/log/LogPage';
import type { AfgWorkspaceDocument, AfgWorkspaceLine, LogBucketWorkspace, LogWorkspace } from '@/types';

export function buildLogLine(partial: Partial<AfgWorkspaceLine> & Pick<AfgWorkspaceLine, 'id' | 'line_no'>): AfgWorkspaceLine {
  return {
    transaction_id: 't-1',
    document_sequence_no: 1,
    document_number: 'AFG-1',
    session_id: 'session-1',
    session_code: 'S-1',
    customer_name: 'Ada Yılmaz',
    issued_at: '2026-08-01T10:00:00Z',
    product_number: 'VARE-1',
    reference_number: null,
    product_type: 'bracelet',
    metal_type: 'yellow_gold',
    weight_grams: '10',
    purity_karat: '14K',
    purity_percentage: '58.5',
    pure_gold_grams: '5.85',
    rate_dkk: '400',
    margin_percent: '2',
    line_total_dkk: '4000',
    product_status: 'in_inventory',
    operation_destination: null,
    operation_classification: null,
    is_gdpr_locked: false,
    product_notes: '',
    created_at: '2026-08-01T10:00:00Z',
    ...partial,
  };
}

export function buildLogDocument(partial: Partial<AfgWorkspaceDocument> = {}): AfgWorkspaceDocument {
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

export function buildLogBucket(partial: Partial<LogBucketWorkspace> = {}): LogBucketWorkspace {
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

export function buildLogWorkspace(partial: { gold?: Partial<LogBucketWorkspace>; silver?: Partial<LogBucketWorkspace> } = {}): LogWorkspace {
  return {
    summary: {
      total_documents: 1,
      awaiting_documents: 1,
      inventory_documents: 0,
      undecided_documents: 0,
      melted_documents: 0,
      total_amount_dkk: '4000',
      total_pure_gold_grams: '5.85',
    },
    gold: buildLogBucket(partial.gold),
    silver: buildLogBucket({ metal_bucket: 'silver', ...partial.silver }),
  };
}

export function buildLogState(partial: Partial<LogPageProps>): LogPageProps {
  return {
    workspace: buildLogWorkspace(),
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
    ...partial,
  };
}
