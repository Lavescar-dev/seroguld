import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileSpreadsheet,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCcw,
  Save,
  ScanLine,
  Search,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';

import {
  normalizeDesktopDisplayRoute,
  type DesktopDisplayWindowState,
} from '@/lib/desktop';
import { formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import type {
  CustomerOut,
  PosDocumentDetail,
  PosSavedPurchaseListItem,
  PosWorkspace,
  PosWorkspaceBankInfo,
  PosWorkspaceCalculators,
  PosWorkspaceMarketRates,
} from '@/types';

import { EmbeddedWorkbookPanel } from '../embedded/EmbeddedWorkbookPanel';
import {
  MarketRatesEditor,
  parseDecimalValue,
} from './marketRates';
import { CustomerAlisSummaryStrip } from './CustomerAlisSummaryStrip';
import { CustomerEditorTable, CustomerInfoTable } from './customerEditors';
import { AfregningsSheetEditor, InvoiceGoldSheetEditor, InvoiceMiscSheetEditor } from './sheetEditors';
import type {
  CompanionMode,
  EditableCustomer,
  EditableBarRow,
  EditablePtPdRow,
  EditableGoldRow,
  EditableInvoiceGoldRow,
  EditableInvoiceMiscRow,
  EditableSilverRow,
  EditableWorkspaceNumbering,
  PaymentMethod,
  WorkspaceSurfaceView,
} from './types';
import { VariableValuesSheetEditor } from './variableValues';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;
const SAVED_PURCHASE_CARD_BREAKPOINT_PX = 1400;

function formatDateOnly(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(document.documentElement.lang);
}

function formatTimeOnly(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function buildWorkspaceWorkbookName(workspace: PosWorkspace) {
  return `${workspace.numbering_preview.afregnings_number_next || workspace.session.session_code}.xlsm`;
}

function buildDocumentWorkbookName(documentNumber?: string | null) {
  return documentNumber ? `${documentNumber}.xlsm` : 'AFG Belgesi';
}

function formatAfgListNumber(sequenceNo: number) {
  return String(1000 + sequenceNo);
}

function sumPreviewWeight(rows: PosSavedPurchaseListItem['gold_preview_items']) {
  return rows.reduce((sum, row) => sum + Number(row.weight_grams || 0), 0);
}

function formatSavedPurchasePreviewLabel(item: PosSavedPurchaseListItem['gold_preview_items'][number]) {
  const purityLabel = String(item.purity_label || '').trim();
  return purityLabel || '—';
}

function UnicontaSyncBadge({
  status,
  invoiceNumber,
  error,
}: {
  status?: string | null;
  invoiceNumber?: string | null;
  error?: string | null;
}) {
  if (!status) {
    return (
      <span
        className="inline-flex items-center gap-1 bg-slate-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-700"
        title="Uniconta'ya henüz gönderilmedi"
      >
        UC: —
      </span>
    );
  }
  if (status === 'synced') {
    return (
      <span
        className="inline-flex items-center gap-1 bg-emerald-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-800"
        title={invoiceNumber ? `Uniconta fatura no: ${invoiceNumber}` : 'Uniconta sync başarılı'}
      >
        <CheckCircle2 className="h-3 w-3" />
        UC{invoiceNumber ? ` ${invoiceNumber}` : ''}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1 bg-rose-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-800"
        title={error ? `Uniconta sync hatası: ${error}` : 'Uniconta sync başarısız'}
      >
        <AlertCircle className="h-3 w-3" />
        UC HATA
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span
        className="inline-flex items-center gap-1 bg-amber-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-800"
        title={error || 'Uniconta sync atlandı'}
      >
        UC ATLANDI
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 bg-slate-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-700"
      title={`Uniconta durum: ${status}`}
    >
      UC: {status}
    </span>
  );
}

type SavedPurchaseSortKey =
  | 'sequence_no'
  | 'issued_at'
  | 'customer_name'
  | 'gross_amount'
  | 'uniconta_status';

type SavedPurchaseSortState = { key: SavedPurchaseSortKey; direction: 'asc' | 'desc' };

type SavedPurchaseListActionProps = {
  onOpenCustomer: (item: PosSavedPurchaseListItem) => void;
  onViewDocument: (item: PosSavedPurchaseListItem) => void;
  onOpenDocumentExcelPreview: (item: PosSavedPurchaseListItem) => void;
  onExportDocument: (item: PosSavedPurchaseListItem) => void;
  onPrintDocument: (item: PosSavedPurchaseListItem) => void;
  onStartFromCustomer: (item: PosSavedPurchaseListItem) => void;
  onEditDocument: (item: PosSavedPurchaseListItem) => void;
  onDeleteDocument: (item: PosSavedPurchaseListItem) => void;
  onRetryUnicontaSync: (item: PosSavedPurchaseListItem) => void;
  retryPendingSequenceNo: number | null;
  onCancelUnicontaInvoice: (item: PosSavedPurchaseListItem) => void;
  cancelPendingSequenceNo: number | null;
  actionPendingSequenceNo: number | null;
};

type SavedPurchaseListRendererProps = SavedPurchaseListActionProps & {
  documents: PosSavedPurchaseListItem[];
  listLoading: boolean;
  sortConfig?: SavedPurchaseSortState;
  onToggleSort?: (key: SavedPurchaseSortKey) => void;
};

type StartWorkspaceViewProps = SavedPurchaseListRendererProps & {
  draftWorkspace: PosWorkspace | null;
  onResumeDraft: () => void;
  purchaseSearchTerm: string;
  setPurchaseSearchTerm: Dispatch<SetStateAction<string>>;
  purchaseDate: string;
  setPurchaseDate: Dispatch<SetStateAction<string>>;
};

export type AlisPdfModalState = {
  url: string | null;
  filename: string;
  loading: boolean;
  error: string | null;
};

export type AlisPageProps = {
  pdfState: AlisPdfModalState;
  onClosePdfModal: () => void;
  detailPurchase: PosSavedPurchaseListItem | null;
  detail: PosDocumentDetail | null;
  detailLoading: boolean;
  onCloseDetail: () => void;
  onEditDetail: () => void;
  onDeleteDetail: () => void;
  onExportDetail: () => void;
  onPrintDetail: () => void;
  onOpenDetailExcelPreview: () => void;
  detailActionPending: boolean;
  detailError?: string | null;
  onRetryDetail?: () => void;
  workspace: PosWorkspace | null;
  draftWorkspace: PosWorkspace | null;
  onResumeDraft: () => void;
  documents: PosSavedPurchaseListItem[];
  purchaseSearchTerm: string;
  setPurchaseSearchTerm: Dispatch<SetStateAction<string>>;
  purchaseDate: string;
  setPurchaseDate: Dispatch<SetStateAction<string>>;
  onOpenCustomer: (item: PosSavedPurchaseListItem) => void;
  onViewDocument: (item: PosSavedPurchaseListItem) => void;
  onOpenDocumentExcelPreview: (item: PosSavedPurchaseListItem) => void;
  onExportDocument: (item: PosSavedPurchaseListItem) => void;
  onPrintDocument: (item: PosSavedPurchaseListItem) => void;
  onStartFromCustomer: (item: PosSavedPurchaseListItem) => void;
  onEditDocument: (item: PosSavedPurchaseListItem) => void;
  onDeleteDocument: (item: PosSavedPurchaseListItem) => void;
  onRetryUnicontaSync: (item: PosSavedPurchaseListItem) => void;
  retryPendingSequenceNo: number | null;
  onCancelUnicontaInvoice: (item: PosSavedPurchaseListItem) => void;
  cancelPendingSequenceNo: number | null;
  listLoading: boolean;
  listError?: string | null;
  onRetryDocuments?: () => void;
  actionPendingSequenceNo: number | null;
  customerMode: 'existing' | 'new' | null;
  setCustomerMode: Dispatch<SetStateAction<'existing' | 'new' | null>>;
  customerSearchTerm: string;
  setCustomerSearchTerm: Dispatch<SetStateAction<string>>;
  candidateCustomers: CustomerOut[];
  newCustomer: EditableCustomer;
  setNewCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onSelectExistingCustomer: (customerId: string) => void;
  onCreateNewCustomer: (event: FormEvent) => void;
  customerForm: EditableCustomer;
  setCustomerForm: Dispatch<SetStateAction<EditableCustomer>>;
  onCustomerBlur: () => void;
  goldRows: EditableGoldRow[];
  barRows: EditableBarRow[];
  ptpdRows: EditablePtPdRow[];
  silverRows: EditableSilverRow[];
  onUpdateGoldRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdateBarRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdatePtPdRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdateSilverRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  activeWorkspaceView: WorkspaceSurfaceView;
  setActiveWorkspaceView: (nextView: WorkspaceSurfaceView) => void | Promise<void>;
  numbering: EditableWorkspaceNumbering;
  setNumbering: Dispatch<SetStateAction<EditableWorkspaceNumbering>>;
  onUpdateNumbering: (field: keyof EditableWorkspaceNumbering, value: string) => void;
  invoiceGoldMode: CompanionMode;
  invoiceGoldRows: EditableInvoiceGoldRow[];
  invoiceGoldFooterLines: string[];
  onUpdateInvoiceGoldRow: (rowKey: string, field: 'code' | 'fineness' | 'gram', value: string) => void;
  onUpdateInvoiceGoldFooterLine: (index: number, value: string) => void;
  onResetInvoiceGoldToAuto: () => void;
  invoiceMiscMode: CompanionMode;
  invoiceMiscRows: EditableInvoiceMiscRow[];
  onUpdateInvoiceMiscRow: (rowKey: string, field: 'text' | 'quantity' | 'unit_price_dkk', value: string) => void;
  onResetInvoiceMiscToAuto: () => void;
  bankInfo: PosWorkspaceBankInfo;
  setBankInfo: Dispatch<SetStateAction<PosWorkspaceBankInfo>>;
  marketRates: PosWorkspaceMarketRates;
  setMarketRates: Dispatch<SetStateAction<PosWorkspaceMarketRates>>;
  afgNote: string;
  setAfgNote: Dispatch<SetStateAction<string>>;
  purchaseVatEnabled: boolean;
  setPurchaseVatEnabled: Dispatch<SetStateAction<boolean>>;
  calculators: PosWorkspaceCalculators;
  setCalculators: Dispatch<SetStateAction<PosWorkspaceCalculators>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  onPrintWorkspace: () => void;
  onOpenWorkspaceExcelPreview: () => void;
  onCancelWorkspace: () => void;
  onFinalizeWorkspace: () => void | Promise<void>;
  customerPending: boolean;
  customerSelecting: boolean;
  finalizePending: boolean;
  cancelPending: boolean;
  onStartBlankWorkspace: () => void;
  startPending: boolean;
  hasPendingWorkspaceAutosave?: () => boolean;
  hasDirtyWorkspaceChanges?: () => boolean;
  hasPendingWorkspaceSync?: () => boolean;
  flushPendingWorkspaceSync?: () => Promise<void>;
  priceOpen: boolean;
  setPriceOpen: Dispatch<SetStateAction<boolean>>;
  desktopDisplayState?: DesktopDisplayWindowState | null;
  expectedDisplayRoute?: string | null;
  routeMatches?: boolean;
  onOpenCustomerDisplay?: () => void | Promise<void>;
  onCloseCustomerDisplay?: () => void | Promise<void>;
};

export function AlisPage(props: AlisPageProps) {
  // pdfState ve onClosePdfModal PosPage wrapper'ında PdfViewerModal için kullanılıyor.
  // Burada destructure edilmiyor, sadece tip kontrolü için interface'te tanımlı.
  const {
    detailPurchase,
    detail,
    detailLoading,
    onCloseDetail,
    onEditDetail,
    onDeleteDetail,
    onExportDetail,
    onPrintDetail,
    onOpenDetailExcelPreview,
    detailActionPending,
    workspace,
    draftWorkspace,
    onResumeDraft,
    documents,
    purchaseSearchTerm,
    setPurchaseSearchTerm,
    purchaseDate,
    setPurchaseDate,
    onOpenCustomer,
    onViewDocument,
    onOpenDocumentExcelPreview,
    onExportDocument,
    onPrintDocument,
    onStartFromCustomer,
    onEditDocument,
    onDeleteDocument,
    onRetryUnicontaSync,
    retryPendingSequenceNo,
    onCancelUnicontaInvoice,
    cancelPendingSequenceNo,
    listLoading,
    actionPendingSequenceNo,
    customerMode,
    setCustomerMode,
    customerSearchTerm,
    setCustomerSearchTerm,
    candidateCustomers,
    newCustomer,
    setNewCustomer,
    onSelectExistingCustomer,
    onCreateNewCustomer,
    customerForm,
    setCustomerForm,
    onCustomerBlur,
    goldRows,
    silverRows,
    barRows,
    ptpdRows,
    onUpdateGoldRow,
    onUpdateSilverRow,
    onUpdateBarRow,
    onUpdatePtPdRow,
    activeWorkspaceView,
    setActiveWorkspaceView,
    numbering,
    setNumbering,
    onUpdateNumbering,
    invoiceGoldMode,
    invoiceGoldRows,
    invoiceGoldFooterLines,
    onUpdateInvoiceGoldRow,
    onUpdateInvoiceGoldFooterLine,
    onResetInvoiceGoldToAuto,
    invoiceMiscMode,
    invoiceMiscRows,
    onUpdateInvoiceMiscRow,
    onResetInvoiceMiscToAuto,
    bankInfo,
    setBankInfo,
    marketRates,
    setMarketRates,
    afgNote,
    setAfgNote,
    purchaseVatEnabled,
    setPurchaseVatEnabled,
    calculators,
    setCalculators,
    paymentMethod,
    setPaymentMethod,
    onPrintWorkspace,
    onOpenWorkspaceExcelPreview,
    onCancelWorkspace,
    onFinalizeWorkspace,
    customerPending,
    customerSelecting,
    finalizePending,
    cancelPending,
    onStartBlankWorkspace,
    startPending,
    priceOpen,
    setPriceOpen,
    desktopDisplayState,
    expectedDisplayRoute,
    routeMatches,
    onOpenCustomerDisplay,
    onCloseCustomerDisplay,
  } = props;

  return (
    <div className="flex min-h-full flex-col bg-white" style={sansStyle}>
      {detailPurchase ? (
        <SavedPurchaseDetailModal
          source={detailPurchase}
          detail={detail}
          loading={detailLoading}
          onClose={onCloseDetail}
          onEdit={onEditDetail}
          onDelete={onDeleteDetail}
          onExport={onExportDetail}
          onPrint={onPrintDetail}
          onPreview={onOpenDetailExcelPreview}
          actionPending={detailActionPending}
        />
      ) : null}

      {!workspace ? (
        <div className="flex flex-col gap-3 border-b-2 border-brand-300 bg-brand-50 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-lg font-black uppercase tracking-[0.18em] text-brand-900">Alış — Afregningsbilag</h2>
            <p className="text-[11px] font-medium text-brand-600">Müşteriden altın / gümüş alım belgesi</p>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
            <MarketRatesEditor
              marketRates={marketRates}
              setMarketRates={setMarketRates}
              priceOpen={priceOpen}
              setPriceOpen={setPriceOpen}
            />

            <button
              type="button"
              onClick={onStartBlankWorkspace}
              className="flex shrink-0 items-center justify-center gap-2 border border-brand-900 bg-brand-800 px-5 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-brand-900"
            >
              <Plus className="h-4 w-4" />
              {startPending ? 'Hazırlanıyor...' : 'Yeni Alış Başlat'}
            </button>
          </div>
        </div>
      ) : null}

      {workspace ? (
        <ActiveWorkspaceView
          workspace={workspace}
          customerMode={customerMode}
          setCustomerMode={setCustomerMode}
          customerSearchTerm={customerSearchTerm}
          setCustomerSearchTerm={setCustomerSearchTerm}
          candidateCustomers={candidateCustomers}
          newCustomer={newCustomer}
          setNewCustomer={setNewCustomer}
          onSelectExistingCustomer={onSelectExistingCustomer}
          onCreateNewCustomer={onCreateNewCustomer}
          customerForm={customerForm}
          setCustomerForm={setCustomerForm}
          onCustomerBlur={onCustomerBlur}
          goldRows={goldRows}
          silverRows={silverRows}
          barRows={barRows}
          ptpdRows={ptpdRows}
          onUpdateGoldRow={onUpdateGoldRow}
          onUpdateBarRow={onUpdateBarRow}
          onUpdatePtPdRow={onUpdatePtPdRow}
          onUpdateSilverRow={onUpdateSilverRow}
          activeWorkspaceView={activeWorkspaceView}
          setActiveWorkspaceView={setActiveWorkspaceView}
          numbering={numbering}
          setNumbering={setNumbering}
          onUpdateNumbering={onUpdateNumbering}
          invoiceGoldMode={invoiceGoldMode}
          invoiceGoldRows={invoiceGoldRows}
          invoiceGoldFooterLines={invoiceGoldFooterLines}
          onUpdateInvoiceGoldRow={onUpdateInvoiceGoldRow}
          onUpdateInvoiceGoldFooterLine={onUpdateInvoiceGoldFooterLine}
          onResetInvoiceGoldToAuto={onResetInvoiceGoldToAuto}
          invoiceMiscMode={invoiceMiscMode}
          invoiceMiscRows={invoiceMiscRows}
          onUpdateInvoiceMiscRow={onUpdateInvoiceMiscRow}
          onResetInvoiceMiscToAuto={onResetInvoiceMiscToAuto}
          bankInfo={bankInfo}
          setBankInfo={setBankInfo}
          marketRates={marketRates}
          setMarketRates={setMarketRates}
          afgNote={afgNote}
          setAfgNote={setAfgNote}
          purchaseVatEnabled={purchaseVatEnabled}
          setPurchaseVatEnabled={setPurchaseVatEnabled}
          calculators={calculators}
          setCalculators={setCalculators}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          priceOpen={priceOpen}
          setPriceOpen={setPriceOpen}
          onPrint={onPrintWorkspace}
          onOpenExcelPreview={onOpenWorkspaceExcelPreview}
          onCancel={onCancelWorkspace}
          onFinalize={onFinalizeWorkspace}
          customerPending={customerPending}
          customerSelecting={customerSelecting}
          finalizePending={finalizePending}
          cancelPending={cancelPending}
          desktopDisplayState={desktopDisplayState}
          expectedDisplayRoute={expectedDisplayRoute}
          routeMatches={routeMatches}
          onOpenCustomerDisplay={onOpenCustomerDisplay}
          onCloseCustomerDisplay={onCloseCustomerDisplay}
        />
      ) : (
        <StartWorkspaceView
          draftWorkspace={draftWorkspace}
          onResumeDraft={onResumeDraft}
          documents={documents}
          purchaseSearchTerm={purchaseSearchTerm}
          setPurchaseSearchTerm={setPurchaseSearchTerm}
          purchaseDate={purchaseDate}
          setPurchaseDate={setPurchaseDate}
          onOpenCustomer={onOpenCustomer}
          onViewDocument={onViewDocument}
          onOpenDocumentExcelPreview={onOpenDocumentExcelPreview}
          onExportDocument={onExportDocument}
          onPrintDocument={onPrintDocument}
          onStartFromCustomer={onStartFromCustomer}
          onEditDocument={onEditDocument}
          onDeleteDocument={onDeleteDocument}
          onRetryUnicontaSync={onRetryUnicontaSync}
          retryPendingSequenceNo={retryPendingSequenceNo}
          onCancelUnicontaInvoice={onCancelUnicontaInvoice}
          cancelPendingSequenceNo={cancelPendingSequenceNo}
          listLoading={listLoading}
          actionPendingSequenceNo={actionPendingSequenceNo}
        />
      )}
    </div>
  );
}

function ActiveWorkspaceView(props: {
  workspace: PosWorkspace;
  customerMode: 'existing' | 'new' | null;
  setCustomerMode: Dispatch<SetStateAction<'existing' | 'new' | null>>;
  customerSearchTerm: string;
  setCustomerSearchTerm: Dispatch<SetStateAction<string>>;
  candidateCustomers: CustomerOut[];
  newCustomer: EditableCustomer;
  setNewCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onSelectExistingCustomer: (customerId: string) => void;
  onCreateNewCustomer: (event: FormEvent) => void;
  customerForm: EditableCustomer;
  setCustomerForm: Dispatch<SetStateAction<EditableCustomer>>;
  onCustomerBlur: () => void;
  goldRows: EditableGoldRow[];
  barRows: EditableBarRow[];
  ptpdRows: EditablePtPdRow[];
  silverRows: EditableSilverRow[];
  onUpdateGoldRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdateBarRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdatePtPdRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdateSilverRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  activeWorkspaceView: WorkspaceSurfaceView;
  setActiveWorkspaceView: (nextView: WorkspaceSurfaceView) => void | Promise<void>;
  numbering: EditableWorkspaceNumbering;
  setNumbering: Dispatch<SetStateAction<EditableWorkspaceNumbering>>;
  onUpdateNumbering: (field: keyof EditableWorkspaceNumbering, value: string) => void;
  invoiceGoldMode: CompanionMode;
  invoiceGoldRows: EditableInvoiceGoldRow[];
  invoiceGoldFooterLines: string[];
  onUpdateInvoiceGoldRow: (rowKey: string, field: 'code' | 'fineness' | 'gram', value: string) => void;
  onUpdateInvoiceGoldFooterLine: (index: number, value: string) => void;
  onResetInvoiceGoldToAuto: () => void;
  invoiceMiscMode: CompanionMode;
  invoiceMiscRows: EditableInvoiceMiscRow[];
  onUpdateInvoiceMiscRow: (rowKey: string, field: 'text' | 'quantity' | 'unit_price_dkk', value: string) => void;
  onResetInvoiceMiscToAuto: () => void;
  bankInfo: PosWorkspaceBankInfo;
  setBankInfo: Dispatch<SetStateAction<PosWorkspaceBankInfo>>;
  marketRates: PosWorkspaceMarketRates;
  setMarketRates: Dispatch<SetStateAction<PosWorkspaceMarketRates>>;
  afgNote: string;
  setAfgNote: Dispatch<SetStateAction<string>>;
  purchaseVatEnabled: boolean;
  setPurchaseVatEnabled: Dispatch<SetStateAction<boolean>>;
  calculators: PosWorkspaceCalculators;
  setCalculators: Dispatch<SetStateAction<PosWorkspaceCalculators>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  priceOpen: boolean;
  setPriceOpen: Dispatch<SetStateAction<boolean>>;
  onPrint: () => void;
  onOpenExcelPreview: () => void;
  onCancel: () => void;
  onFinalize: () => void | Promise<void>;
  customerPending: boolean;
  customerSelecting: boolean;
  finalizePending: boolean;
  cancelPending: boolean;
  desktopDisplayState?: DesktopDisplayWindowState | null;
  expectedDisplayRoute?: string | null;
  routeMatches?: boolean;
  onOpenCustomerDisplay?: () => void | Promise<void>;
  onCloseCustomerDisplay?: () => void | Promise<void>;
}) {
  const {
    workspace,
    customerMode,
    setCustomerMode,
    customerSearchTerm,
    setCustomerSearchTerm,
    candidateCustomers,
    newCustomer,
    setNewCustomer,
    onSelectExistingCustomer,
    onCreateNewCustomer,
    customerForm,
    setCustomerForm,
    onCustomerBlur,
    goldRows,
    silverRows,
    barRows,
    ptpdRows,
    onUpdateGoldRow,
    onUpdateSilverRow,
    onUpdateBarRow,
    onUpdatePtPdRow,
    activeWorkspaceView,
    setActiveWorkspaceView,
    numbering,
    onUpdateNumbering,
    invoiceGoldMode,
    invoiceGoldRows,
    invoiceGoldFooterLines,
    onUpdateInvoiceGoldRow,
    onUpdateInvoiceGoldFooterLine,
    onResetInvoiceGoldToAuto,
    invoiceMiscMode,
    invoiceMiscRows,
    onUpdateInvoiceMiscRow,
    onResetInvoiceMiscToAuto,
    bankInfo,
    setBankInfo,
    marketRates,
    setMarketRates,
    afgNote,
    setAfgNote,
    purchaseVatEnabled,
    setPurchaseVatEnabled,
    calculators,
    setCalculators,
    paymentMethod,
    setPaymentMethod,
    priceOpen,
    setPriceOpen,
    onPrint,
    onOpenExcelPreview,
    onCancel,
    onFinalize,
    customerSelecting,
    finalizePending,
    cancelPending,
    desktopDisplayState,
    expectedDisplayRoute,
    routeMatches = false,
    onOpenCustomerDisplay,
    onCloseCustomerDisplay,
  } = props;
  const hasSelectedCustomer = Boolean(workspace.customer.customer_id);
  const liveTotalWeight = useMemo(
    () => [...goldRows, ...silverRows, ...barRows, ...ptpdRows].reduce((sum, row) => sum + parseDecimalValue(row.gram), 0),
    [goldRows, silverRows, barRows, ptpdRows],
  );
  const liveTotalAmount = useMemo(
    () => [...goldRows, ...silverRows, ...barRows, ...ptpdRows].reduce((sum, row) => sum + parseDecimalValue(row.line_total_dkk), 0),
    [goldRows, silverRows, barRows, ptpdRows],
  );
  const liveVatAmount = purchaseVatEnabled ? Math.round(liveTotalAmount * 0.25 * 100) / 100 : 0;
  const liveGrossAmount = Math.round((liveTotalAmount + liveVatAmount) * 100) / 100;
  const actualRoute = desktopDisplayState?.active_route ? normalizeDesktopDisplayRoute(desktopDisplayState.active_route) : '—';
  const workspaceWorkbookName = buildWorkspaceWorkbookName(workspace);
  const displayStatusTone = routeMatches
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
    : desktopDisplayState?.window_open
      ? 'border-amber-300 bg-amber-50 text-amber-700'
      : 'border-rose-300 bg-rose-50 text-rose-700';
  const displayStatusLabel = routeMatches
    ? 'Bağlı'
    : desktopDisplayState?.window_open
      ? 'Farklı görünüm açık'
      : 'Kapalı';
  const displayStatusText = routeMatches
    ? 'Gerçek müşteri ekranı bu taslağı gösteriyor.'
    : desktopDisplayState?.window_open
      ? 'Bir müşteri ekranı açık, fakat farklı route gösteriyor.'
      : 'Gerçek müşteri ekranı şu an görünmüyor.';

  return (
    <div id="alis-print-area" className="flex-1 overflow-auto bg-white">
      <div className="border-b-4 border-amber-600 bg-brand-900 px-6 py-3 print:hidden">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-[8.5rem]">
              <span className="block text-xs uppercase tracking-widest text-brand-500">Afregningsnr.</span>
              <span className="mono text-2xl font-black text-white">
                {workspace.numbering_preview.afregnings_number_next || workspace.session.session_code}
              </span>
            </div>
            <div className="min-w-[6rem]">
              <span className="block text-xs uppercase tracking-widest text-brand-500">Dato</span>
              <span className="mono text-base font-bold text-brand-100">{formatDateOnly(workspace.session.updated_at)}</span>
              <span className="mt-0.5 block text-[10px] text-brand-400" title={workspace.session.updated_at}>
                Son güncelleme: {formatRelativeTime(workspace.session.updated_at)}
              </span>
            </div>
            <MarketRatesEditor
              marketRates={marketRates}
              setMarketRates={setMarketRates}
              priceOpen={priceOpen}
              setPriceOpen={setPriceOpen}
              variant="dark"
            />
          </div>
          <div className="flex flex-wrap items-stretch gap-2 xl:justify-end">
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center whitespace-nowrap border border-brand-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-brand-800"
            >
              <Printer className="mr-2 h-4 w-4" />
              Yazdır
            </button>
            <button
              type="button"
              onClick={onOpenExcelPreview}
              className="inline-flex min-w-[10.25rem] max-w-[11.25rem] items-center gap-2.5 border border-emerald-500 px-3 py-2 text-left transition-colors hover:bg-emerald-900/40"
            >
              <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-emerald-200" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-200">Çalışma Dosyası</span>
                <span className="truncate text-xs font-black uppercase tracking-wider text-emerald-50" style={monoStyle}>
                  {workspaceWorkbookName}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelPending}
              className="inline-flex items-center gap-2 whitespace-nowrap border border-brand-700 px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-300 transition-colors hover:border-brand-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              title="Taslağı iptal et (Esc)"
            >
              {cancelPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {cancelPending ? 'İptal ediliyor...' : 'İptal Et'}
            </button>
            <button
              type="button"
              onClick={() => {
                void onFinalize();
              }}
              disabled={finalizePending || !hasSelectedCustomer}
              className="inline-flex items-center whitespace-nowrap border border-green-600 bg-green-700 px-5 py-2 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
              title="Kaydet (Ctrl+S)"
            >
              {finalizePending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {finalizePending ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-brand-300 bg-brand-50 px-6 py-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-brand-200 bg-white px-4 py-3">
          <div className="min-w-0 flex flex-1 items-start gap-3">
            <span className={`mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center border ${displayStatusTone}`}>
              {routeMatches ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-brand-500">Müşteri Ekranı</span>
                <span className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${displayStatusTone}`}>
                  {displayStatusLabel}
                </span>
                {!desktopDisplayState?.has_secondary_monitor ? (
                  <span className="inline-flex border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
                    İkinci monitör yok
                  </span>
                ) : null}
                {!routeMatches && actualRoute !== '—' ? (
                  <span className="mono inline-flex max-w-full items-center border border-brand-200 bg-brand-50 px-2 py-1 text-[10px] font-black text-brand-700">
                    Aktif: {actualRoute}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-brand-800">{displayStatusText}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {desktopDisplayState?.window_open && onCloseCustomerDisplay ? (
              <button
                type="button"
                onClick={onCloseCustomerDisplay}
                className="whitespace-nowrap border border-rose-400 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-rose-700 transition hover:bg-rose-50"
              >
                Müşteri ekranını kapat
              </button>
            ) : null}
            {expectedDisplayRoute && onOpenCustomerDisplay ? (
              <button
                type="button"
                onClick={onOpenCustomerDisplay}
                className="whitespace-nowrap border border-brand-900 bg-brand-800 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white transition hover:bg-brand-900"
              >
                Gerçek ekranı aç / öne getir
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <WorkspaceSurfaceTabs
        activeView={activeWorkspaceView}
        setActiveView={setActiveWorkspaceView}
        quickModeEditable={workspace.quick_mode_editable}
      />

      {activeWorkspaceView === 'system' ? (
        <>
          <div className="grid border-b-2 border-brand-300 xl:grid-cols-[0.86fr_1.14fr] xl:items-start xl:divide-x-2 xl:divide-brand-200">
            <div className="bg-brand-50 px-6 py-4">
              <div className="space-y-4 xl:sticky xl:top-4">
                <div className="border-b border-brand-200 pb-4">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-brand-500">Sero Guld</p>
                  <p className="text-xs text-brand-600">Køb og salg af guld, sølv og smykker</p>
                  <div className="mono mt-3 space-y-0.5 text-xs text-brand-600">
                    <p>Tlf: +45 00 00 00 00</p>
                    <p>CVR: 00 00 00 00</p>
                    <p>www.seroguld.dk</p>
                  </div>
                </div>

                <VariableValuesSheetEditor
                  numbering={numbering}
                  onUpdateNumbering={onUpdateNumbering}
                  marketRates={marketRates}
                  setMarketRates={setMarketRates}
                  afgNote={afgNote}
                  setAfgNote={setAfgNote}
                  calculators={calculators}
                  setCalculators={setCalculators}
                  onUpdateGoldRow={onUpdateGoldRow}
                  onUpdateSilverRow={onUpdateSilverRow}
                  title="Belge ayarları"
                  description="Doküman ayarları, EUR bazlı piyasa matrisi, AFG notu ve hesaplayıcılar burada tutulur."
                  layout="compactSidebar"
                  showCalculators={false}
                />

                <div className="border border-brand-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                        hasSelectedCustomer
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-amber-300 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {hasSelectedCustomer ? 'Müşteri bağlı' : 'Müşteri seçimi bekleniyor'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <p className="mono text-[11px] font-black uppercase tracking-wider text-brand-800">
                      Toplam gram: {formatNumber(liveTotalWeight)} g
                    </p>
                    <p className="mono text-[11px] font-black uppercase tracking-wider text-brand-800">Net: {formatMoney(liveTotalAmount)} DKK</p>
                    {purchaseVatEnabled ? (
                      <p className="mono text-[11px] font-black uppercase tracking-wider text-brand-800">KDV (tarihsel belge): {formatMoney(liveVatAmount)} DKK</p>
                    ) : null}
                    <p className="mono text-sm font-black uppercase tracking-wider text-emerald-800">Ödenecek: {formatMoney(liveGrossAmount)} DKK</p>
                    <label className="mt-3 block text-[10px] font-black uppercase tracking-widest text-brand-500">
                      AFG notu
                      <textarea
                        value={afgNote}
                        maxLength={1000}
                        onChange={(event) => setAfgNote(event.target.value)}
                        rows={3}
                        className="mt-1 w-full resize-y border border-brand-300 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal text-brand-900 outline-none focus:border-brand-700"
                        placeholder="Belge, fatura ve Uniconta'ya aktarılacak not"
                      />
                    </label>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    <button
                      type="button"
                      onClick={onCancel}
                      disabled={cancelPending}
                      className="whitespace-nowrap border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {cancelPending ? 'İptal...' : 'İptal Et'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onFinalize();
                      }}
                      disabled={finalizePending || !hasSelectedCustomer}
                      className="inline-flex items-center justify-center whitespace-nowrap border border-green-600 bg-green-700 px-5 py-2 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {finalizePending ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white xl:self-start">
              {hasSelectedCustomer ? (
                <>
                  <CustomerAlisSummaryStrip customerId={workspace.customer.customer_id} />
                  <CustomerInfoTable
                    customer={customerForm}
                    setCustomer={setCustomerForm}
                    onBlur={onCustomerBlur}
                    bankInfo={bankInfo}
                    setBankInfo={setBankInfo}
                  />
                </>
              ) : (
                <div className="print:hidden">
                  <div className="border-b border-brand-200 bg-brand-50 px-4 py-2">
                    <p className="text-xs font-black uppercase tracking-widest text-brand-700">Müşteri Seçimi</p>
                  </div>
                  {!customerMode ? (
                    <div className="grid grid-cols-2 divide-x divide-brand-200">
                      <button
                        type="button"
                        onClick={() => setCustomerMode('new')}
                        className="group flex items-center space-x-3 bg-white px-6 py-5 text-left transition-colors hover:bg-brand-50"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-brand-400 transition-colors group-hover:border-brand-700">
                          <UserPlus className="h-4 w-4 text-brand-600" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-brand-900">Yeni Müşteri</p>
                          <p className="mt-0.5 text-xs text-brand-400">Bilgileri girin</p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setCustomerMode('existing')}
                        className="group flex items-center space-x-3 bg-white px-6 py-5 text-left transition-colors hover:bg-brand-50"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-brand-400 transition-colors group-hover:border-brand-700">
                          <Search className="h-4 w-4 text-brand-600" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-brand-900">Mevcut Müşteri</p>
                          <p className="mt-0.5 text-xs text-brand-400">Listeden seçin</p>
                        </div>
                      </button>
                    </div>
                  ) : null}

                  {customerMode === 'existing' ? (
                    <div>
                      <div className="flex items-center space-x-2 border-b border-brand-200 px-3 py-2">
                        <Search className="h-3.5 w-3.5 text-brand-400" />
                        <input
                          type="text"
                          placeholder="İsim, CPR, telefon..."
                          value={customerSearchTerm}
                          onChange={(event) => setCustomerSearchTerm(event.target.value)}
                          className="flex-1 bg-transparent text-sm text-brand-900 outline-none"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setCustomerMode(null)}
                          className="text-xs font-semibold text-brand-500 hover:text-brand-800"
                        >
                          ← Geri
                        </button>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {candidateCustomers.length === 0 ? (
                          <p className="px-4 py-8 text-center text-xs text-brand-400">Kayıtlı müşteri bulunamadı</p>
                        ) : (
                          <table className="w-full border-collapse">
                            <tbody>
                              {candidateCustomers.map((customer, index) => (
                                <tr
                                  key={customer.id}
                                  onClick={() => onSelectExistingCustomer(customer.id)}
                                  className={`cursor-pointer border-b border-brand-100 transition-colors hover:bg-brand-50 ${index % 2 === 0 ? 'bg-white' : 'bg-brand-50/40'}`}
                                >
                                  <td className="px-3 py-2.5 text-xs font-bold text-brand-900">{customer.name}</td>
                                  <td className="mono px-3 py-2.5 text-xs text-brand-600">{customer.cpr_number_masked || '-'}</td>
                                  <td className="mono px-3 py-2.5 text-xs text-brand-500">{customer.phone || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  ) : customerMode === 'new' ? (
                    <form onSubmit={onCreateNewCustomer}>
                      <div className="flex justify-end border-b border-brand-200 px-4 py-1.5">
                        <button
                          type="button"
                          onClick={() => setCustomerMode(null)}
                          className="text-xs font-semibold text-brand-500 hover:text-brand-800"
                        >
                          ← Geri
                        </button>
                      </div>
                      <CustomerEditorTable
                        customer={newCustomer}
                        setCustomer={setNewCustomer}
                        bankInfo={bankInfo}
                        setBankInfo={setBankInfo}
                        paymentMethod={paymentMethod}
                        setPaymentMethod={setPaymentMethod}
                        showPaymentSection={false}
                        onSelectMatchedCustomer={onSelectExistingCustomer}
                      />
                      <div className="border-t border-brand-200 px-4 py-3">
                        <button
                          type="submit"
                          disabled={
                            customerSelecting ||
                            newCustomer.name.trim().length < 2 ||
                            newCustomer.phone.trim().length < 7 ||
                            newCustomer.cpr_number.replace(/\D/g, '').length < 10 ||
                            newCustomer.identity_doc_number.trim().length < 4 ||
                            (newCustomer.postal_code.replace(/\D/g, '').length > 0 &&
                              newCustomer.postal_code.replace(/\D/g, '').length !== 4)
                          }
                          className="w-full border border-brand-900 bg-brand-800 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-brand-900 disabled:opacity-50"
                        >
                          {customerSelecting ? 'Müşteri oluşturuluyor...' : 'Yeni müşteriyi belgeye ata'}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              )}
              <div className="border-t-2 border-brand-200 px-4 py-3">
                <VariableValuesSheetEditor
                  numbering={numbering}
                  onUpdateNumbering={onUpdateNumbering}
                  marketRates={marketRates}
                  setMarketRates={setMarketRates}
                  afgNote={afgNote}
                  setAfgNote={setAfgNote}
                  calculators={calculators}
                  setCalculators={setCalculators}
                  onUpdateGoldRow={onUpdateGoldRow}
                  onUpdateSilverRow={onUpdateSilverRow}
                  layout="compactSidebar"
                  showSettings={false}
                />
              </div>
            </div>
          </div>

          <AfregningsSheetEditor
            workspace={workspace}
            customerForm={customerForm}
            goldRows={goldRows}
            silverRows={silverRows}
            barRows={barRows}
            ptpdRows={ptpdRows}
            onUpdateGoldRow={onUpdateGoldRow}
            onUpdateSilverRow={onUpdateSilverRow}
            onUpdateBarRow={onUpdateBarRow}
            onUpdatePtPdRow={onUpdatePtPdRow}
            bankInfo={bankInfo}
            setBankInfo={setBankInfo}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
          />
        </>
      ) : (
        <WorkspaceExcelSurface workspaceId={workspace.session.id} />
      )}
    </div>
  );
}

function WorkspaceSurfaceTabs({
  activeView,
  setActiveView,
  quickModeEditable,
}: {
  activeView: WorkspaceSurfaceView;
  setActiveView: (nextView: WorkspaceSurfaceView) => void | Promise<void>;
  quickModeEditable: boolean;
}) {
  return (
    <div className="border-b-2 border-brand-300 bg-brand-50 px-4 py-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'system' as const, label: 'System', shortLabel: 'SYS' },
          { key: 'excel' as const, label: 'Excel', shortLabel: 'XLSM' },
        ].map((tab) => {
          const isActive = activeView === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveView(tab.key)}
              className={`inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-black uppercase tracking-widest transition ${
                isActive
                  ? 'border-brand-900 bg-brand-900 text-white'
                  : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-100'
              }`}
            >
              <span className={`mono px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-brand-700 text-brand-100' : 'bg-brand-100 text-brand-600'}`}>
                {tab.shortLabel}
              </span>
              {tab.label}
            </button>
          );
        })}
        <span
          className={`ml-auto inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
            quickModeEditable
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
              : 'border-amber-300 bg-amber-50 text-amber-700'
          }`}
        >
          {quickModeEditable ? 'Hızlı Grid Aktif' : 'Hızlı Grid Özet'}
        </span>
      </div>
    </div>
  );
}

function WorkspaceExcelSurface({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="border-b-2 border-brand-300 bg-stone-100">
      <div className="h-[calc(100vh-17rem)] min-h-[760px]">
        <EmbeddedWorkbookPanel kind="alis-workspace" artifactKey={workspaceId} layoutMode="workspace" />
      </div>
    </div>
  );
}

function StartWorkspaceView(props: StartWorkspaceViewProps) {
  const {
    draftWorkspace,
    onResumeDraft,
    documents,
    purchaseSearchTerm,
    setPurchaseSearchTerm,
    purchaseDate,
    setPurchaseDate,
    onOpenCustomer,
    onViewDocument,
    onOpenDocumentExcelPreview,
    onExportDocument,
    onPrintDocument,
    onStartFromCustomer,
    onEditDocument,
    onDeleteDocument,
    onRetryUnicontaSync,
    retryPendingSequenceNo,
    onCancelUnicontaInvoice,
    cancelPendingSequenceNo,
    listLoading,
    actionPendingSequenceNo,
  } = props;
  const savedPurchaseContainerRef = useRef<HTMLDivElement | null>(null);
  const [savedPurchaseLayout, setSavedPurchaseLayout] = useState<'table' | 'cards'>('table');
  const [sortConfig, setSortConfig] = useState<{ key: SavedPurchaseSortKey; direction: 'asc' | 'desc' }>(
    { key: 'sequence_no', direction: 'desc' },
  );
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [dateTo, setDateTo] = useState('');

  const toggleSort = (key: SavedPurchaseSortKey) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'sequence_no' || key === 'issued_at' || key === 'gross_amount' ? 'desc' : 'asc' };
    });
  };

  const sanitizedAmountMin = useMemo(() => {
    const v = Number(amountMin.replace(',', '.'));
    return Number.isFinite(v) && amountMin.trim() !== '' ? v : null;
  }, [amountMin]);
  const sanitizedAmountMax = useMemo(() => {
    const v = Number(amountMax.replace(',', '.'));
    return Number.isFinite(v) && amountMax.trim() !== '' ? v : null;
  }, [amountMax]);

  const filteredAndSorted = useMemo(() => {
    let working = documents;
    if (dateTo) {
      const dateToEnd = `${dateTo}T23:59:59.999`;
      working = working.filter((doc) => doc.issued_at <= dateToEnd);
    }
    if (sanitizedAmountMin !== null) {
      working = working.filter((doc) => Number(doc.gross_amount_dkk || 0) >= sanitizedAmountMin);
    }
    if (sanitizedAmountMax !== null) {
      working = working.filter((doc) => Number(doc.gross_amount_dkk || 0) <= sanitizedAmountMax);
    }
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    const sorted = [...working].sort((a, b) => {
      switch (sortConfig.key) {
        case 'sequence_no':
          return (a.sequence_no - b.sequence_no) * direction;
        case 'issued_at':
          return a.issued_at.localeCompare(b.issued_at) * direction;
        case 'customer_name':
          return (a.customer_name || '').localeCompare(b.customer_name || '', document.documentElement.lang, { sensitivity: 'base' }) * direction;
        case 'gross_amount':
          return (Number(a.gross_amount_dkk || 0) - Number(b.gross_amount_dkk || 0)) * direction;
        case 'uniconta_status': {
          const order = (s?: string | null) => (s === 'synced' ? 0 : s === 'failed' ? 1 : s === 'skipped' ? 2 : 3);
          return (order(a.uniconta_sync_status) - order(b.uniconta_sync_status)) * direction;
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [documents, dateTo, sanitizedAmountMin, sanitizedAmountMax, sortConfig]);

  const hasExtraFilters = Boolean(amountMin || amountMax || dateTo);

  useEffect(() => {
    const node = savedPurchaseContainerRef.current;
    if (!node) return;

    const updateLayout = () => {
      const nextLayout = node.getBoundingClientRect().width < SAVED_PURCHASE_CARD_BREAKPOINT_PX ? 'cards' : 'table';
      setSavedPurchaseLayout((current) => (current === nextLayout ? current : nextLayout));
    };

    updateLayout();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateLayout());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  return (
    <div className="flex-1 overflow-auto bg-brand-50/30">
      <div className="px-6 py-6">
        {draftWorkspace ? (
          <div className="mb-6 overflow-hidden border-2 border-amber-300 bg-amber-50">
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">Aktif Taslak</p>
                <p className="mono mt-1 text-lg font-black text-brand-900">
                  {draftWorkspace.numbering_preview.afregnings_number_next || draftWorkspace.session.session_code}
                </p>
                <p className="mt-1 text-xs text-brand-600">
                  {draftWorkspace.customer.name || 'Müşteri seçilmedi'} · {formatDateOnly(draftWorkspace.session.updated_at)}
                </p>
                <p className="mt-1 text-xs text-brand-500">
                  {formatNumber(draftWorkspace.summary.total_weight_grams, ' g')} toplam · {formatMoney(draftWorkspace.summary.total_amount_dkk)}
                </p>
              </div>
              <button
                type="button"
                onClick={onResumeDraft}
                className="inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-brand-800"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Taslağı Aç
              </button>
            </div>
          </div>
        ) : null}

        <div ref={savedPurchaseContainerRef} className="overflow-visible border-2 border-brand-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-brand-200 bg-brand-50 px-6 py-3">
            <div className="flex items-center gap-3">
              <p className="text-xs font-black uppercase tracking-widest text-brand-700">Kayıtlı Alışlar</p>
              <span className="mono inline-flex items-center border border-brand-300 bg-white px-2 py-0.5 text-[11px] font-black uppercase tracking-widest text-brand-500">
                {filteredAndSorted.length === documents.length
                  ? `${documents.length} kayıt`
                  : `${filteredAndSorted.length} / ${documents.length} kayıt`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[13rem] flex-1 sm:flex-none">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-400" />
                <input
                  type="text"
                  placeholder="Müşteri, CPR, Afg No..."
                  value={purchaseSearchTerm}
                  onChange={(event) => setPurchaseSearchTerm(event.target.value)}
                  className="w-full border border-brand-300 py-1 pl-7 pr-2 text-xs focus:border-brand-500 focus:outline-none sm:w-48"
                />
              </div>
              <div className="relative min-w-[8.5rem] flex-1 sm:flex-none" title="Başlangıç tarihi (gün)">
                <Calendar className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-400" />
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(event) => setPurchaseDate(event.target.value)}
                  className="mono w-full border border-brand-300 py-1 pl-7 pr-2 text-xs focus:border-brand-500 focus:outline-none sm:w-auto"
                  placeholder="Tarih"
                />
              </div>
              <span className="text-[10px] font-bold text-brand-400">→</span>
              <div className="relative min-w-[8.5rem] flex-1 sm:flex-none" title="Bitiş tarihi (gün)">
                <Calendar className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-400" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mono w-full border border-brand-300 py-1 pl-7 pr-2 text-xs focus:border-brand-500 focus:outline-none sm:w-auto"
                  placeholder="Bitiş"
                />
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={amountMin}
                  onChange={(event) => setAmountMin(event.target.value)}
                  placeholder="Min DKK"
                  className="mono w-20 border border-brand-300 py-1 px-2 text-xs focus:border-brand-500 focus:outline-none"
                  title="Tutar alt sınır (DKK)"
                />
                <span className="text-[10px] font-bold text-brand-400">→</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={amountMax}
                  onChange={(event) => setAmountMax(event.target.value)}
                  placeholder="Max DKK"
                  className="mono w-20 border border-brand-300 py-1 px-2 text-xs focus:border-brand-500 focus:outline-none"
                  title="Tutar üst sınır (DKK)"
                />
              </div>
              {purchaseSearchTerm || purchaseDate || hasExtraFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setPurchaseSearchTerm('');
                    setPurchaseDate('');
                    setDateTo('');
                    setAmountMin('');
                    setAmountMax('');
                  }}
                  className="border border-transparent p-1 text-brand-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                  title="Filtreleri Temizle"
                >
                  <FilterX className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {savedPurchaseLayout === 'cards' ? (
            <SavedPurchaseCardList
              documents={filteredAndSorted}
              listLoading={listLoading}
              onViewDocument={onViewDocument}
              onOpenDocumentExcelPreview={onOpenDocumentExcelPreview}
              onOpenCustomer={onOpenCustomer}
              onExportDocument={onExportDocument}
              onPrintDocument={onPrintDocument}
              onStartFromCustomer={onStartFromCustomer}
              onEditDocument={onEditDocument}
              onDeleteDocument={onDeleteDocument}
              onRetryUnicontaSync={onRetryUnicontaSync}
              retryPendingSequenceNo={retryPendingSequenceNo}
              onCancelUnicontaInvoice={onCancelUnicontaInvoice}
              cancelPendingSequenceNo={cancelPendingSequenceNo}
              actionPendingSequenceNo={actionPendingSequenceNo}
            />
          ) : (
            <SavedPurchaseTable
              documents={filteredAndSorted}
              listLoading={listLoading}
              onViewDocument={onViewDocument}
              onOpenDocumentExcelPreview={onOpenDocumentExcelPreview}
              onOpenCustomer={onOpenCustomer}
              onExportDocument={onExportDocument}
              onPrintDocument={onPrintDocument}
              onStartFromCustomer={onStartFromCustomer}
              onEditDocument={onEditDocument}
              onDeleteDocument={onDeleteDocument}
              onRetryUnicontaSync={onRetryUnicontaSync}
              retryPendingSequenceNo={retryPendingSequenceNo}
              onCancelUnicontaInvoice={onCancelUnicontaInvoice}
              cancelPendingSequenceNo={cancelPendingSequenceNo}
              actionPendingSequenceNo={actionPendingSequenceNo}
              sortConfig={sortConfig}
              onToggleSort={toggleSort}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SavedPurchaseTable({
  documents,
  listLoading,
  onViewDocument,
  onOpenDocumentExcelPreview,
  onOpenCustomer,
  onExportDocument,
  onPrintDocument,
  onStartFromCustomer,
  onEditDocument,
  onDeleteDocument,
  onRetryUnicontaSync,
  retryPendingSequenceNo,
  onCancelUnicontaInvoice,
  cancelPendingSequenceNo,
  actionPendingSequenceNo,
  sortConfig,
  onToggleSort,
}: SavedPurchaseListRendererProps) {
  const sortArrow = (key: SavedPurchaseSortKey) => {
    if (!sortConfig || sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };
  const headerSortClass = (key: SavedPurchaseSortKey) =>
    sortConfig && sortConfig.key === key
      ? 'cursor-pointer select-none bg-brand-200 hover:bg-brand-300'
      : 'cursor-pointer select-none hover:bg-brand-200';
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-brand-400">
          <th
            onClick={onToggleSort ? () => onToggleSort('sequence_no') : undefined}
            className={`w-[100px] border border-brand-300 bg-brand-100 px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600 ${onToggleSort ? headerSortClass('sequence_no') : ''}`}
            title="Afg numarasına göre sırala"
          >
            Afg. Nr.{onToggleSort ? <span className="ml-1 text-brand-400">{sortArrow('sequence_no')}</span> : null}
          </th>
          <th
            onClick={onToggleSort ? () => onToggleSort('issued_at') : undefined}
            className={`w-[120px] border border-brand-300 bg-brand-100 px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600 ${onToggleSort ? headerSortClass('issued_at') : ''}`}
            title="Tarihe göre sırala"
          >
            Dato{onToggleSort ? <span className="ml-1 text-brand-400">{sortArrow('issued_at')}</span> : null}
          </th>
          <th
            onClick={onToggleSort ? () => onToggleSort('customer_name') : undefined}
            className={`w-[240px] border border-brand-300 bg-brand-100 px-4 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600 ${onToggleSort ? headerSortClass('customer_name') : ''}`}
            title="Müşteri adına göre sırala"
          >
            Müşteri{onToggleSort ? <span className="ml-1 text-brand-400">{sortArrow('customer_name')}</span> : null}
          </th>
          <th className="border border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-xs font-black uppercase tracking-wider text-amber-700">Guld — Karat</th>
          <th className="border border-slate-300 bg-slate-100 px-4 py-2.5 text-center text-xs font-black uppercase tracking-wider text-slate-600">Sølv — Lødighed</th>
          <th
            onClick={onToggleSort ? () => onToggleSort('gross_amount') : undefined}
            className={`w-[140px] border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-right text-xs font-black uppercase tracking-wider text-emerald-700 ${onToggleSort ? 'cursor-pointer select-none hover:bg-emerald-100' : ''}`}
            title="Tutara göre sırala"
          >
            I alt (DKK){onToggleSort ? <span className="ml-1 text-emerald-400">{sortArrow('gross_amount')}</span> : null}
          </th>
          <th className="w-[156px] border border-brand-300 bg-brand-100 px-2 py-2.5 text-center text-xs font-black uppercase tracking-wider text-brand-600">İşlemler</th>
        </tr>
      </thead>
      <tbody>
        {listLoading ? (
          <tr>
            <td colSpan={7} className="px-4 py-10 text-center text-sm text-brand-400">
              Kayıtlı alışlar yükleniyor...
            </td>
          </tr>
        ) : documents.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-4 py-14 text-center">
              <Plus className="mx-auto h-8 w-8 text-brand-300" />
              <p className="mt-3 text-sm font-semibold text-brand-500">Henüz kayıtlı alış yok</p>
              <p className="mt-1 text-xs text-brand-400">Müşteri geldiğinde yukarıdaki <span className="font-bold text-brand-700">Yeni Alış Başlat</span> butonuna bas veya <kbd className="mx-1 border border-brand-300 bg-white px-1 py-0.5 text-[10px] font-bold">Ctrl + N</kbd> kısayolunu kullan</p>
            </td>
          </tr>
        ) : (
          documents.map((document, index) => (
            <tr key={document.sequence_no} className={`border-b border-brand-200 transition-colors hover:bg-brand-100 ${index % 2 === 0 ? 'bg-white' : 'bg-brand-50'}`}>
              <td className="group/afgcell relative border border-brand-200 px-4 py-3">
                <button
                  type="button"
                  onClick={() => onOpenDocumentExcelPreview(document)}
                  className="group/afgbtn flex items-center gap-1.5 transition-colors hover:text-emerald-700"
                  title="Excel önizleme aç"
                >
                  <span className="mono text-sm font-black text-brand-900 group-hover/afgbtn:text-emerald-800">
                    {formatAfgListNumber(document.sequence_no)}
                  </span>
                  <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-brand-300 transition-colors group-hover/afgbtn:text-emerald-600" />
                </button>
                <div className="hidden group-hover/afgcell:block">
                  <SavedPurchaseExcelPreview document={document} />
                </div>
              </td>
              <td className="border border-brand-200 px-4 py-3">
                <span className="mono text-sm text-brand-700">{formatDateOnly(document.issued_at)}</span>
                <span className="mono mt-0.5 block text-xs text-brand-400">{formatTimeOnly(document.issued_at)}</span>
              </td>
              <td className="group/cust relative border border-brand-200 px-4 py-3">
                {document.customer_id ? (
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(document)}
                    className="text-left text-sm font-semibold text-brand-900 transition-colors hover:text-brand-700 hover:underline"
                    title="Müşteriler modülünde aç"
                  >
                    {document.customer_name || '—'}
                  </button>
                ) : (
                  <span className="text-sm font-semibold text-brand-900">{document.customer_name || '—'}</span>
                )}
                {document.customer_cpr || document.customer_cpr_masked ? (
                  <span className="mono ml-2 text-xs text-brand-400">{document.customer_cpr || document.customer_cpr_masked}</span>
                ) : null}
                {document.customer_name ? (
                  <div className="absolute left-0 top-full z-50 mt-1 hidden group-hover/cust:block">
                    <SavedPurchaseCustomerPreview document={document} />
                  </div>
                ) : null}
              </td>
              <td className="border border-amber-300 bg-amber-50 px-3 py-2.5" style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}>
                {document.gold_preview_items.length > 0 ? (
                  <div className="group/gold relative flex items-center justify-center gap-1.5">
                    <span className="mono inline-flex items-center gap-1 border border-amber-400 bg-amber-200 px-2 py-0.5">
                      <span className="text-xs font-black text-amber-800">Au</span>
                      <span className="text-xs font-bold text-amber-900">
                        {sumPreviewWeight(document.gold_preview_items).toFixed(2)}
                        <span className="font-normal text-amber-600">g</span>
                      </span>
                    </span>
                    {document.gold_preview_items.length === 1 ? (
                      <span className="mono border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs font-black text-amber-600">
                        {formatSavedPurchasePreviewLabel(document.gold_preview_items[0])}
                      </span>
                    ) : (
                      <span className="mono text-xs font-bold text-amber-500">+{document.gold_preview_items.length}k</span>
                    )}
                    <SavedPurchaseMetalPreview
                      title="Karat Dağılımı"
                      rows={document.gold_preview_items.map((item) => ({
                        key: `${item.line_no}-${item.type_label}`,
                        label: formatSavedPurchasePreviewLabel(item),
                        weight: Number(item.weight_grams || 0),
                      }))}
                      tone="gold"
                    />
                  </div>
                ) : (
                  <span className="text-xs italic text-brand-300">—</span>
                )}
              </td>
              <td className="border border-slate-300 bg-slate-50 px-3 py-2.5" style={{ width: '160px', minWidth: '160px', maxWidth: '160px' }}>
                {document.silver_preview_items.length > 0 ? (
                  <div className="group/silver relative flex items-center justify-center gap-1.5">
                    <span className="mono inline-flex items-center gap-1 border border-slate-300 bg-slate-200 px-2 py-0.5">
                      <span className="text-xs font-black text-slate-700">Ag</span>
                      <span className="text-xs font-bold text-slate-800">
                        {sumPreviewWeight(document.silver_preview_items).toFixed(2)}
                        <span className="font-normal text-slate-500">g</span>
                      </span>
                    </span>
                    {document.silver_preview_items.length === 1 ? (
                      <span className="mono border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-black text-slate-500">
                        {formatSavedPurchasePreviewLabel(document.silver_preview_items[0])}
                      </span>
                    ) : (
                      <span className="mono text-xs font-bold text-slate-500">+{document.silver_preview_items.length}t</span>
                    )}
                    <SavedPurchaseMetalPreview
                      title="Sølv Dağılımı"
                      rows={document.silver_preview_items.map((item) => ({
                        key: `${item.line_no}-${item.type_label}`,
                        label: formatSavedPurchasePreviewLabel(item),
                        weight: Number(item.weight_grams || 0),
                      }))}
                      tone="silver"
                    />
                  </div>
                ) : (
                  <span className="text-xs italic text-brand-300">—</span>
                )}
              </td>
              <td className="mono border border-emerald-300 bg-emerald-50 px-4 py-3 text-right text-sm font-black text-emerald-900">
                {formatMoney(document.gross_amount_dkk)}
                <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                  <span className="inline-block bg-brand-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-brand-700">Banka</span>
                  <UnicontaSyncBadge
                    status={document.uniconta_sync_status}
                    invoiceNumber={document.uniconta_invoice_number}
                    error={document.uniconta_sync_error}
                  />
                </div>
              </td>
              <td className="border border-brand-200 px-2 py-2.5">
                <div className="mx-auto flex w-fit flex-nowrap items-center justify-center gap-px whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onViewDocument(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-brand-500 transition hover:border-brand-300 hover:bg-brand-100 hover:text-brand-900"
                    title="Detay Görüntüle"
                    aria-label="Detay Görüntüle"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenDocumentExcelPreview(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                    title="Excel Önizleme"
                    aria-label="Excel Önizleme"
                  >
                    <FileSpreadsheet className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onExportDocument(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-brand-700 transition hover:border-brand-300 hover:bg-brand-100 hover:text-brand-900"
                    title="Dışa Aktar"
                    aria-label="Dışa Aktar"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPrintDocument(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-blue-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    title="Yazdır"
                    aria-label="Yazdır"
                  >
                    <Printer className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={!document.customer_id}
                    onClick={() => onStartFromCustomer(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-amber-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-35"
                    title="Müşteriyle Yeni Alış Başlat"
                    aria-label="Müşteriyle Yeni Alış Başlat"
                  >
                    <UserPlus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={!document.can_edit || actionPendingSequenceNo === document.sequence_no}
                    onClick={() => onEditDocument(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-brand-500 transition hover:border-brand-300 hover:bg-brand-100 hover:text-brand-900 disabled:cursor-not-allowed disabled:opacity-35"
                    title="Düzenle"
                    aria-label="Düzenle"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={!document.can_delete || actionPendingSequenceNo === document.sequence_no}
                    onClick={() => onDeleteDocument(document)}
                    className="flex h-5 w-5 items-center justify-center border border-transparent text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-35"
                    title="Sil"
                    aria-label="Sil"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {document.uniconta_sync_status === 'failed' || document.uniconta_sync_status === 'skipped' ? (
                    <button
                      type="button"
                      disabled={retryPendingSequenceNo === document.sequence_no}
                      onClick={() => onRetryUnicontaSync(document)}
                      className="flex h-5 w-5 items-center justify-center border border-transparent text-amber-700 transition hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-35"
                      title={`Uniconta'ya tekrar gönder${document.uniconta_sync_error ? ` — ${document.uniconta_sync_error}` : ''}`}
                      aria-label="Uniconta'ya tekrar gönder"
                    >
                      {retryPendingSequenceNo === document.sequence_no ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                  {document.uniconta_sync_status === 'synced' && document.uniconta_invoice_number ? (
                    <button
                      type="button"
                      disabled={cancelPendingSequenceNo === document.sequence_no}
                      onClick={() => onCancelUnicontaInvoice(document)}
                      className="flex h-5 w-5 items-center justify-center border border-transparent text-rose-700 transition hover:border-rose-400 hover:bg-rose-50 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-35"
                      title={`Uniconta faturasını iptal et — kreditnota oluşturur (Faktura #${document.uniconta_invoice_number})`}
                      aria-label="Uniconta faturasını iptal et"
                    >
                      {cancelPendingSequenceNo === document.sequence_no ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Ban className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                  {document.uniconta_sync_status === 'cancelled' && document.uniconta_credit_note_number ? (
                    <span
                      className="flex h-5 items-center px-1.5 text-[9px] font-black uppercase tracking-widest text-rose-700"
                      title={`İptal edildi — kreditnota #${document.uniconta_credit_note_number}`}
                    >
                      KN#{document.uniconta_credit_note_number}
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function SavedPurchaseCardList({
  documents,
  listLoading,
  onViewDocument,
  onOpenDocumentExcelPreview,
  onOpenCustomer,
  onExportDocument,
  onPrintDocument,
  onStartFromCustomer,
  onEditDocument,
  onDeleteDocument,
  onRetryUnicontaSync,
  retryPendingSequenceNo,
  onCancelUnicontaInvoice,
  cancelPendingSequenceNo,
  actionPendingSequenceNo,
}: SavedPurchaseListRendererProps) {
  if (listLoading) {
    return <div className="px-4 py-10 text-center text-sm text-brand-400">Kayıtlı alışlar yükleniyor...</div>;
  }

  if (documents.length === 0) {
    return (
      <div className="px-4 py-14 text-center">
        <p className="text-sm font-semibold text-brand-400">Henüz kayıtlı alış yok</p>
        <p className="mt-1 text-xs text-brand-300">Yeni alış başlatmak için yukarıdaki butonu kullanın</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 bg-brand-50/40 p-4">
      {documents.map((document) => {
        const paymentTone = 'bg-brand-200 text-brand-700';

        return (
          <article key={document.sequence_no} className="overflow-hidden border-2 border-brand-200 bg-white shadow-[0_12px_24px_rgba(30,41,59,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-200 bg-brand-50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpenDocumentExcelPreview(document)}
                  className="group inline-flex max-w-full items-center gap-1.5 transition-colors hover:text-emerald-700"
                  title="Excel önizleme aç"
                >
                  <span className="mono truncate text-sm font-black text-brand-900 group-hover:text-emerald-800">
                    AFG #{formatAfgListNumber(document.sequence_no)}
                  </span>
                  <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-brand-300 transition-colors group-hover:text-emerald-600" />
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-500">
                  <span className="mono border border-brand-200 bg-white px-2 py-0.5">{formatDateOnly(document.issued_at)}</span>
                  <span className="mono border border-brand-200 bg-white px-2 py-0.5">{formatTimeOnly(document.issued_at)}</span>
                </div>
              </div>

              <div className="min-w-[10rem] border border-emerald-300 bg-emerald-50 px-3 py-2 text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">I alt (DKK)</p>
                <p className="mono mt-1 text-base font-black text-emerald-900">{formatMoney(document.gross_amount_dkk)}</p>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="border border-brand-200 bg-brand-50 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Müşteri</p>
                {document.customer_id ? (
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(document)}
                    className="mt-1 block max-w-full truncate text-left text-sm font-black text-brand-900 transition-colors hover:text-brand-700 hover:underline"
                    title={document.customer_name || '—'}
                  >
                    {document.customer_name || '—'}
                  </button>
                ) : (
                  <p className="mt-1 truncate text-sm font-black text-brand-900" title={document.customer_name || '—'}>
                    {document.customer_name || '—'}
                  </p>
                )}
                {document.customer_cpr || document.customer_cpr_masked ? (
                  <p className="mono mt-1 text-xs text-brand-400">{document.customer_cpr || document.customer_cpr_masked}</p>
                ) : null}
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <SavedPurchaseMetalCard tone="gold" title="Guld — Karat" rows={document.gold_preview_items} />
                <SavedPurchaseMetalCard tone="silver" title="Sølv — Lødighed" rows={document.silver_preview_items} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border border-brand-200 bg-brand-50 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-brand-500">Ödeme Tipi</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex px-2 py-1 text-[10px] font-black uppercase tracking-widest ${paymentTone}`}>
                    Banka
                  </span>
                  <UnicontaSyncBadge
                    status={document.uniconta_sync_status}
                    invoiceNumber={document.uniconta_invoice_number}
                    error={document.uniconta_sync_error}
                  />
                </div>
              </div>

              <SavedPurchaseCardActions
                document={document}
                onOpenCustomer={onOpenCustomer}
                onViewDocument={onViewDocument}
                onOpenDocumentExcelPreview={onOpenDocumentExcelPreview}
                onExportDocument={onExportDocument}
                onPrintDocument={onPrintDocument}
                onStartFromCustomer={onStartFromCustomer}
                onEditDocument={onEditDocument}
                onDeleteDocument={onDeleteDocument}
                onRetryUnicontaSync={onRetryUnicontaSync}
                retryPendingSequenceNo={retryPendingSequenceNo}
                onCancelUnicontaInvoice={onCancelUnicontaInvoice}
                cancelPendingSequenceNo={cancelPendingSequenceNo}
                actionPendingSequenceNo={actionPendingSequenceNo}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SavedPurchaseMetalCard({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: PosSavedPurchaseListItem['gold_preview_items'];
  tone: 'gold' | 'silver';
}) {
  const isGold = tone === 'gold';
  const wrapperClass = isGold ? 'border-amber-300 bg-amber-50' : 'border-slate-300 bg-slate-50';
  const titleClass = isGold ? 'text-amber-700' : 'text-slate-600';
  const totalBadgeClass = isGold
    ? 'border-amber-400 bg-amber-200 text-amber-900'
    : 'border-slate-300 bg-slate-200 text-slate-800';
  const codeBadgeClass = isGold
    ? 'border-amber-300 bg-amber-100 text-amber-700'
    : 'border-slate-300 bg-slate-100 text-slate-600';
  const totalWeight = sumPreviewWeight(rows);
  const totalLabel = rows
    .slice(0, 3)
    .map((item) => formatSavedPurchasePreviewLabel(item))
    .join(' · ');
  const extraCount = rows.length > 3 ? ` +${rows.length - 3}` : '';

  return (
    <div className={`border px-3 py-3 ${wrapperClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[10px] font-black uppercase tracking-widest ${titleClass}`}>{title}</p>
        <span className="mono text-[10px] font-black uppercase tracking-widest text-brand-400">{rows.length} satır</span>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <span className={`mono inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-black ${totalBadgeClass}`}>
              <span>{isGold ? 'Au' : 'Ag'}</span>
              <span>{totalWeight.toFixed(2)}g</span>
            </span>
            {rows.length === 1 ? (
              <span className={`mono inline-flex border px-2 py-0.5 text-xs font-black ${codeBadgeClass}`}>
                {formatSavedPurchasePreviewLabel(rows[0])}
              </span>
            ) : null}
          </div>
          <p className="mono mt-2 truncate text-xs text-brand-500" title={`${totalLabel}${extraCount}`}>
            {totalLabel}
            {extraCount}
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs italic text-brand-300">—</p>
      )}
    </div>
  );
}

function SavedPurchaseCardActions({
  document,
  onViewDocument,
  onOpenDocumentExcelPreview,
  onExportDocument,
  onPrintDocument,
  onStartFromCustomer,
  onEditDocument,
  onDeleteDocument,
  onRetryUnicontaSync,
  retryPendingSequenceNo,
  onCancelUnicontaInvoice,
  cancelPendingSequenceNo,
  actionPendingSequenceNo,
}: SavedPurchaseListActionProps & {
  document: PosSavedPurchaseListItem;
}) {
  const isEditDisabled = !document.can_edit || actionPendingSequenceNo === document.sequence_no;
  const isDeleteDisabled = !document.can_delete || actionPendingSequenceNo === document.sequence_no;
  const canRetrySync =
    document.uniconta_sync_status === 'failed' || document.uniconta_sync_status === 'skipped';
  const retryPending = retryPendingSequenceNo === document.sequence_no;
  const canCancelInvoice = document.uniconta_sync_status === 'synced' && Boolean(document.uniconta_invoice_number);
  const cancelPending = cancelPendingSequenceNo === document.sequence_no;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => onOpenDocumentExcelPreview(document)}
        className="inline-flex items-center justify-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-800"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Önizle
      </button>
      <button
        type="button"
        onClick={() => onExportDocument(document)}
        className="inline-flex items-center justify-center gap-1.5 border border-brand-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-brand-700 transition hover:border-brand-400 hover:bg-brand-100 hover:text-brand-900"
      >
        <Download className="h-3.5 w-3.5" />
        Dışa Aktar
      </button>
      <button
        type="button"
        onClick={() => onPrintDocument(document)}
        className="inline-flex items-center justify-center gap-1.5 border border-blue-300 bg-blue-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 hover:text-blue-800"
      >
        <Printer className="h-3.5 w-3.5" />
        Yazdır
      </button>
      <button
        type="button"
        onClick={() => onViewDocument(document)}
        className="inline-flex items-center justify-center gap-1.5 border border-brand-300 bg-brand-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-brand-700 transition hover:border-brand-400 hover:bg-brand-100 hover:text-brand-900"
      >
        <Eye className="h-3.5 w-3.5" />
        Detay
      </button>
      <button
        type="button"
        disabled={!document.customer_id}
        onClick={() => onStartFromCustomer(document)}
        className="inline-flex items-center justify-center gap-1.5 border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700 transition hover:border-amber-400 hover:bg-amber-100 hover:text-amber-800 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <UserPlus className="h-3.5 w-3.5" />
        Yeni Alış
      </button>
      <button
        type="button"
        disabled={isEditDisabled}
        onClick={() => onEditDocument(document)}
        className="inline-flex items-center justify-center gap-1.5 border border-brand-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-brand-700 transition hover:border-brand-400 hover:bg-brand-100 hover:text-brand-900 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Pencil className="h-3.5 w-3.5" />
        Düzenle
      </button>
      <button
        type="button"
        disabled={isDeleteDisabled}
        onClick={() => onDeleteDocument(document)}
        className={`inline-flex items-center justify-center gap-1.5 border border-rose-300 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-700 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-35 ${canRetrySync ? '' : 'sm:col-span-2'}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Sil
      </button>
      {canRetrySync ? (
        <button
          type="button"
          disabled={retryPending}
          onClick={() => onRetryUnicontaSync(document)}
          className="inline-flex items-center justify-center gap-1.5 border border-amber-400 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-800 transition hover:border-amber-500 hover:bg-amber-100 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-35"
          title={document.uniconta_sync_error || "Uniconta'ya tekrar gönder"}
        >
          {retryPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          Uniconta'ya Gönder
        </button>
      ) : null}
      {canCancelInvoice ? (
        <button
          type="button"
          disabled={cancelPending}
          onClick={() => onCancelUnicontaInvoice(document)}
          className="inline-flex items-center justify-center gap-1.5 border border-rose-400 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-800 transition hover:border-rose-500 hover:bg-rose-100 hover:text-rose-900 disabled:cursor-not-allowed disabled:opacity-35"
          title={`Uniconta faturasını iptal et — kreditnota oluşturur (Faktura #${document.uniconta_invoice_number})`}
        >
          {cancelPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
          Kreditnota
        </button>
      ) : null}
      {document.uniconta_sync_status === 'cancelled' && document.uniconta_credit_note_number ? (
        <div className="inline-flex items-center justify-center gap-1.5 border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-700 sm:col-span-2">
          <Ban className="h-3.5 w-3.5" />
          KN#{document.uniconta_credit_note_number}
        </div>
      ) : null}
    </div>
  );
}

function SavedPurchaseExcelPreview({ document }: { document: PosSavedPurchaseListItem }) {
  const allItems = [...document.gold_preview_items, ...document.silver_preview_items];

  return (
    <div className="pointer-events-none absolute left-full top-0 z-50 ml-2 w-60 border border-brand-400 bg-white shadow-xl">
      <div className="flex items-center gap-2 bg-emerald-800 px-3 py-2">
        <FileSpreadsheet className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" />
        <span className="text-xs font-black uppercase tracking-widest text-emerald-100">Excel Önizleme</span>
      </div>
      <div className="flex items-center justify-between border-b border-brand-200 bg-brand-50 px-3 py-2">
        <span className="text-xs font-black uppercase text-brand-500">AFG #{formatAfgListNumber(document.sequence_no)}</span>
        <span className="text-xs text-brand-400">{formatDateOnly(document.issued_at)}</span>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-brand-100">
            <th className="border-b border-brand-200 px-3 py-1.5 text-left font-black text-brand-600">Karat / Lødighed</th>
            <th className="border-b border-brand-200 px-3 py-1.5 text-right font-black text-brand-600">Gram</th>
          </tr>
        </thead>
        <tbody>
          {allItems.length === 0 ? (
            <tr>
              <td colSpan={2} className="px-3 py-2 text-center italic text-brand-300">
                Ürün yok
              </td>
            </tr>
          ) : (
            allItems.map((item, index) => (
              <tr key={`${item.line_no}-${item.type_label}`} className={index % 2 === 0 ? 'bg-white' : 'bg-brand-50'}>
                <td className="border-b border-brand-100 px-3 py-1.5 text-brand-700">{formatSavedPurchasePreviewLabel(item)}</td>
                <td className="mono border-b border-brand-100 px-3 py-1.5 text-right font-bold text-brand-900">
                  {Number(item.weight_grams || 0).toFixed(2)} g
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between bg-brand-900 px-3 py-2">
        <span className="text-xs font-black uppercase tracking-wider text-brand-400">Toplam</span>
        <span className="text-xs font-black text-amber-300">{Number(document.gross_amount_dkk || 0).toFixed(2)} DKK</span>
      </div>
      <div className="flex items-center gap-1.5 border-t border-emerald-200 bg-emerald-50 px-3 py-1.5">
        <FileSpreadsheet className="h-3 w-3 text-emerald-600" />
        <span className="text-[10px] font-bold text-emerald-700">Tıkla → .xlsx indir</span>
      </div>
    </div>
  );
}

function SavedPurchaseCustomerPreview({ document }: { document: PosSavedPurchaseListItem }) {
  const addressLine = [document.customer_address, document.customer_city, document.customer_postal_code].filter(Boolean).join(', ');

  return (
    <div className="w-56 border border-brand-300 bg-white shadow-lg">
      <div className="border-b border-brand-700 bg-brand-800 px-3 py-2">
        <p className="text-xs font-black uppercase tracking-widest text-brand-300">Müşteri</p>
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        <p className="text-sm font-black leading-tight text-brand-900">{document.customer_name}</p>
        {addressLine ? <p className="text-xs text-brand-500">{addressLine}</p> : null}
        {document.customer_phone ? <p className="mono text-xs text-brand-600">{document.customer_phone}</p> : null}
        {document.customer_email ? <p className="truncate text-xs text-blue-600">{document.customer_email}</p> : null}
        {document.customer_identity_doc_number ? (
          <div className="flex items-center gap-1.5 border-t border-brand-100 pt-0.5">
            <span className="text-xs font-black uppercase tracking-wider text-brand-400">Kørekort</span>
            <span className="mono text-xs text-brand-600">{document.customer_identity_doc_number}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SavedPurchaseMetalPreview({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: Array<{ key: string; label: string; weight: number }>;
  tone: 'gold' | 'silver';
}) {
  const borderClass = tone === 'gold' ? 'border-amber-400' : 'border-slate-400';
  const titleClass = tone === 'gold' ? 'border-amber-200 text-amber-700' : 'border-slate-200 text-slate-600';
  const pillClass = tone === 'gold' ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-slate-300 bg-slate-100 text-slate-600';
  const totalClass = tone === 'gold' ? 'border-amber-200 text-amber-900' : 'border-slate-200 text-slate-800';
  const hoverClass = tone === 'gold' ? 'group-hover/gold:block' : 'group-hover/silver:block';

  return (
    <div className={`absolute left-0 top-full z-50 mt-0.5 hidden w-44 border-2 bg-white p-2 shadow-lg ${hoverClass} ${borderClass}`}>
      <p className={`mb-1.5 border-b pb-1 text-xs font-black uppercase tracking-wider ${titleClass}`}>{title}</p>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between">
            <span className={`mono border px-1.5 py-0.5 text-xs font-black ${pillClass}`}>{row.label}</span>
            <span className="mono text-xs font-bold text-brand-900">{row.weight.toFixed(2)} g</span>
          </div>
        ))}
        {rows.length > 1 ? (
          <div className={`mt-1 flex items-center justify-between border-t pt-1 ${totalClass}`}>
            <span className="mono text-xs font-black">Σ Toplam</span>
            <span className="mono text-xs font-black">{rows.reduce((sum, row) => sum + row.weight, 0).toFixed(2)} g</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SavedPurchaseDetailModal({
  source,
  detail,
  loading,
  onClose,
  onEdit,
  onDelete,
  onPreview,
  onExport,
  onPrint,
  actionPending,
}: {
  source: PosSavedPurchaseListItem | null;
  detail: PosDocumentDetail | null;
  loading: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onExport: () => void;
  onPrint: () => void;
  actionPending: boolean;
}) {
  const documentWorkbookName = buildDocumentWorkbookName(source?.document_number);
  const customerAddress = [
    detail?.customer_address,
    detail?.customer_city || source?.customer_city,
    detail?.customer_postal_code || source?.customer_postal_code,
  ]
    .filter(Boolean)
    .join(', ');
  // Veri minimizasyonu: modalda tam CPR gösterilmez; yalnız doğum tarihi
  // bölümü (ilk 6 hane) ya da maskeli değer.
  const cprBirthPart = (value?: string | null) => (value || '').replace(/\D/g, '').slice(0, 6);
  const customerCpr =
    cprBirthPart(detail?.customer_cpr || source?.customer_cpr) ||
    detail?.customer_cpr_masked ||
    source?.customer_cpr_masked ||
    '—';
  const customerIdentity =
    detail?.customer_identity_doc_number ||
    source?.customer_identity_doc_number ||
    detail?.customer_identity_doc_number_masked ||
    '—';
  const lineRows = (detail?.lines || []).map((line) => {
    const metal = String(line.metal_type || '').toLowerCase();
    const isSilver = metal === 'silver';
    const label = isSilver
      ? `Gümüş — ${line.product_type || 'Sølv'}`
      : line.purity_karat
        ? `Altın ${String(line.purity_karat).includes('K') ? line.purity_karat : `${line.purity_karat}K`}`
        : line.product_type
          ? `Altın ${line.product_type}`
          : 'Altın';
    const purity = line.purity_karat || line.purity_percentage || '—';
    return {
      id: line.id,
      tone: isSilver ? 'silver' : 'gold',
      label,
      purity,
      avance: Number(line.margin_percent || 0).toFixed(2),
      gram: Number(line.weight_grams || 0).toFixed(3),
    };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto border-2 border-brand-400 bg-white shadow-2xl"
        style={sansStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b-4 border-amber-600 bg-brand-900 px-5 py-3">
          <div className="flex items-end gap-4">
            <div>
              <span className="text-xs uppercase tracking-widest text-brand-500">Afregningsbilag</span>
              <div className="text-2xl font-black text-white" style={monoStyle}>
                AFG #{detail?.document_number || '...'}
              </div>
            </div>
            <span className="pb-1 text-xs text-brand-400" style={monoStyle}>
              {detail ? formatDateOnly(detail.issued_at) : 'Yükleniyor...'}
            </span>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-brand-400 transition-colors hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading || !detail ? (
          <div className="px-6 py-10 text-center text-sm text-brand-500">Belge detayları yükleniyor...</div>
        ) : (
          <>
            <div className="space-y-5 p-5">
              <div>
                <p className="mb-2 border-b border-brand-200 pb-1 text-xs font-black uppercase tracking-widest text-brand-500">Müşteri Bilgileri</p>
                <table className="w-full border-collapse">
                  <tbody>
                  {[
                    ['Navn', detail.customer_name || '—'],
                    ['CPR nr.', customerCpr],
                    ['Tlf.', detail.customer_phone || '—'],
                    ['E-mail', detail.customer_email || '—'],
                    ['Kørekort / Pas', customerIdentity],
                    ['Adresse', customerAddress || '—'],
                  ].map(([label, value], index) => (
                    <tr key={label} className={index % 2 === 0 ? 'bg-white' : 'bg-brand-50'}>
                      <td className="w-40 border border-brand-200 bg-brand-50 px-3 py-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-brand-400">{label}</span>
                      </td>
                      <td className="border border-brand-200 px-3 py-2">
                        <span className="text-sm font-semibold text-brand-900" style={monoStyle}>
                          {value}
                        </span>
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="mb-2 border-b border-brand-200 pb-1 text-xs font-black uppercase tracking-widest text-brand-500">Ürün Detayları</p>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-brand-100">
                      <th className="border border-brand-300 px-3 py-2 text-left text-xs font-black uppercase text-brand-600">Tür</th>
                      <th className="border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase text-brand-600">Saflık</th>
                      <th className="border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase text-brand-600">Avance %</th>
                      <th className="border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase text-brand-600">Gram</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-xs italic text-brand-300">
                          Ürün kaydı yok
                        </td>
                      </tr>
                    ) : (
                      lineRows.map((line) => {
                        const isSilver = line.tone === 'silver';
                        return (
                          <tr key={line.id} className={isSilver ? 'border-b border-slate-100 bg-slate-50' : 'border-b border-amber-100 bg-amber-50'}>
                            <td className={`px-3 py-2 font-semibold ${isSilver ? 'border border-slate-200 text-slate-800' : 'border border-amber-200 text-amber-900'}`}>
                              {line.label}
                            </td>
                            <td className={`px-3 py-2 text-right ${isSilver ? 'border border-slate-200 text-slate-600' : 'border border-amber-200 text-amber-700'}`} style={monoStyle}>
                              {line.purity}
                            </td>
                            <td className={`px-3 py-2 text-right ${isSilver ? 'border border-slate-200 text-slate-600' : 'border border-amber-200 text-amber-700'}`} style={monoStyle}>
                              {line.avance}%
                            </td>
                            <td className={`px-3 py-2 text-right font-black ${isSilver ? 'border border-slate-200 text-slate-800' : 'border border-amber-200 text-amber-900'}`} style={monoStyle}>
                              {line.gram} g
                            </td>
                          </tr>
                        );
                      })
                    )}
                    <tr className="bg-brand-100">
                      <td colSpan={3} className="border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-600">NET ALIŞ</td>
                      <td className="border border-brand-300 px-3 py-2 text-right font-black text-brand-900" style={monoStyle}>{Number(detail.net_amount_dkk || 0).toFixed(2)} DKK</td>
                    </tr>
                    <tr className="bg-brand-100">
                      <td colSpan={3} className="border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-600">KDV %{Number(detail.vat_rate_percent || 0).toFixed(0)}</td>
                      <td className="border border-brand-300 px-3 py-2 text-right font-black text-brand-900" style={monoStyle}>{Number(detail.vat_amount_dkk || 0).toFixed(2)} DKK</td>
                    </tr>
                    <tr className="bg-brand-900">
                      <td colSpan={3} className="border border-brand-700 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-400">
                        ÖDENECEK / TOPLAM
                      </td>
                      <td className="border border-brand-700 px-3 py-2 text-right font-black text-amber-300" style={monoStyle}>
                        {Number(detail.gross_amount_dkk || 0).toFixed(2)} DKK
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div>
                <p className="mb-2 border-b border-brand-200 pb-1 text-xs font-black uppercase tracking-widest text-brand-500">Ödeme Bilgileri</p>
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td className="w-40 border border-brand-200 bg-brand-50 px-3 py-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-brand-400">Ödeme Şekli</span>
                      </td>
                      <td className="border border-brand-200 px-3 py-2">
                        <span className="inline-flex border border-blue-400 bg-blue-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-blue-800">
                          Bankoverførsel — Havale
                        </span>
                      </td>
                    </tr>
                    <tr className="bg-brand-50">
                      <td className="w-40 border border-brand-200 bg-brand-50 px-3 py-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-brand-400">Reg.nr.</span>
                      </td>
                      <td className="border border-brand-200 px-3 py-2 text-sm text-brand-700" style={monoStyle}>
                        {detail?.bank_reg_number || '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="w-40 border border-brand-200 bg-brand-50 px-3 py-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-brand-400">Kontonr.</span>
                      </td>
                      <td className="border border-brand-200 px-3 py-2 text-sm text-brand-700" style={monoStyle}>
                        {detail?.bank_account_number || '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between border-t-2 border-brand-200 bg-brand-50 px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  {documentWorkbookName}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onPreview}
                  className="flex h-8 w-8 items-center justify-center border border-transparent text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                  title="Excel Önizleme"
                  aria-label="Excel Önizleme"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onExport}
                  className="flex h-8 w-8 items-center justify-center border border-transparent text-brand-700 transition hover:border-brand-300 hover:bg-brand-100 hover:text-brand-900"
                  title="Dışa Aktar"
                  aria-label="Dışa Aktar"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  className="flex h-8 w-8 items-center justify-center border border-transparent text-blue-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
                  title="Yazdır"
                  aria-label="Yazdır"
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center border border-transparent text-brand-500 transition hover:border-brand-300 hover:bg-brand-100 hover:text-brand-900"
                  title="Kapat"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={!detail?.can_delete || actionPending}
                  className="flex h-8 w-8 items-center justify-center border border-transparent text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-35"
                  title="Sil"
                  aria-label="Sil"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onEdit}
                  disabled={!detail?.can_edit || actionPending}
                  className="flex h-8 w-8 items-center justify-center border border-transparent text-brand-800 transition hover:border-brand-300 hover:bg-brand-100 hover:text-brand-900 disabled:cursor-not-allowed disabled:opacity-35"
                  title="Düzenle"
                  aria-label="Düzenle"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
