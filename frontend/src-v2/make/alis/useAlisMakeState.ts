import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { getAccessToken } from '@/lib/auth';
import { apiRequest, buildWsUrl, downloadAuthedDocument, fetchAuthedPdfBlob, openAuthedDocument } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { emitArtifactSync, listenArtifactSync, signalMatches } from '@/lib/artifactSync';
import { openOfficeDock } from '@/lib/officeDock';
import type {
  CustomerOut,
  PaginatedResponse,
  PosDocumentDetail,
  PosSavedPurchaseListItem,
  PosWorkspace,
  PosWorkspaceBankInfo,
  PosWorkspaceCalculatorRow,
  PosWorkspaceCalculators,
  PosWorkspaceFinalizeResponse,
  PosWorkspaceGoldRow,
  PosWorkspaceInvoiceGoldRow,
  PosWorkspaceInvoiceMiscRow,
  PosWorkspaceMarketRates,
  PosWorkspaceNumbering,
  PosWorkspaceSilverRow,
  OfficeRuntimeStatus,
} from '@/types';

import type { AlisPageProps } from './AlisPage';
import type {
  CompanionMode,
  EditableCustomer,
  EditableCalculatorRow,
  EditableGoldRow,
  EditableInvoiceGoldRow,
  EditableInvoiceMiscRow,
  EditableSilverRow,
  EditableWorkspaceNumbering,
  PaymentMethod,
  WorkspaceSurfaceView,
} from './types';

const EMPTY_CUSTOMER: EditableCustomer = {
  name: '',
  email: '',
  phone: '',
  address: '',
  postal_code: '',
  city: '',
  cpr_number: '',
  identity_doc_number: '',
};

const EMPTY_BANK_INFO: PosWorkspaceBankInfo = {
  reg_number: '',
  account_number: '',
};

const PAYMENT_METHOD_STORAGE_KEY = 'sero_alis_payment_method';
const AUTOSAVE_DEBOUNCE_MS = 200;
const PREVIEW_DEBOUNCE_MS = 120;
const INVOICE_GOLD_AUTO_ROW_COUNT = 13;
const INVOICE_MISC_AUTO_ROW_COUNT = 15;
const DEFAULT_MARKET_FX = '7.45';

