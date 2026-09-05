import { describe, expect, it } from 'vitest';

import { createAlisTransitionBlocker, createLogTransitionBlocker, createOfficeTransitionBlocker } from '@/modern/adapters';
import { buildLogStats, buildSelectedDocumentModel, createModernLogViewModel, pureSuffixLabel, pureUnitLabel } from '@/modern/adapters/log';
import type { AlisPageProps } from '@/make/alis/AlisPage';
import type { LogPageProps } from '@/make/log/LogPage';
import type { OfficeDocumentPageProps } from '@/make/office/OfficeDocumentPage';
import { buildLogBucket, buildLogDocument, buildLogLine, buildLogState as buildLogStateFixture, buildLogWorkspace } from './logFixtures';

function buildAlisState(partial: Partial<AlisPageProps>): AlisPageProps {
  return {
    pdfState: { url: null, filename: '', loading: false, error: null },
    onClosePdfModal: () => undefined,
    detailPurchase: null,
    detail: null,
    detailLoading: false,
    onCloseDetail: () => undefined,
    onEditDetail: () => undefined,
    onDeleteDetail: () => undefined,
    onExportDetail: () => undefined,
    onPrintDetail: () => undefined,
    onOpenDetailExcelPreview: () => undefined,
    detailActionPending: false,
    detailError: null,
    onRetryDetail: () => undefined,
    workspace: {
      session: { id: 'w1', session_code: 'S-1', display_token: 'd', trade_side: 'buy_from_customer', rate_source: 'live', margin_percent_internal: '0', status: 'draft', created_at: '', updated_at: '' },
      customer: { name: 'Ada' },
      bank_info: {},
      payment_method: 'bank',
      market_rates: { eur_dkk_fx: '', gold_rates_dkk: {}, silver_rates_dkk: {}, gold_24k_dkk: '', silver_dkk: '', gold_matrix: [], silver_matrix: [] },
      calculators: { gold_rows: [], silver_rows: [] },
      numbering_preview: { product_number_next: '', reference_number_next: '', afregnings_number_next: '', invoice_number_next: '' },
      invoice_gold_mode: 'auto',
      gold_rows: [],
      silver_rows: [],
      invoice_gold: { rows: [], footer_lines: [], total_grams: '0', total_amount_dkk: '0' },
      invoice_misc_mode: 'auto',
      invoice_misc: { rows: [], total_amount_dkk: '0' },
      quick_mode_editable: true,
      purchase_vat_enabled: true,
      purchase_vat_rate_percent: '25',
      summary: { active_line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', gold_weight_grams: '0', silver_weight_grams: '0', total_amount_dkk: '0', net_amount_dkk: '0', vat_rate_percent: '25', vat_amount_dkk: '0', gross_amount_dkk: '0' },
    },
    draftWorkspace: null,
    onResumeDraft: () => undefined,
    documents: [],
    purchaseSearchTerm: '',
    setPurchaseSearchTerm: () => undefined,
    purchaseDate: '',
    setPurchaseDate: () => undefined,
    onOpenCustomer: () => undefined,
    onViewDocument: () => undefined,
    onOpenDocumentExcelPreview: () => undefined,
    onExportDocument: () => undefined,
    onPrintDocument: () => undefined,
    onStartFromCustomer: () => undefined,
    onEditDocument: () => undefined,
    onDeleteDocument: () => undefined,
    onRetryUnicontaSync: () => undefined,
    retryPendingSequenceNo: null,
    onCancelUnicontaInvoice: () => undefined,
    cancelPendingSequenceNo: null,
    listLoading: false,
    listError: null,
    onRetryDocuments: () => undefined,
    actionPendingSequenceNo: null,
    customerMode: null,
    setCustomerMode: () => undefined,
    customerSearchTerm: '',
    setCustomerSearchTerm: () => undefined,
    candidateCustomers: [],
    newCustomer: { name: '', email: '', phone: '', address: '', postal_code: '', city: '', cpr_number: '', identity_doc_type: '', identity_doc_number: '', identity_doc_country: '' },
    setNewCustomer: () => undefined,
    onSelectExistingCustomer: () => undefined,
    onCreateNewCustomer: () => undefined,
    onDetachCustomer: () => undefined,
    detachCustomerPending: false,
    customerForm: { name: '', email: '', phone: '', address: '', postal_code: '', city: '', cpr_number: '', identity_doc_type: '', identity_doc_number: '', identity_doc_country: '' },
    setCustomerForm: () => undefined,
    onCustomerBlur: () => undefined,
    goldRows: [],
    silverRows: [],
    barRows: [],
    ptpdRows: [],
    extraRows: [],
    onUpdatePtPdRow: () => {},
    onUpdateBarRow: () => undefined,
    onUpdateExtraRow: () => undefined,
    onDeleteExtraRow: () => undefined,
    onAddExtraRows: () => undefined,
    onApplyGoldCalculatorTarget: () => undefined,
    onUpdateGoldRow: () => undefined,
    onUpdateSilverRow: () => undefined,
    activeWorkspaceView: 'system',
    setActiveWorkspaceView: () => undefined,
    numbering: { afregnings_number_next: '', invoice_number_next: '' },
    setNumbering: () => undefined,
    onUpdateNumbering: () => undefined,
    invoiceGoldMode: 'auto',
    invoiceGoldRows: [],
    invoiceGoldFooterLines: [],
    onUpdateInvoiceGoldRow: () => undefined,
    onUpdateInvoiceGoldFooterLine: () => undefined,
    onResetInvoiceGoldToAuto: () => undefined,
    invoiceMiscMode: 'auto',
    invoiceMiscRows: [],
    onUpdateInvoiceMiscRow: () => undefined,
    onResetInvoiceMiscToAuto: () => undefined,
    bankInfo: {},
    setBankInfo: () => undefined,
    marketRates: { eur_dkk_fx: '', gold_rates_dkk: {}, silver_rates_dkk: {}, gold_24k_dkk: '', silver_dkk: '', gold_matrix: [], silver_matrix: [] },
    setMarketRates: () => undefined,
    afgNote: '',
    setAfgNote: () => undefined,
    purchaseVatEnabled: true,
    setPurchaseVatEnabled: () => undefined,
    calculators: { gold_rows: [], silver_rows: [] },
    setCalculators: () => undefined,
    paymentMethod: 'bank',
    setPaymentMethod: () => undefined,
    onPrintWorkspace: () => undefined,
    onOpenWorkspaceExcelPreview: () => undefined,
    onCancelWorkspace: () => undefined,
    onFinalizeWorkspace: () => undefined,
    customerPending: false,
    customerSelecting: false,
    finalizePending: false,
    cancelPending: false,
    onStartBlankWorkspace: () => undefined,
    startPending: false,
    priceOpen: false,
    setPriceOpen: () => undefined,
    ...partial,
  };
}

function buildLogState(partial: Partial<LogPageProps>): LogPageProps {
  return buildLogStateFixture(partial);
}

function buildOfficeState(partial: Partial<OfficeDocumentPageProps>): OfficeDocumentPageProps {
  return {
    kind: 'alis-workspace',
    artifactKey: 'w1',
    launch: null,
    status: null,
    runtimeStatus: null,
    appRuntimeStatus: null,
    desktopRuntime: null,
    frontendRuntime: { frontend_mode: 'vite-dev', frontend_built_at: '2026-08-06T00:00:00Z', api_base_url: 'http://127.0.0.1:8100' },
    runtimeWarnings: [],
    iframeName: 'office',
    formRef: { current: null },
    useNativeImportDialog: false,
    isLoading: false,
    isError: false,
    isImporting: false,
    isStatusRefreshing: false,
    isSessionRefreshing: false,
    isIframeLoading: false,
    hasIframeLoadTimedOut: false,
    launchRequestMs: null,
    iframeLoadMs: null,
    sessionRefreshMs: null,
    isSessionStale: false,
    canReopenWindow: false,
    hasExternalUpdate: false,
    lastImportError: null,
    lastExportNotice: null,
    lastExportError: null,
    lastEditorError: null,
    onExport: () => undefined,
    onImportFromDialog: () => undefined,
    onImportFile: () => undefined,
    onRefreshStatus: () => undefined,
    onRefreshSession: () => undefined,
    onReopenWindow: () => undefined,
    onIframeLoad: () => undefined,
    onEditorError: () => undefined,
    ...partial,
  };
}

describe('modern transition blockers', () => {
  it('builds alis blocker reasons from pending operations', () => {
    const blocker = createAlisTransitionBlocker(buildAlisState({ customerPending: true, finalizePending: true }), { hasPendingAutosave: true });
    expect(blocker?.when).toBe(true);
    expect(blocker?.reasons).toContain('Otomatik kaydetme kuyruğu henüz tamamlanmadı');
    expect(blocker?.reasons).toContain('Müşteri kartı güncelleniyor');
    expect(blocker?.severity).toBe('danger');
  });

  it('builds log blocker when route review is pending', () => {
    const blocker = createLogTransitionBlocker(buildLogState({ pendingRouteCount: 3, pendingRouteSummary: { count: 3, weight: 10, amount: 20, pure: 5 } }));
    expect(blocker?.when).toBe(true);
    expect(blocker?.reasons[0]).toContain('3 rota taslağı');
  });

  it('builds office blocker for dirty sync conflict', () => {
    const blocker = createOfficeTransitionBlocker(buildOfficeState({ isLivePreviewDirty: true, isLivePreviewSyncing: true, hasExternalUpdate: true }), { isDirty: true });
    expect(blocker?.when).toBe(true);
    expect(blocker?.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe('modern log view model', () => {
  const inventoryLine = buildLogLine({ id: 'line-inventory', line_no: 1, operation_classification: 'jewelry_cleaning', operation_destination: 'inventory' });
  const whiteGoldLine = buildLogLine({ id: 'line-white', line_no: 2, weight_grams: '4', pure_gold_grams: '2.4', line_total_dkk: '1600', metal_type: 'white_gold', operation_destination: null });
  const meltLine = buildLogLine({ id: 'line-melt', line_no: 3, weight_grams: '3', pure_gold_grams: '1.8', line_total_dkk: '1200', operation_destination: 'melt', product_status: 'melted' });
  const document = buildLogDocument({
    lines: [inventoryLine, whiteGoldLine, meltLine],
    line_count: 3,
    total_weight_grams: '17',
    total_pure_gold_grams: '10.05',
  });

  it('derives pending lines, split groups and remaining pure from staging drafts', () => {
    const selected = buildSelectedDocumentModel(document, {
      'line-white': { classification: 'white_gold', note: '', destination: 'inventory' },
    });
    expect(selected).not.toBeNull();
    // melt rotalı satır hiçbir ayrım grubuna düşmez → bekleyen kalır
    expect(selected?.pending.map((line) => line.id)).toEqual(['line-melt']);
    expect(selected?.groups.white_gold.map((line) => line.id)).toEqual(['line-white']);
    expect(selected?.groups.jewelry_cleaning.map((line) => line.id)).toEqual(['line-inventory']);
    expect(selected?.groupedCount).toBe(2);
    expect(selected?.routedWeight).toBeCloseTo(14, 5);
    expect(selected?.routedAmount).toBeCloseTo(5600, 5);
    expect(selected?.routedPure).toBeCloseTo(8.25, 5);
    expect(selected?.remainingPure).toBeCloseTo(1.8, 5);
  });

  it('clamps remaining pure at zero when staging routes more than the document total', () => {
    const smallDocument = buildLogDocument({
      sequence_no: 9,
      lines: [inventoryLine, whiteGoldLine, meltLine],
      total_pure_gold_grams: '6',
    });
    const selected = buildSelectedDocumentModel(smallDocument, {
      'line-inventory': { classification: 'separate_storage', note: '', destination: 'inventory' },
      'line-white': { classification: 'white_gold', note: '', destination: 'inventory' },
    });
    expect(selected?.routedPure).toBeGreaterThan(6);
    expect(selected?.remainingPure).toBe(0);
  });

  it('returns null for a missing document', () => {
    expect(buildSelectedDocumentModel(null, {})).toBeNull();
  });

  it('builds classic-parity KPI set from split_groups and melt_queue', () => {
    const bucket = buildLogBucket({
      summary: {
        total_documents: 2,
        total_lines: 3,
        awaiting_lines: 1,
        routed_lines: 2,
        split_line_count: 2,
        melt_line_count: 1,
        melt_lot_count: 1,
        total_weight_grams: '17',
        total_pure_gold_grams: '10.05',
        total_amount_dkk: '6800',
      },
      split_groups: [
        { key: 'jewelry_cleaning', label: 'Smykker Lager', line_count: 1, total_weight_grams: '6', total_pure_gold_grams: '3.5', total_amount_dkk: '2400', document_numbers: ['AFG-1'] },
        { key: 'white_gold', label: 'Hvidguld', line_count: 1, total_weight_grams: '4', total_pure_gold_grams: '2.4', total_amount_dkk: '1600', document_numbers: ['AFG-1'] },
        { key: 'separate_storage', label: 'Spandlager', line_count: 0, total_weight_grams: '0', total_pure_gold_grams: '0', total_amount_dkk: '0', document_numbers: [] },
      ],
      melt_queue: {
        line_count: 1,
        total_weight_grams: '3',
        total_pure_gold_grams: '1.8',
        total_amount_dkk: '1200',
        earliest_purchase_date: null,
        latest_purchase_date: null,
        document_numbers: ['AFG-1'],
      },
      melt_lots: [],
    });

    const stats = buildLogStats(bucket, ' g has');
    expect(stats.map((stat) => stat.label)).toEqual(['Toplam Alış Havuzu', 'Toplam Ayrılan', 'Eritmeye Giden (net)', 'Eritme Lotları']);
    expect(stats[1].value).toBe('10,00 g');
    expect(stats[1].hint).toContain('Takı + Beyaz Altın + Depo');
    expect(stats[2].value).toBe('3,00 g');
    expect(stats[2].hint).toContain('1 satır');
    expect(stats[3].value).toBe('0 lot');
  });

  it('exposes pure unit, bucket model and selected document on the view model', () => {
    const viewModel = createModernLogViewModel(
      buildLogState({
        workspace: buildLogWorkspace({ gold: { documents: [document] } }),
        activeTab: 'gold',
        expandedDocument: 1,
      }),
    );
    expect(viewModel.bucket).not.toBeNull();
    expect(viewModel.pureUnit).toBe('has');
    expect(pureUnitLabel('silver')).toBe('saf');
    expect(pureSuffixLabel('silver')).toBe(' g saf');
    expect(viewModel.selectedDocument?.document.sequence_no).toBe(1);
    expect(viewModel.bucketModel?.counts.jewelry_cleaning).toBe(1);
    expect(viewModel.bucketModel?.totals.white_gold.pure).toBe(0);
    expect(viewModel.phase).toBe('ready');
  });
});