function parseDecimalValue(value: string | number | null | undefined) {
  const numeric = Number(normalizeTextInput(String(value ?? '0')));
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildDefaultGoldRatesEur(gold24Dkk: string, fx: string) {
  const gold24 = parseDecimalValue(gold24Dkk);
  const exchangeRate = parseDecimalValue(fx) || 1;
  const gold24Eur = gold24 / exchangeRate;
  const defs = [
    ['8', 8],
    ['14', 14],
    ['18', 18],
    ['21', 21],
    ['21.6', 21.6],
    ['22', 22],
    ['24', 24],
  ] as const;
  return Object.fromEntries(defs.map(([key, karat]) => [key, (gold24Eur * karat) / 24])) as Record<string, number>;
}

function buildDefaultSilverRatesEur(silverDkk: string, fx: string) {
  const silver999 = parseDecimalValue(silverDkk);
  const exchangeRate = parseDecimalValue(fx) || 1;
  const silver999Eur = silver999 / exchangeRate;
  const defs = [
    ['999', 0.999],
    ['925', 0.925],
    ['830', 0.83],
    ['800', 0.8],
  ] as const;
  return Object.fromEntries(defs.map(([key, ratio]) => [key, silver999Eur * ratio])) as Record<string, number>;
}

function buildDefaultMarketRates(gold24Dkk: string, silverDkk: string, fx = DEFAULT_MARKET_FX): PosWorkspaceMarketRates {
  const goldRates = buildDefaultGoldRatesEur(gold24Dkk, fx);
  const silverRates = buildDefaultSilverRatesEur(silverDkk, fx);
  const exchangeRate = parseDecimalValue(fx) || 1;
  return {
    eur_dkk_fx: fx,
    gold_24k_dkk: gold24Dkk,
    silver_dkk: silverDkk,
    gold_rates_eur: Object.fromEntries(Object.entries(goldRates).map(([key, value]) => [key, value.toFixed(4)])),
    silver_rates_eur: Object.fromEntries(Object.entries(silverRates).map(([key, value]) => [key, value.toFixed(4)])),
    gold_matrix: [
      { row_key: 'gold:8', label: '8K', lodighed: '333', eur_per_gram: goldRates['8'].toFixed(4), dkk_per_gram: (goldRates['8'] * exchangeRate).toFixed(2), karat: '8.00', type_code: '1' },
      { row_key: 'gold:14', label: '14K', lodighed: '585', eur_per_gram: goldRates['14'].toFixed(4), dkk_per_gram: (goldRates['14'] * exchangeRate).toFixed(2), karat: '14.00', type_code: '1' },
      { row_key: 'gold:18', label: '18K', lodighed: '750', eur_per_gram: goldRates['18'].toFixed(4), dkk_per_gram: (goldRates['18'] * exchangeRate).toFixed(2), karat: '18.00', type_code: '1' },
      { row_key: 'gold:21', label: '21K', lodighed: '875', eur_per_gram: goldRates['21'].toFixed(4), dkk_per_gram: (goldRates['21'] * exchangeRate).toFixed(2), karat: '21.00', type_code: '1' },
      { row_key: 'gold:21.6', label: '21.6K', lodighed: '900', eur_per_gram: goldRates['21.6'].toFixed(4), dkk_per_gram: (goldRates['21.6'] * exchangeRate).toFixed(2), karat: '21.60', type_code: '1' },
      { row_key: 'gold:22', label: '22K', lodighed: '917', eur_per_gram: goldRates['22'].toFixed(4), dkk_per_gram: (goldRates['22'] * exchangeRate).toFixed(2), karat: '22.00', type_code: '1' },
      { row_key: 'gold:24', label: '24K', lodighed: '999', eur_per_gram: goldRates['24'].toFixed(4), dkk_per_gram: (goldRates['24'] * exchangeRate).toFixed(2), karat: '24.00', type_code: '1' },
    ],
    silver_matrix: [
      { row_key: 'silver:2', label: 'Finsølv', lodighed: '999', eur_per_gram: silverRates['999'].toFixed(4), dkk_per_gram: (silverRates['999'] * exchangeRate).toFixed(2), karat: null, type_code: '2' },
      { row_key: 'silver:3', label: 'Sterling sølv', lodighed: '925', eur_per_gram: silverRates['925'].toFixed(4), dkk_per_gram: (silverRates['925'] * exchangeRate).toFixed(2), karat: null, type_code: '3' },
      { row_key: 'silver:4', label: '3 tårnet sølv', lodighed: '830', eur_per_gram: silverRates['830'].toFixed(4), dkk_per_gram: (silverRates['830'] * exchangeRate).toFixed(2), karat: null, type_code: '4' },
      { row_key: 'silver:5', label: 'Sølv', lodighed: '800', eur_per_gram: silverRates['800'].toFixed(4), dkk_per_gram: (silverRates['800'] * exchangeRate).toFixed(2), karat: null, type_code: '5' },
    ],
  };
}

function normalizeMarketRatesInput(marketRates: PosWorkspaceMarketRates): PosWorkspaceMarketRates {
  return {
    ...buildDefaultMarketRates(marketRates.gold_24k_dkk || '2850', marketRates.silver_dkk || '8.5', marketRates.eur_dkk_fx || DEFAULT_MARKET_FX),
    ...marketRates,
  };
}

function toEditableCalculatorRows(rows: PosWorkspaceCalculatorRow[]): EditableCalculatorRow[] {
  return rows.map((row) => ({
    row_key: row.row_key,
    unit_weight: row.unit_weight,
    count: row.count,
    total_weight: row.total_weight,
    target_row_key: row.target_row_key || '',
  }));
}

function normalizeRateKey(value: string | number | null | undefined) {
  const numeric = parseDecimalValue(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return String(numeric);
}

function readStoredMarketRate(key: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw || fallback;
  } catch {
    return fallback;
  }
}

function normalizeTextInput(value: string): string {
  return value.replace(',', '.');
}

function readStoredPaymentMethod(): PaymentMethod {
  if (typeof window === 'undefined') return 'bank';
  try {
    return window.localStorage.getItem(PAYMENT_METHOD_STORAGE_KEY) === 'cash' ? 'cash' : 'bank';
  } catch {
    return 'bank';
  }
}

function workspaceRowsPayload(
  goldRows: EditableGoldRow[],
  silverRows: EditableSilverRow[],
  bankInfo: PosWorkspaceBankInfo,
  marketRates: PosWorkspaceMarketRates,
  afgNote: string,
  calculators: PosWorkspaceCalculators,
  paymentMethod: PaymentMethod,
  numbering: EditableWorkspaceNumbering,
  invoiceGoldMode: CompanionMode,
  invoiceGoldRows: EditableInvoiceGoldRow[],
  invoiceGoldFooterLines: string[],
  invoiceMiscMode: CompanionMode,
  invoiceMiscRows: EditableInvoiceMiscRow[],
) {
  return {
    gold_rows: goldRows.map((row) => ({
      karat: Number(row.karat),
      gram: Number(normalizeTextInput(row.gram || '0')),
      avance_percent: Number(normalizeTextInput(row.avance_percent || '0')),
    })),
    silver_rows: silverRows.map((row) => ({
      type_code: row.type_code,
      gram: Number(normalizeTextInput(row.gram || '0')),
      avance_percent: Number(normalizeTextInput(row.avance_percent || '0')),
    })),
    bank_info: {
      reg_number: bankInfo.reg_number || '',
      account_number: bankInfo.account_number || '',
    },
    market_rates: {
      eur_dkk_fx: Number(normalizeTextInput(marketRates.eur_dkk_fx || DEFAULT_MARKET_FX)),
      gold_24k_dkk: Number(normalizeTextInput(marketRates.gold_24k_dkk || '0')),
      silver_dkk: Number(normalizeTextInput(marketRates.silver_dkk || '0')),
      gold_rates_eur: Object.fromEntries(
        Object.entries(marketRates.gold_rates_eur || {}).map(([key, value]) => [key, Number(normalizeTextInput(value || '0'))]),
      ),
      silver_rates_eur: Object.fromEntries(
        Object.entries(marketRates.silver_rates_eur || {}).map(([key, value]) => [key, Number(normalizeTextInput(value || '0'))]),
      ),
    },
    afg_note: afgNote.trim() || null,
    calculators: {
      gold_rows: calculators.gold_rows.map((row) => ({
        row_key: row.row_key,
        unit_weight: Number(normalizeTextInput(row.unit_weight || '0')),
        count: Number(normalizeTextInput(row.count || '0')),
        target_row_key: row.target_row_key || null,
      })),
      silver_rows: calculators.silver_rows.map((row) => ({
        row_key: row.row_key,
        unit_weight: Number(normalizeTextInput(row.unit_weight || '0')),
        count: Number(normalizeTextInput(row.count || '0')),
        target_row_key: row.target_row_key || null,
      })),
    },
    payment_method: paymentMethod,
    numbering: {
      afregnings_number_next: numbering.afregnings_number_next.trim(),
      invoice_number_next: numbering.invoice_number_next.trim(),
    },
    invoice_gold_mode: invoiceGoldMode,
    invoice_gold: {
      rows: invoiceGoldRows.map((row) => ({
        row_key: row.row_key,
        code: row.code.trim() || null,
        fineness: row.fineness.trim() || null,
        gram: Number(normalizeTextInput(row.gram || '0')),
      })),
      footer_lines: invoiceGoldFooterLines.map((line) => line.trim()),
    },
    invoice_misc_mode: invoiceMiscMode,
    invoice_misc: {
      rows: invoiceMiscRows.map((row) => ({
        row_key: row.row_key,
        text: row.text.trim() || null,
        quantity: row.quantity.trim() ? Number(normalizeTextInput(row.quantity)) : null,
        unit_price_dkk: Number(normalizeTextInput(row.unit_price_dkk || '0')),
      })),
    },
  };
}

function toEditableCustomer(workspace: PosWorkspace): EditableCustomer {
  return {
    name: workspace.customer.name || '',
    email: workspace.customer.email || '',
    phone: workspace.customer.phone || '',
    address: workspace.customer.address || '',
    postal_code: workspace.customer.postal_code || '',
    city: workspace.customer.city || '',
    cpr_number: workspace.customer.cpr_number || '',
    identity_doc_number: workspace.customer.identity_doc_number || '',
  };
}

function hasEditableCustomerData(customer: EditableCustomer) {
  return Boolean(
    customer.name.trim() ||
      customer.email.trim() ||
      customer.phone.trim() ||
      customer.address.trim() ||
      customer.postal_code.trim() ||
      customer.city.trim() ||
      customer.cpr_number.trim() ||
      customer.identity_doc_number.trim(),
  );
}

function customerRequestPayload(customer: EditableCustomer) {
  return {
    name: customer.name.trim() || null,
    email: customer.email.trim() || null,
    phone: customer.phone.trim() || null,
    address: customer.address.trim() || null,
    postal_code: customer.postal_code.trim() || null,
    city: customer.city.trim() || null,
    cpr_number: customer.cpr_number.trim() || null,
    identity_doc_number: customer.identity_doc_number.trim() || null,
  };
}

function toEditableGoldRows(rows: PosWorkspaceGoldRow[]): EditableGoldRow[] {
  return rows.map((row) => ({
    row_key: row.row_key,
    karat: row.karat,
    label: row.label,
    lodighed: row.lodighed,
    purity_percentage: row.purity_percentage,
    gram: row.gram,
    avance_percent: row.avance_percent,
    rate_dkk: row.rate_dkk,
    unit_price_dkk: row.unit_price_dkk,
    line_total_dkk: row.line_total_dkk,
  }));
}

function toEditableSilverRows(rows: PosWorkspaceSilverRow[]): EditableSilverRow[] {
  return rows.map((row) => ({
    row_key: row.row_key,
    type_code: row.type_code,
    label: row.label,
    lodighed: row.lodighed,
    purity_percentage: row.purity_percentage,
    gram: row.gram,
    avance_percent: row.avance_percent,
    rate_dkk: row.rate_dkk,
    unit_price_dkk: row.unit_price_dkk,
    line_total_dkk: row.line_total_dkk,
  }));
}

function toEditableNumbering(numbering: PosWorkspaceNumbering): EditableWorkspaceNumbering {
  return {
    afregnings_number_next: numbering.afregnings_number_next || '',
    invoice_number_next: numbering.invoice_number_next || '',
  };
}

function toEditableInvoiceGoldRows(rows: PosWorkspaceInvoiceGoldRow[]): EditableInvoiceGoldRow[] {
  return rows.map((row) => ({
    row_key: row.row_key,
    code: row.code || '',
    label: row.label || '',
    fineness: row.fineness || '',
    lodighed: row.lodighed || '',
    gram: row.gram,
    unit_price_dkk: row.unit_price_dkk,
    line_total_dkk: row.line_total_dkk,
  }));
}

function toEditableInvoiceMiscRows(rows: PosWorkspaceInvoiceMiscRow[]): EditableInvoiceMiscRow[] {
  return rows.map((row) => ({
    row_key: row.row_key,
    text: row.text || '',
    quantity: row.quantity || '',
    unit_price_dkk: row.unit_price_dkk,
    line_total_dkk: row.line_total_dkk,
  }));
}

function formatWorkspaceKaratValue(value: string) {
  const numeric = Number(normalizeTextInput(value || '0'));
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const fixed = numeric.toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function buildDefaultInvoiceGoldRows(): EditableInvoiceGoldRow[] {
  return Array.from({ length: INVOICE_GOLD_AUTO_ROW_COUNT }, (_, index) => ({
    row_key: `invoice_gold:${index + 1}`,
    code: '',
    label: '',
    fineness: '',
    lodighed: '',
    gram: '0.00',
    unit_price_dkk: '0.00',
    line_total_dkk: '0.00',
  }));
}

function buildDefaultInvoiceMiscRows(): EditableInvoiceMiscRow[] {
  return Array.from({ length: INVOICE_MISC_AUTO_ROW_COUNT }, (_, index) => ({
    row_key: `invoice_misc:${index + 1}`,
    text: '',
    quantity: '',
    unit_price_dkk: '0.00',
    line_total_dkk: '0.00',
  }));
}

function buildAutoInvoiceGoldRows(
  goldRows: EditableGoldRow[],
  silverRows: EditableSilverRow[],
  existingRows: EditableInvoiceGoldRow[] = [],
): EditableInvoiceGoldRow[] {
  const defaults = (existingRows.length > 0 ? existingRows : buildDefaultInvoiceGoldRows()).map((row) => ({
    ...row,
    code: '',
    label: '',
    fineness: '',
    lodighed: '',
    gram: '0.00',
    unit_price_dkk: '0.00',
    line_total_dkk: '0.00',
  }));

  const generated: Array<Pick<EditableInvoiceGoldRow, 'code' | 'label' | 'fineness' | 'lodighed' | 'gram'>> = [];
  for (const row of goldRows) {
    if (toNumeric(row.gram) <= 0) continue;
    generated.push({
      code: '1',
      label: 'Guld',
      fineness: formatWorkspaceKaratValue(row.karat),
      lodighed: row.lodighed,
      gram: quantize2(toNumeric(row.gram)),
    });
  }
  for (const row of silverRows) {
    if (toNumeric(row.gram) <= 0) continue;
    generated.push({
      code: row.type_code,
      label: row.label,
      fineness: row.lodighed,
      lodighed: row.lodighed,
      gram: quantize2(toNumeric(row.gram)),
    });
  }

  return defaults.map((row, index) => {
    const generatedRow = generated[index];
    if (!generatedRow) return row;
    return {
      ...row,
      ...generatedRow,
    };
  });
}

function previewGoldRowsPayload(rows: EditableGoldRow[]) {
  return rows.map((row) => ({
    row_key: row.row_key,
    karat: normalizeTextInput(row.karat || '0'),
    label: row.label,
    lodighed: row.lodighed,
    purity_percentage: normalizeTextInput(row.purity_percentage || '0'),
    gram: normalizeTextInput(row.gram || '0'),
    avance_percent: normalizeTextInput(row.avance_percent || '0'),
    rate_dkk: normalizeTextInput(row.rate_dkk || '0'),
    unit_price_dkk: normalizeTextInput(row.unit_price_dkk || '0'),
    line_total_dkk: normalizeTextInput(row.line_total_dkk || '0'),
  }));
}

function previewSilverRowsPayload(rows: EditableSilverRow[]) {
  return rows.map((row) => ({
    row_key: row.row_key,
    type_code: row.type_code,
    label: row.label,
    lodighed: row.lodighed,
    purity_percentage: normalizeTextInput(row.purity_percentage || '0'),
    gram: normalizeTextInput(row.gram || '0'),
    avance_percent: normalizeTextInput(row.avance_percent || '0'),
    rate_dkk: normalizeTextInput(row.rate_dkk || '0'),
    unit_price_dkk: normalizeTextInput(row.unit_price_dkk || '0'),
    line_total_dkk: normalizeTextInput(row.line_total_dkk || '0'),
  }));
}

function toNumeric(value: string | number | null | undefined) {
  return Number(normalizeTextInput(String(value ?? '0'))) || 0;
}

function quantize2(value: number) {
  return value.toFixed(2);
}

async function openExcelPreviewRoute(route: string, title: string) {
  const parts = route.split('/').filter(Boolean);
  if (parts[0] === 'office-document' && parts[1] && parts[2]) {
    openOfficeDock({
      kind: parts[1],
      key: parts[2],
      title,
      source: 'alis-ui',
    });
  }
}

function computedPreviewGoldRowsPayload(rows: EditableGoldRow[], marketRates: PosWorkspaceMarketRates) {
  const fx = toNumeric(marketRates.eur_dkk_fx) || 1;
  return rows.map((row) => {
    const liveRate = toNumeric(marketRates.gold_rates_eur?.[normalizeRateKey(row.karat)]) * fx;
    const purity = toNumeric(row.purity_percentage);
    const gram = toNumeric(row.gram);
    const avance = toNumeric(row.avance_percent);
    const unitPrice = liveRate * (purity / 100) * (1 - avance / 100);
    const lineTotal = unitPrice * gram;
    return {
      ...previewGoldRowsPayload([row])[0],
      rate_dkk: quantize2(liveRate),
      unit_price_dkk: quantize2(unitPrice),
      line_total_dkk: quantize2(lineTotal),
    };
  });
}

function computedPreviewSilverRowsPayload(rows: EditableSilverRow[], marketRates: PosWorkspaceMarketRates) {
  const fx = toNumeric(marketRates.eur_dkk_fx) || 1;
  return rows.map((row) => {
    const liveRate = toNumeric(marketRates.silver_rates_eur?.[normalizeRateKey(row.lodighed)]) * fx;
    const purity = toNumeric(row.purity_percentage);
    const gram = toNumeric(row.gram);
    const avance = toNumeric(row.avance_percent);
    const unitPrice = liveRate * (purity / 100) * (1 - avance / 100);
    const lineTotal = unitPrice * gram;
    return {
      ...previewSilverRowsPayload([row])[0],
      rate_dkk: quantize2(liveRate),
      unit_price_dkk: quantize2(unitPrice),
      line_total_dkk: quantize2(lineTotal),
    };
  });
}

export function useAlisMakeState(): AlisPageProps {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [workspace, setWorkspace] = useState<PosWorkspace | null>(null);
  const [draftWorkspace, setDraftWorkspace] = useState<PosWorkspace | null>(null);
  const [pdfState, setPdfState] = useState<{ url: string | null; filename: string; loading: boolean; error: string | null }>({
    url: null,
    filename: '',
    loading: false,
    error: null,
  });
  const [detailPurchase, setDetailPurchase] = useState<PosSavedPurchaseListItem | null>(null);
  const [actionSequenceNo, setActionSequenceNo] = useState<number | null>(null);
  const [purchaseSearchTerm, setPurchaseSearchTerm] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [customerMode, setCustomerMode] = useState<'existing' | 'new' | null>(null);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [newCustomer, setNewCustomer] = useState<EditableCustomer>(EMPTY_CUSTOMER);
  const [customerForm, setCustomerForm] = useState<EditableCustomer>(EMPTY_CUSTOMER);
  const [goldRows, setGoldRows] = useState<EditableGoldRow[]>([]);
  const [silverRows, setSilverRows] = useState<EditableSilverRow[]>([]);
  const [activeWorkspaceView, setActiveWorkspaceViewState] = useState<WorkspaceSurfaceView>('system');
  const [numbering, setNumbering] = useState<EditableWorkspaceNumbering>({
    afregnings_number_next: '',
    invoice_number_next: '',
  });
  const [invoiceGoldMode, setInvoiceGoldMode] = useState<CompanionMode>('auto');
  const [invoiceGoldRows, setInvoiceGoldRows] = useState<EditableInvoiceGoldRow[]>([]);
  const [invoiceGoldFooterLines, setInvoiceGoldFooterLines] = useState<string[]>(['', '', '']);
  const [invoiceMiscMode, setInvoiceMiscMode] = useState<CompanionMode>('auto');
  const [invoiceMiscRows, setInvoiceMiscRows] = useState<EditableInvoiceMiscRow[]>([]);
  const [bankInfo, setBankInfo] = useState<PosWorkspaceBankInfo>(EMPTY_BANK_INFO);
  const [marketRates, setMarketRates] = useState<PosWorkspaceMarketRates>(() =>
    normalizeMarketRatesInput(
      buildDefaultMarketRates(
        readStoredMarketRate('market_gold', '2850'),
        readStoredMarketRate('market_silver', '8.5'),
        readStoredMarketRate('market_fx', DEFAULT_MARKET_FX),
      ),
    ),
  );
  const [afgNote, setAfgNote] = useState('');
  const [calculators, setCalculators] = useState<PosWorkspaceCalculators>({ gold_rows: [], silver_rows: [] });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(readStoredPaymentMethod);
  const [priceOpen, setPriceOpen] = useState(false);
  const goldRowsRef = useRef<EditableGoldRow[]>([]);
  const silverRowsRef = useRef<EditableSilverRow[]>([]);

  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: ['office-runtime-status', 'alis-workspace'],
      queryFn: () => apiRequest<OfficeRuntimeStatus>('/api/v2/office-runtime/status?kind=alis-workspace'),
      staleTime: 30_000,
    });
  }, [queryClient]);
  const autosaveKeyRef = useRef('');
  const customerAutosaveKeyRef = useRef('');
  const initializedSessionRef = useRef<string | null>(null);
  const pendingPaymentMethodRef = useRef<PaymentMethod | null>(null);
  const queuedSectionsPayloadRef = useRef<ReturnType<typeof workspaceRowsPayload> | null>(null);
  const queuedCustomerPayloadRef = useRef<EditableCustomer | null>(null);
  const sectionsSaveInFlightRef = useRef(false);
  const customerSaveInFlightRef = useRef(false);
  const clerkPreviewSocketRef = useRef<WebSocket | null>(null);
  const clerkPreviewReconnectRef = useRef<number | null>(null);
  const pendingPreviewPayloadRef = useRef<Record<string, unknown> | null>(null);
  const previewSequenceRef = useRef(0);

  function emitWorkspaceArtifactSync(sessionId: string, source: string) {
    emitArtifactSync({
      kind: 'alis-workspace',
      key: sessionId,
      source,
    });
  }

  const workspaceQuery = useQuery({
    queryKey: ['pos', 'workspace', 'open-draft'],
    queryFn: () => apiRequest<PosWorkspace | null>('/api/v2/alis/workspace/open-draft'),
  });

  const customersQuery = useQuery({
    queryKey: ['customers', 'search', customerSearchTerm],
    enabled: customerSearchTerm.trim().length >= 2,
    queryFn: () => apiRequest<CustomerOut[]>(`/api/customers/search?q=${encodeURIComponent(customerSearchTerm.trim())}`),
  });

  const recentCustomersQuery = useQuery({
    queryKey: ['customers', 'recent', 'purchase-workspace'],
    queryFn: () => apiRequest<PaginatedResponse<CustomerOut>>('/api/customers?page_size=100'),
  });

  const savedPurchasesQuery = useQuery({
    queryKey: ['pos', 'alis', 'list', purchaseSearchTerm, purchaseDate],
    queryFn: () =>
      apiRequest<PosSavedPurchaseListItem[]>(
        `/api/v2/alis/list?limit=120${purchaseSearchTerm.trim() ? `&q=${encodeURIComponent(purchaseSearchTerm.trim())}` : ''}${purchaseDate ? `&date=${encodeURIComponent(purchaseDate)}` : ''}`,
      ),
  });

  const detailDocumentQuery = useQuery({
    queryKey: ['pos', 'alis', 'document', detailPurchase?.sequence_no],
    enabled: detailPurchase !== null,
    queryFn: () => apiRequest<PosDocumentDetail>(`/api/v2/alis/documents/${detailPurchase?.sequence_no}`),
  });

  function applyWorkspace(
    data: PosWorkspace,
    options?: {
      paymentMethodOverride?: PaymentMethod;
    },
  ) {
    initializedSessionRef.current = data.session.id;
    const editableCustomer = toEditableCustomer(data);
    const hasDraftCustomerShadow = !data.customer.customer_id && hasEditableCustomerData(editableCustomer);
    setCustomerForm(editableCustomer);
    setNewCustomer(hasDraftCustomerShadow ? editableCustomer : EMPTY_CUSTOMER);
    setGoldRows(toEditableGoldRows(data.gold_rows));
    setSilverRows(toEditableSilverRows(data.silver_rows));
    setNumbering(toEditableNumbering(data.numbering_preview));
    setInvoiceGoldMode(data.invoice_gold_mode);
    setInvoiceGoldRows(toEditableInvoiceGoldRows(data.invoice_gold.rows));
    setInvoiceGoldFooterLines([...data.invoice_gold.footer_lines, '', '', ''].slice(0, 3));
    setInvoiceMiscMode(data.invoice_misc_mode);
    setInvoiceMiscRows(toEditableInvoiceMiscRows(data.invoice_misc.rows));
    const resolvedBankInfo = {
      reg_number: data.bank_info.reg_number || '',
      account_number: data.bank_info.account_number || '',
    };
    setBankInfo(resolvedBankInfo);
    setMarketRates(normalizeMarketRatesInput(data.market_rates));
    setAfgNote(data.afg_note || '');
    setCalculators(data.calculators);
    const resolvedPaymentMethod = options?.paymentMethodOverride || data.payment_method || readStoredPaymentMethod();
    setPaymentMethod(resolvedPaymentMethod);
    setCustomerMode(hasDraftCustomerShadow ? 'new' : null);
    autosaveKeyRef.current = JSON.stringify(
      workspaceRowsPayload(
        toEditableGoldRows(data.gold_rows),
        toEditableSilverRows(data.silver_rows),
        resolvedBankInfo,
        normalizeMarketRatesInput(data.market_rates),
        data.afg_note || '',
        data.calculators,
        resolvedPaymentMethod,
        toEditableNumbering(data.numbering_preview),
        data.invoice_gold_mode,
        toEditableInvoiceGoldRows(data.invoice_gold.rows),
        [...data.invoice_gold.footer_lines, '', '', ''].slice(0, 3),
        data.invoice_misc_mode,
        toEditableInvoiceMiscRows(data.invoice_misc.rows),
      ),
    );
    customerAutosaveKeyRef.current = JSON.stringify(editableCustomer);
  }

  function activateWorkspace(
    data: PosWorkspace,
    options?: {
      paymentMethodOverride?: PaymentMethod;
    },
  ) {
    queuedSectionsPayloadRef.current = null;
    queuedCustomerPayloadRef.current = null;
    const paymentOverride = options?.paymentMethodOverride ?? pendingPaymentMethodRef.current ?? undefined;
    setWorkspace(data);
    setDraftWorkspace(null);
    setActiveWorkspaceViewState('system');
    applyWorkspace(data, {
      paymentMethodOverride: paymentOverride,
    });
    pendingPaymentMethodRef.current = null;
    setCustomerSearchTerm('');
  }

  const openWorkspaceMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest<PosWorkspace>('/api/v2/alis/workspace', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: async (data) => {
      activateWorkspace(data);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
      ]);
    },
  });

  const editDocumentMutation = useMutation({
    mutationFn: (sequenceNo: number) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/documents/${sequenceNo}/edit`, {
        method: 'POST',
      }),
    onSuccess: async (data) => {
      setActionSequenceNo(null);
      setDetailPurchase(null);
      activateWorkspace(data);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'workspace', 'open-draft'] }),
      ]);
    },
    onError: (error) => {
      setActionSequenceNo(null);
      toast.error('Belge düzenleme açılamadı', error instanceof Error ? error.message : undefined);
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: (sequenceNo: number) =>
      apiRequest(`/api/v2/alis/documents/${sequenceNo}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      setActionSequenceNo(null);
      setDetailPurchase(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'workspace', 'open-draft'] }),
      ]);
    },
    onError: (error) => {
      setActionSequenceNo(null);
      toast.error('Belge iptal edilemedi', error instanceof Error ? error.message : undefined);
    },
  });

  const retryUnicontaSyncMutation = useMutation({
    mutationFn: (sequenceNo: number) =>
      apiRequest<{
        ok: boolean;
        message?: string | null;
        idempotent?: boolean;
        uniconta_sync_status?: string | null;
        uniconta_invoice_number?: string | null;
        uniconta_sync_error?: string | null;
      }>(`/api/v2/uniconta/invoice/from-pos/${sequenceNo}`, {
        method: 'POST',
      }),
    onSuccess: (result) => {
      if (result?.idempotent) {
        toast.info(
          'Zaten senkronize',
          result.uniconta_invoice_number
            ? `Bu belge daha önce Uniconta'ya gönderilmiş (fatura no: ${result.uniconta_invoice_number}). Tekrar göndermek için force gerekir.`
            : 'Bu belge daha önce senkronize edilmiş.',
        );
      } else if (result?.ok) {
        toast.success(
          'Uniconta sync başarılı',
          result.uniconta_invoice_number ? `Fatura no: ${result.uniconta_invoice_number}` : undefined,
        );
      } else {
        toast.warning(
          'Uniconta sync tamamlanamadı',
          result?.uniconta_sync_error || result?.message || undefined,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['uniconta', 'invoices'] });
      // M2 — cross-module: uniconta retry alış listesinin sync_status'unu değiştirir
      emitArtifactSync({ kind: 'uniconta', key: 'live', source: 'alis-ui' });
    },
    onError: (error) => {
      toast.error('Uniconta sync hatası', error instanceof Error ? error.message : undefined);
    },
  });

  const handleRetryUnicontaSync = (item: PosSavedPurchaseListItem) => {
    if (retryUnicontaSyncMutation.isPending) return;
    retryUnicontaSyncMutation.mutate(item.sequence_no);
  };

  const selectCustomerMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/customer/select`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      setWorkspace(data);
      applyWorkspace(data);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui');
      setCustomerSearchTerm('');
      setNewCustomer(EMPTY_CUSTOMER);
      setCustomerMode(null);
    },
  });

  const updateDraftCustomerMutation = useMutation({
    mutationFn: (payload: EditableCustomer) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/draft-customer`, {
        method: 'PUT',
        body: JSON.stringify(customerRequestPayload(payload)),
      }),
    onSuccess: (data, payload) => {
      if (initializedSessionRef.current !== data.session.id) return;
      setWorkspace(data);
      applyWorkspace(data);
      customerAutosaveKeyRef.current = JSON.stringify(payload);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui');
    },
  });

  const updateSectionsMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof workspaceRowsPayload>) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/rows`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data, payload) => {
      if (initializedSessionRef.current !== data.session.id) return;
      setWorkspace(data);
      setGoldRows(toEditableGoldRows(data.gold_rows));
      setSilverRows(toEditableSilverRows(data.silver_rows));
      setNumbering(toEditableNumbering(data.numbering_preview));
      setInvoiceGoldMode(data.invoice_gold_mode);
      setInvoiceGoldRows(toEditableInvoiceGoldRows(data.invoice_gold.rows));
      setInvoiceGoldFooterLines([...data.invoice_gold.footer_lines, '', '', ''].slice(0, 3));
      setInvoiceMiscMode(data.invoice_misc_mode);
      setInvoiceMiscRows(toEditableInvoiceMiscRows(data.invoice_misc.rows));
      setBankInfo({
        reg_number: data.bank_info.reg_number || '',
        account_number: data.bank_info.account_number || '',
      });
      setMarketRates(normalizeMarketRatesInput(data.market_rates));
      setAfgNote(data.afg_note || '');
      setCalculators(data.calculators);
      setPaymentMethod((data.payment_method as PaymentMethod) || readStoredPaymentMethod());
      autosaveKeyRef.current = JSON.stringify(payload);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui');
    },
  });

  const updateCustomerMutation = useMutation({
    mutationFn: (payload: EditableCustomer) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/customer`, {
        method: 'PUT',
        body: JSON.stringify(customerRequestPayload(payload)),
      }),
    onSuccess: (data, payload) => {
      if (initializedSessionRef.current !== data.session.id) return;
      setWorkspace(data);
      applyWorkspace(data);
      customerAutosaveKeyRef.current = JSON.stringify(payload);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui');
    },
  });

  async function flushQueuedSectionsSave() {
    if (sectionsSaveInFlightRef.current) return;
    const payload = queuedSectionsPayloadRef.current;
    if (!initializedSessionRef.current || !payload) return;
    if (JSON.stringify(payload) === autosaveKeyRef.current) {
      queuedSectionsPayloadRef.current = null;
      return;
    }

    sectionsSaveInFlightRef.current = true;
    queuedSectionsPayloadRef.current = null;
    try {
      await updateSectionsMutation.mutateAsync(payload);
    } catch {
      // Autosave failures stay visible via mutation state; keep the queue logic from throwing.
    } finally {
      sectionsSaveInFlightRef.current = false;
      if (queuedSectionsPayloadRef.current) {
        void flushQueuedSectionsSave();
      }
    }
  }

  function queueSectionsSave(payload: ReturnType<typeof workspaceRowsPayload>) {
    queuedSectionsPayloadRef.current = payload;
    void flushQueuedSectionsSave();
  }

  async function flushQueuedCustomerSave() {
    if (customerSaveInFlightRef.current) return;
    const payload = queuedCustomerPayloadRef.current;
    if (!initializedSessionRef.current || !payload) return;
    if (JSON.stringify(payload) === customerAutosaveKeyRef.current) {
      queuedCustomerPayloadRef.current = null;
      return;
    }

    customerSaveInFlightRef.current = true;
    queuedCustomerPayloadRef.current = null;
    try {
      if (workspace?.customer.customer_id) {
        await updateCustomerMutation.mutateAsync(payload);
      } else {
        await updateDraftCustomerMutation.mutateAsync(payload);
      }
    } catch {
      // Autosave failures stay visible via mutation state; keep the queue logic from throwing.
    } finally {
      customerSaveInFlightRef.current = false;
      if (queuedCustomerPayloadRef.current) {
        void flushQueuedCustomerSave();
      }
    }
  }

  function queueCustomerSave(payload: EditableCustomer) {
    queuedCustomerPayloadRef.current = payload;
    void flushQueuedCustomerSave();
  }

  function sendClerkPreview(payload: Record<string, unknown>) {
    const sequencedPayload = {
      ...payload,
      preview_sequence: ++previewSequenceRef.current,
    };
    pendingPreviewPayloadRef.current = sequencedPayload;
    const socket = clerkPreviewSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'clerk:preview', data: sequencedPayload }));
  }

  function buildPreviewPayload(options?: {
    goldRows?: EditableGoldRow[];
    silverRows?: EditableSilverRow[];
    customerForm?: EditableCustomer;
    newCustomer?: EditableCustomer;
    customerMode?: 'existing' | 'new' | null;
  }) {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) {
      return null;
    }

    const nextCustomerMode = options?.customerMode ?? customerMode;
    const nextCustomerForm = options?.customerForm ?? customerForm;
    const nextNewCustomer = options?.newCustomer ?? newCustomer;
    const previewCustomer =
      workspace.customer.customer_id || nextCustomerMode !== 'new'
        ? nextCustomerForm
        : nextNewCustomer;

    return {
      customer_name: previewCustomer.name || '',
      customer_phone: previewCustomer.phone || '',
      customer_email: previewCustomer.email || '',
      customer_address: previewCustomer.address || '',
      customer_postal_code: previewCustomer.postal_code || '',
      customer_city: previewCustomer.city || '',
      customer_cpr: previewCustomer.cpr_number || '',
      customer_identity_doc_number: previewCustomer.identity_doc_number || '',
      preview_gold_rows: computedPreviewGoldRowsPayload(options?.goldRows ?? goldRowsRef.current, marketRates),
      preview_silver_rows: computedPreviewSilverRowsPayload(options?.silverRows ?? silverRowsRef.current, marketRates),
    };
  }

  const finalizeMutation = useMutation({
    mutationFn: () =>
      apiRequest<PosWorkspaceFinalizeResponse>(`/api/v2/alis/workspace/${workspace?.session.id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({
          notes: afgNote.trim() || null,
          bank_info: {
            reg_number: bankInfo.reg_number || '',
            account_number: bankInfo.account_number || '',
          },
          payment_method: paymentMethod,
        }),
      }),
    onSuccess: async (response) => {
      const closedSessionId = workspace?.session.id || null;
      setWorkspace(null);
      initializedSessionRef.current = null;
      autosaveKeyRef.current = '';
      customerAutosaveKeyRef.current = '';
      queuedSectionsPayloadRef.current = null;
      queuedCustomerPayloadRef.current = null;
      if (closedSessionId) {
        emitWorkspaceArtifactSync(closedSessionId, 'alis-ui');
      }
      // M2 — Finalize sonrası log + depolama'ya cross-module sinyal yolla.
      // DEFAULT_CROSS_TRIGGERS['alis'] = ['log', 'depolama'] otomatik enjekte edilir.
      emitArtifactSync({
        kind: 'alis',
        key: response?.document_sequence_no ? String(response.document_sequence_no) : 'live',
        source: 'alis-ui',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos', 'workspace', 'open-draft'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'documents'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
      const docNumber = response?.document_number ? `#${response.document_number}` : 'Belge';
      const ucStatus = (response as PosWorkspaceFinalizeResponse & { uniconta_sync_status?: string | null })?.uniconta_sync_status;
      if (ucStatus === 'failed') {
        toast.warning(`${docNumber} kaydedildi`, 'Uniconta senkronizasyonu başarısız — daha sonra tekrar denenebilir.');
      } else if (ucStatus === 'synced') {
        toast.success(`${docNumber} kaydedildi`, 'Uniconta senkronizasyonu tamamlandı.');
      } else {
        toast.success(`${docNumber} kaydedildi`);
      }
    },
    onError: (error) => {
      toast.error('Belge kaydedilemedi', error instanceof Error ? error.message : undefined);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v2/alis/workspace/${workspace?.session.id}/cancel`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      const closedSessionId = workspace?.session.id || null;
      setWorkspace(null);
      initializedSessionRef.current = null;
      queuedSectionsPayloadRef.current = null;
      queuedCustomerPayloadRef.current = null;
      if (closedSessionId) {
        emitWorkspaceArtifactSync(closedSessionId, 'alis-ui');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos', 'workspace', 'open-draft'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
      toast.info('Taslak iptal edildi');
    },
    onError: (error) => {
      toast.error('Taslak iptal edilemedi', error instanceof Error ? error.message : undefined);
    },
  });

  useEffect(() => {
    if (!workspace) {
      setDraftWorkspace(workspaceQuery.data || null);
    }
  }, [workspace, workspaceQuery.data]);

  useEffect(() => {
    setPriceOpen(false);
  }, [workspace?.session.id]);

  useEffect(() => {
    if (!workspace?.session.id || invoiceGoldMode !== 'auto') return;
    setInvoiceGoldRows((current) => buildAutoInvoiceGoldRows(goldRows, silverRows, current));
    setInvoiceGoldFooterLines(['', '', '']);
  }, [workspace?.session.id, goldRows, silverRows, invoiceGoldMode]);

  useEffect(() => {
    if (!workspace?.session.id || invoiceMiscMode !== 'auto') return;
    setInvoiceMiscRows((current) => (current.length > 0 ? buildDefaultInvoiceMiscRows().map((row, index) => ({ ...row, row_key: current[index]?.row_key || row.row_key })) : buildDefaultInvoiceMiscRows()));
  }, [workspace?.session.id, invoiceMiscMode]);

  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.source === 'alis-ui') return;

      // 1) Office/Excel workbook senkronizasyonu: yalnız alis-workspace kind + session key match
      if (signal.kind === 'alis-workspace') {
        const activeSessionId = workspace?.session.id || null;
        const draftSessionId = draftWorkspace?.session.id || null;
        if (!activeSessionId && !draftSessionId) return;
        if (signal.key !== activeSessionId && signal.key !== draftSessionId) return;

        if (activeSessionId && signal.key === activeSessionId) {
          void apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${activeSessionId}`).then((data) => {
            if (initializedSessionRef.current !== data.session.id) return;
            setWorkspace(data);
            applyWorkspace(data);
          });
        }

        if (signal.key === draftSessionId) {
          void workspaceQuery.refetch().then((result) => {
            if (result.data) {
              setDraftWorkspace(result.data);
            }
          });
        }
      }

      // 2) Cross-module sync: log/depolama/uniconta tarafından tetiklenen değişiklikler
      //    saved purchases listesini (uniconta_sync_status, line.product_id atamaları vs.) etkiler.
      if (signalMatches(signal, 'alis')) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
          queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        ]);
        return;
      }

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    });
  }, [draftWorkspace?.session.id, queryClient, workspace?.session.id, workspaceQuery]);

  useEffect(() => {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;

    void apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace.session.id}`)
      .then((data) => {
        if (initializedSessionRef.current !== data.session.id) return;
        setWorkspace(data);
        applyWorkspace(data);
      })
      .catch(() => {
        // Keep the current local state if the authoritative refresh fails during view switches.
      });
  }, [activeWorkspaceView, workspace?.session.id]);

  useEffect(() => {
    goldRowsRef.current = goldRows;
  }, [goldRows]);

  useEffect(() => {
    silverRowsRef.current = silverRows;
  }, [silverRows]);

  useEffect(() => {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;
    const payload = workspaceRowsPayload(
      goldRows,
      silverRows,
      bankInfo,
      marketRates,
      afgNote,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
    );
    const serialized = JSON.stringify(payload);
    if (serialized === autosaveKeyRef.current) {
      queuedSectionsPayloadRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      queueSectionsSave(payload);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    workspace?.session.id,
    goldRows,
    silverRows,
    bankInfo,
    marketRates,
    paymentMethod,
    numbering,
    invoiceGoldMode,
    invoiceGoldRows,
    invoiceGoldFooterLines,
    invoiceMiscMode,
    invoiceMiscRows,
    afgNote,
    calculators,
    // updateSectionsMutation referansı her render'da yeni — dep'ten çıkarıldı,
    // queueSectionsSave closure üzerinden günceli okur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  useEffect(() => {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;
    const nextPayload = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    if (!nextPayload) return;
    if (nextPayload.name.trim().length > 0 && nextPayload.name.trim().length < 2) return;
    const serialized = JSON.stringify(nextPayload);
    if (serialized === customerAutosaveKeyRef.current) {
      queuedCustomerPayloadRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      queueCustomerSave(nextPayload);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // updateCustomerMutation / updateDraftCustomerMutation referansları her
    // render'da yeni — dep'ten çıkarıldı, queue closure üzerinden günceli okur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace?.session.id,
    workspace?.customer.customer_id,
    customerMode,
    customerForm,
    newCustomer,
  ]);

  useEffect(() => {
    if (!workspace?.session.id) return;
    const token = getAccessToken();
    if (!token) return;
    let mounted = true;
    previewSequenceRef.current = 0;
    pendingPreviewPayloadRef.current = null;

    const connect = () => {
      if (!mounted) return;
      const socket = new WebSocket(
        `${buildWsUrl(`/api/pos/sessions/${workspace.session.id}/ws`)}?token=${encodeURIComponent(token)}`,
      );
      clerkPreviewSocketRef.current = socket;

      socket.onopen = () => {
        if (pendingPreviewPayloadRef.current) {
          socket.send(JSON.stringify({ type: 'clerk:preview', data: pendingPreviewPayloadRef.current }));
        }
      };

      socket.onclose = () => {
        if (!mounted) return;
        if (clerkPreviewSocketRef.current === socket) {
          clerkPreviewSocketRef.current = null;
        }
        clerkPreviewReconnectRef.current = window.setTimeout(connect, 1_500);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      mounted = false;
      pendingPreviewPayloadRef.current = null;
      if (clerkPreviewReconnectRef.current) {
        window.clearTimeout(clerkPreviewReconnectRef.current);
        clerkPreviewReconnectRef.current = null;
      }
      const socket = clerkPreviewSocketRef.current;
      clerkPreviewSocketRef.current = null;
      socket?.close();
    };
  }, [workspace?.session.id]);

  useEffect(() => {
    const payload = buildPreviewPayload();
    if (!payload) return;

    const timer = window.setTimeout(() => {
      sendClerkPreview(payload);
    }, PREVIEW_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [workspace?.session.id, workspace?.customer.customer_id, customerMode, customerForm, newCustomer, goldRows, silverRows, marketRates]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('market_gold', marketRates.gold_24k_dkk || '2850');
    window.localStorage.setItem('market_silver', marketRates.silver_dkk || '8.5');
    window.localStorage.setItem('market_fx', marketRates.eur_dkk_fx || DEFAULT_MARKET_FX);
  }, [marketRates.eur_dkk_fx, marketRates.gold_24k_dkk, marketRates.silver_dkk]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PAYMENT_METHOD_STORAGE_KEY, paymentMethod);
  }, [paymentMethod]);

  const candidateCustomers = useMemo(() => {
    const term = customerSearchTerm.trim().toLocaleLowerCase('tr-TR');
    const recent = recentCustomersQuery.data?.items || [];
    const localFiltered =
      term.length === 0
        ? recent
        : recent.filter((customer) =>
            [customer.name, customer.cpr_number_masked, customer.phone]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase('tr-TR').includes(term)),
          );
    if (term.length < 2) return localFiltered;
    return customersQuery.data?.length ? customersQuery.data : localFiltered;
  }, [customerSearchTerm, customersQuery.data, recentCustomersQuery.data?.items]);

  function handleStartBlankWorkspace() {
    pendingPaymentMethodRef.current = paymentMethod;
    openWorkspaceMutation.mutate({
      payment_method: paymentMethod,
      force_new_session: true,
    });
  }

  // Klavye kısayolları — workspace varsa Ctrl+S finalize / Esc cancel; yoksa Ctrl+N yeni AFG
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (target.isContentEditable) return true;
      return false;
    };
    const handler = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      const hasWorkspace = Boolean(workspace);
      const editable = isEditableTarget(event.target);
      // Ctrl+S — kaydet (workspace varsa, müşteri seçili ise)
      if (meta && event.key.toLowerCase() === 's') {
        if (hasWorkspace && workspace?.customer.customer_id) {
          event.preventDefault();
          if (!finalizeMutation.isPending) {
            finalizeMutation.mutate();
          }
        }
        return;
      }
      // Ctrl+N — yeni AFG (workspace yoksa)
      if (meta && event.key.toLowerCase() === 'n') {
        if (!hasWorkspace && !openWorkspaceMutation.isPending) {
          event.preventDefault();
          handleStartBlankWorkspace();
        }
        return;
      }
      // Esc — taslak iptal (workspace varsa, input içinde değilse)
      if (event.key === 'Escape' && hasWorkspace && !editable && !cancelMutation.isPending) {
        void confirm({
          title: 'Taslak iptal edilsin mi?',
          message: 'Girilen veriler kaydedilmeyecek.',
          confirmText: 'Taslağı iptal et',
          cancelText: 'Vazgeç',
          variant: 'warning',
        }).then((ok) => {
          if (ok) cancelMutation.mutate();
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, workspace?.customer.customer_id, finalizeMutation.isPending, cancelMutation.isPending, openWorkspaceMutation.isPending]);

  function handleSelectExistingCustomer(customerId: string) {
    if (!workspace?.session.id || !customerId) return;
    selectCustomerMutation.mutate({
      customer_id: customerId,
    });
  }

  function handleCreateNewCustomer(event: FormEvent) {
    event.preventDefault();
    if (!workspace?.session.id) return;
    selectCustomerMutation.mutate({
      customer_new: {
        name: newCustomer.name,
        email: newCustomer.email || null,
        phone: newCustomer.phone || null,
        address: newCustomer.address || null,
        city: newCustomer.city || null,
        postal_code: newCustomer.postal_code || null,
        cpr_number: newCustomer.cpr_number || null,
        identity_doc_number: newCustomer.identity_doc_number || null,
      },
    });
  }

  function updateGoldRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    const nextRows = goldRowsRef.current.map((row) =>
      row.row_key === rowKey ? { ...row, [field]: normalizeTextInput(value) } : row,
    );
    goldRowsRef.current = nextRows;
    setGoldRows(nextRows);
    const payload = buildPreviewPayload({ goldRows: nextRows });
    if (payload) {
      sendClerkPreview(payload);
    }
  }

  function updateSilverRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    const nextRows = silverRowsRef.current.map((row) =>
      row.row_key === rowKey ? { ...row, [field]: normalizeTextInput(value) } : row,
    );
    silverRowsRef.current = nextRows;
    setSilverRows(nextRows);
    const payload = buildPreviewPayload({ silverRows: nextRows });
    if (payload) {
      sendClerkPreview(payload);
    }
  }

  function updateNumbering(field: keyof EditableWorkspaceNumbering, value: string) {
    setNumbering((current) => ({
      ...current,
      [field]: value.trim(),
    }));
  }

  function updateInvoiceGoldRow(rowKey: string, field: 'code' | 'fineness' | 'gram', value: string) {
    setInvoiceGoldMode('manual');
    setInvoiceGoldRows((current) =>
      current.map((row) =>
        row.row_key === rowKey
          ? {
              ...row,
              [field]: field === 'gram' ? normalizeTextInput(value) : value,
            }
          : row,
      ),
    );
  }

  function updateInvoiceGoldFooterLine(index: number, value: string) {
    setInvoiceGoldMode('manual');
    setInvoiceGoldFooterLines((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function updateInvoiceMiscRow(rowKey: string, field: 'text' | 'quantity' | 'unit_price_dkk', value: string) {
    setInvoiceMiscMode('manual');
    setInvoiceMiscRows((current) =>
      current.map((row) =>
        row.row_key === rowKey
          ? {
              ...row,
              [field]: field === 'quantity' || field === 'unit_price_dkk' ? normalizeTextInput(value) : value,
            }
          : row,
      ),
    );
  }

  function handleCustomerBlur() {
    if (!workspace?.session.id) return;
    const nextPayload = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    if (!nextPayload) return;
    if (nextPayload.name.trim().length > 0 && nextPayload.name.trim().length < 2) return;
    const serialized = JSON.stringify(nextPayload);
    if (serialized === customerAutosaveKeyRef.current) return;
    queueCustomerSave(nextPayload);
  }

  function handleResumeDraft() {
    if (!draftWorkspace) return;
    setWorkspace(draftWorkspace);
    applyWorkspace(draftWorkspace);
  }

  function handleExportDocument(item: PosSavedPurchaseListItem) {
    void downloadAuthedDocument(
      `/api/v2/alis/documents/${item.sequence_no}/export?format=xlsx`,
      `AFG-${item.document_number.replaceAll('/', '-')}.xlsx`,
    );
  }

  async function openUnicontaPdfModal(sequenceNo: number, htmlFallbackPath: string) {
    setPdfState((current) => ({ ...current, loading: true, error: null }));
    try {
      const { url } = await fetchAuthedPdfBlob(`/api/v2/uniconta/invoice-pdf/from-pos/${sequenceNo}`);
      setPdfState({ url, filename: `uniconta-${sequenceNo}.pdf`, loading: false, error: null });
    } catch (exc) {
      // Sync henüz tamamlanmadıysa veya hata → HTML fallback (yeni tab)
      setPdfState({ url: null, filename: '', loading: false, error: null });
      void openAuthedDocument(htmlFallbackPath);
      void exc; // explicit ignore
    }
  }

  function closePdfModal() {
    setPdfState((current) => {
      if (current.url) URL.revokeObjectURL(current.url);
      return { url: null, filename: '', loading: false, error: null };
    });
  }

  function handlePrintDocument(item: PosSavedPurchaseListItem) {
    void openUnicontaPdfModal(
      item.sequence_no,
      `/api/v2/alis/documents/${item.sequence_no}/print?format=html`,
    );
  }

  function handleOpenWorkspaceExcelPreview() {
    if (!workspace) return;
    void handleWorkspaceViewChange('excel');
  }

  async function flushPendingWorkspaceSync() {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;
    const nextSectionsPayload = workspaceRowsPayload(
      goldRowsRef.current,
      silverRowsRef.current,
      bankInfo,
      marketRates,
      afgNote,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
    );
    if (JSON.stringify(nextSectionsPayload) !== autosaveKeyRef.current) {
      queuedSectionsPayloadRef.current = nextSectionsPayload;
      await flushQueuedSectionsSave();
    }

    const nextCustomerPayload = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    if (!nextCustomerPayload) return;
    if (nextCustomerPayload.name.trim().length > 0 && nextCustomerPayload.name.trim().length < 2) return;
    if (JSON.stringify(nextCustomerPayload) === customerAutosaveKeyRef.current) return;
    queuedCustomerPayloadRef.current = nextCustomerPayload;
    await flushQueuedCustomerSave();
  }

  async function handleWorkspaceViewChange(nextView: WorkspaceSurfaceView) {
    if (nextView === activeWorkspaceView) return;
    try {
      await flushPendingWorkspaceSync();
    } catch {
      // Keep the view switch non-blocking; failed autosaves remain visible via mutation state.
    }
    setActiveWorkspaceViewState(nextView);
  }

  function handleResetInvoiceGoldToAuto() {
    setInvoiceGoldMode('auto');
    setInvoiceGoldRows((current) => buildAutoInvoiceGoldRows(goldRowsRef.current, silverRowsRef.current, current));
    setInvoiceGoldFooterLines(['', '', '']);
  }

  function handleResetInvoiceMiscToAuto() {
    setInvoiceMiscMode('auto');
    setInvoiceMiscRows(buildDefaultInvoiceMiscRows());
  }

  function handleOpenDocumentExcelPreview(sequenceNo: number, documentNumber: string) {
    void openExcelPreviewRoute(
      `/office-document/alis-document/${sequenceNo}`,
      `AFG Belgesi — ${documentNumber}`,
    );
  }

  function handleStartFromCustomer(item: PosSavedPurchaseListItem) {
    if (!item.customer_id) return;
    const nextPayment = (item.payment_method as PaymentMethod | null) || paymentMethod;
    pendingPaymentMethodRef.current = nextPayment;
    openWorkspaceMutation.mutate({
      customer_id: item.customer_id,
      payment_method: nextPayment,
      force_new_session: true,
    });
  }

  function handleOpenCustomer(item: PosSavedPurchaseListItem) {
    if (!item.customer_id) return;
    navigate(`/musteriler?customer=${encodeURIComponent(item.customer_id)}`);
  }

  function handleEditDocument(item: PosSavedPurchaseListItem) {
    setActionSequenceNo(item.sequence_no);
    editDocumentMutation.mutate(item.sequence_no);
  }

  async function handleDeleteDocument(item: PosSavedPurchaseListItem) {
    const ok = await confirm({
      title: 'Alış kaydı iptal edilsin mi?',
      message: `${item.document_number} numaralı alış kaydı iptal edilecek. Bu işlem audit'e yazılır.`,
      confirmText: 'Kaydı iptal et',
      cancelText: 'Vazgeç',
      variant: 'danger',
    });
    if (!ok) return;
    setActionSequenceNo(item.sequence_no);
    deleteDocumentMutation.mutate(item.sequence_no);
  }

  return {
    detailPurchase,
    detail: detailDocumentQuery.data || null,
    detailLoading: detailDocumentQuery.isLoading,
    onCloseDetail: () => setDetailPurchase(null),
    onEditDetail: () => {
      if (!detailPurchase || !detailDocumentQuery.data?.can_edit) return;
      handleEditDocument(detailPurchase);
    },
    onDeleteDetail: () => {
      if (!detailPurchase || !detailDocumentQuery.data?.can_delete) return;
      handleDeleteDocument(detailPurchase);
    },
    onExportDetail: () => {
      if (!detailDocumentQuery.data) return;
      void downloadAuthedDocument(
        `/api/v2/alis/documents/${detailDocumentQuery.data.sequence_no}/export?format=xlsx`,
        `AFG-${detailDocumentQuery.data.document_number.replaceAll('/', '-')}.xlsx`,
      );
    },
    onPrintDetail: () => {
      if (!detailDocumentQuery.data) return;
      void openUnicontaPdfModal(
        detailDocumentQuery.data.sequence_no,
        `/api/v2/alis/documents/${detailDocumentQuery.data.sequence_no}/print?format=html`,
      );
    },
    onOpenDetailExcelPreview: () => {
      if (!detailDocumentQuery.data) return;
      setDetailPurchase(null);
      handleOpenDocumentExcelPreview(detailDocumentQuery.data.sequence_no, detailDocumentQuery.data.document_number);
    },
    detailActionPending: editDocumentMutation.isPending || deleteDocumentMutation.isPending,
    workspace,
    draftWorkspace,
    onResumeDraft: handleResumeDraft,
    documents: savedPurchasesQuery.data || [],
    purchaseSearchTerm,
    setPurchaseSearchTerm,
    purchaseDate,
    setPurchaseDate,
    onViewDocument: (item) => setDetailPurchase(item),
    onOpenDocumentExcelPreview: (item) => handleOpenDocumentExcelPreview(item.sequence_no, item.document_number),
    onOpenCustomer: handleOpenCustomer,
    onExportDocument: handleExportDocument,
    onPrintDocument: handlePrintDocument,
    onStartFromCustomer: handleStartFromCustomer,
    onEditDocument: handleEditDocument,
    onDeleteDocument: handleDeleteDocument,
    onRetryUnicontaSync: handleRetryUnicontaSync,
    retryPendingSequenceNo: retryUnicontaSyncMutation.isPending
      ? (retryUnicontaSyncMutation.variables ?? null)
      : null,
    listLoading: savedPurchasesQuery.isLoading,
    actionPendingSequenceNo: actionSequenceNo,
    customerMode,
    setCustomerMode,
    customerSearchTerm,
    setCustomerSearchTerm,
    candidateCustomers,
    newCustomer,
    setNewCustomer,
    onSelectExistingCustomer: handleSelectExistingCustomer,
    onCreateNewCustomer: handleCreateNewCustomer,
    customerForm,
    setCustomerForm,
    onCustomerBlur: handleCustomerBlur,
    goldRows,
    silverRows,
    onUpdateGoldRow: updateGoldRow,
    onUpdateSilverRow: updateSilverRow,
    activeWorkspaceView,
    setActiveWorkspaceView: handleWorkspaceViewChange,
    numbering,
    setNumbering,
    onUpdateNumbering: updateNumbering,
    invoiceGoldMode,
    invoiceGoldRows,
    invoiceGoldFooterLines,
    onUpdateInvoiceGoldRow: updateInvoiceGoldRow,
    onUpdateInvoiceGoldFooterLine: updateInvoiceGoldFooterLine,
    onResetInvoiceGoldToAuto: handleResetInvoiceGoldToAuto,
    invoiceMiscMode,
    invoiceMiscRows,
    onUpdateInvoiceMiscRow: updateInvoiceMiscRow,
    onResetInvoiceMiscToAuto: handleResetInvoiceMiscToAuto,
    bankInfo,
    setBankInfo,
    marketRates,
    setMarketRates,
    afgNote,
    setAfgNote,
    calculators,
    setCalculators,
    paymentMethod,
    setPaymentMethod,
    onPrintWorkspace: () => {
      if (!workspace) return;
      void openAuthedDocument(`/api/v2/alis/workspace/${workspace.session.id}/print?format=html`);
    },
    onOpenWorkspaceExcelPreview: handleOpenWorkspaceExcelPreview,
    onCancelWorkspace: () => cancelMutation.mutate(),
    onFinalizeWorkspace: async () => {
      await flushPendingWorkspaceSync();
      finalizeMutation.mutate();
    },
    customerPending: updateCustomerMutation.isPending || updateDraftCustomerMutation.isPending,
    customerSelecting: selectCustomerMutation.isPending,
    finalizePending: finalizeMutation.isPending,
    cancelPending: cancelMutation.isPending,
    onStartBlankWorkspace: handleStartBlankWorkspace,
    startPending: openWorkspaceMutation.isPending,
    priceOpen,
    setPriceOpen,
    pdfState,
    onClosePdfModal: closePdfModal,
  };
}
