import { type FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { getAccessToken, getCurrentUser } from '@/lib/auth';
import { requestCriticalBackup } from '@/lib/backup';
import {
  ApiError,
  TransportError,
  apiRequest,
  buildWsUrl,
  downloadAuthedDocument,
  localizeApiError,
  printAuthedDocument,
} from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { emitArtifactSync, listenArtifactSync, signalMatches } from '@/lib/artifactSync';
import { openOfficeDock } from '@/lib/officeDock';
import {
  deletePendingPurchaseDraft,
  isTauriRuntime,
  listPendingPurchaseDrafts,
  persistPendingPurchaseDraft,
} from '@/lib/desktop';
import type {
  CustomerOut,
  PaginatedResponse,
  PosDocumentDetail,
  PosSavedPurchaseListItem,
  PosWorkspace,
  PosWorkspaceBankInfo,
  PosWorkspaceCalculators,
  PosWorkspaceFinalizeResponse,
  PosWorkspaceBarRow,
  PosWorkspacePtPdRow,
  PosWorkspaceExtraRow,
  PosWorkspaceGoldRow,
  PosWorkspaceInvoiceGoldRow,
  PosWorkspaceInvoiceMiscRow,
  PosWorkspaceMarketRates,
  PosWorkspaceNumbering,
  PosWorkspaceSilverRow,
} from '@/types';

import type { AlisPageProps } from './AlisPage';
import type {
  CompanionMode,
  EditableCustomer,
  EditableBarRow,
  EditablePtPdRow,
  EditableExtraRow,
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
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: '',
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
// Backend market_rate_profile varsayılanlarıyla aynı; oranların tek kaynağı
// backend profilidir, localStorage snapshot'ı kullanılmaz.
const DEFAULT_MARKET_GOLD_DKK = '615.50';
const DEFAULT_MARKET_SILVER_DKK = '7.80';

function parseDecimalValue(value: string | number | null | undefined) {
  const numeric = Number(normalizeTextInput(String(value ?? '0')));
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildDefaultGoldRatesDkk(gold24Dkk: string) {
  const gold24 = parseDecimalValue(gold24Dkk);
  const defs = [
    ['8', 8],
    ['14', 14],
    ['18', 18],
    ['21', 21],
    ['21.6', 21.6],
    ['22', 22],
    ['22b', 22],
    ['24', 24],
  ] as const;
  return Object.fromEntries(defs.map(([key, karat]) => [key, (gold24 * karat) / 24])) as Record<string, number>;
}

function buildDefaultSilverRatesDkk(silverDkk: string) {
  const silver999 = parseDecimalValue(silverDkk);
  const defs = [
    ['999', 0.999],
    ['925', 0.925],
    ['830', 0.83],
    ['800', 0.8],
  ] as const;
  return Object.fromEntries(defs.map(([key, ratio]) => [key, silver999 * ratio])) as Record<string, number>;
}

function buildDefaultMarketRates(gold24Dkk: string, silverDkk: string, fx = DEFAULT_MARKET_FX): PosWorkspaceMarketRates {
  const goldRates = buildDefaultGoldRatesDkk(gold24Dkk);
  const silverRates = buildDefaultSilverRatesDkk(silverDkk);
  return {
    eur_dkk_fx: fx,
    gold_24k_dkk: gold24Dkk,
    silver_dkk: silverDkk,
    plet_dkk: '0.02',
    gold_bar_dkk: gold24Dkk,
    silver_bar_dkk: silverDkk,
    gold_rates_dkk: Object.fromEntries(Object.entries(goldRates).map(([key, value]) => [key, value.toFixed(2)])),
    silver_rates_dkk: Object.fromEntries(Object.entries(silverRates).map(([key, value]) => [key, value.toFixed(2)])),
    gold_matrix: [
      { row_key: 'gold:8', label: '8K', lodighed: '333', dkk_per_gram: goldRates['8'].toFixed(2), karat: '8.00', type_code: '1' },
      { row_key: 'gold:14', label: '14K', lodighed: '585', dkk_per_gram: goldRates['14'].toFixed(2), karat: '14.00', type_code: '1' },
      { row_key: 'gold:18', label: '18K', lodighed: '750', dkk_per_gram: goldRates['18'].toFixed(2), karat: '18.00', type_code: '1' },
      { row_key: 'gold:21', label: '21K', lodighed: '875', dkk_per_gram: goldRates['21'].toFixed(2), karat: '21.00', type_code: '1' },
      { row_key: 'gold:21.6', label: '21.6K', lodighed: '900', dkk_per_gram: goldRates['21.6'].toFixed(2), karat: '21.60', type_code: '1' },
      { row_key: 'gold:22', label: '22K', lodighed: '916', dkk_per_gram: goldRates['22'].toFixed(2), karat: '22.00', type_code: '1' },
      { row_key: 'gold:22b', label: '22K-2', lodighed: '916', dkk_per_gram: goldRates['22b'].toFixed(2), karat: '22.00', type_code: '1' },
      { row_key: 'gold:24', label: '24K', lodighed: '999', dkk_per_gram: goldRates['24'].toFixed(2), karat: '24.00', type_code: '1' },
    ],
    silver_matrix: [
      { row_key: 'silver:2', label: 'Finsølv', lodighed: '999', dkk_per_gram: silverRates['999'].toFixed(2), karat: null, type_code: '2' },
      { row_key: 'silver:3', label: 'Sterling sølv', lodighed: '925', dkk_per_gram: silverRates['925'].toFixed(2), karat: null, type_code: '3' },
      { row_key: 'silver:4', label: '3 tårnet sølv', lodighed: '830', dkk_per_gram: silverRates['830'].toFixed(2), karat: null, type_code: '4' },
      { row_key: 'silver:5', label: 'Plet', lodighed: '—', dkk_per_gram: '0.02', karat: null, type_code: '5' },
    ],
  };
}

function normalizeMarketRatesInput(marketRates: PosWorkspaceMarketRates): PosWorkspaceMarketRates {
  return {
    ...buildDefaultMarketRates(
      marketRates.gold_24k_dkk || DEFAULT_MARKET_GOLD_DKK,
      marketRates.silver_dkk || DEFAULT_MARKET_SILVER_DKK,
      marketRates.eur_dkk_fx || DEFAULT_MARKET_FX,
    ),
    ...marketRates,
  };
}

function normalizeRateKey(value: string | number | null | undefined) {
  const numeric = parseDecimalValue(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return String(numeric);
}

function normalizeTextInput(value: string): string {
  return value.replace(',', '.');
}

function clearLegacyPaymentMethodPreference() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PAYMENT_METHOD_STORAGE_KEY);
  } catch {
    // Legacy preference cleanup is best-effort only.
  }
}

function workspaceRowsPayload(
  goldRows: EditableGoldRow[],
  silverRows: EditableSilverRow[],
  bankInfo: PosWorkspaceBankInfo,
  marketRates: PosWorkspaceMarketRates,
  afgNote: string,
  purchaseVatEnabled: boolean,
  calculators: PosWorkspaceCalculators,
  _paymentMethod: PaymentMethod,
  numbering: EditableWorkspaceNumbering,
  invoiceGoldMode: CompanionMode,
  invoiceGoldRows: EditableInvoiceGoldRow[],
  invoiceGoldFooterLines: string[],
  invoiceMiscMode: CompanionMode,
  invoiceMiscRows: EditableInvoiceMiscRow[],
  barRows: EditableBarRow[] = [],
  ptpdRows: EditablePtPdRow[] = [],
  extraRows: EditableExtraRow[] = [],
) {
  return {
    gold_rows: goldRows.map((row) => ({
      karat: Number(row.karat),
      gram: Number(normalizeTextInput(row.gram || '0')),
      avance_percent: Number(normalizeTextInput(row.avance_percent || '0')),
    })),
    // R2-01: dinamik kniv/çeyrek satırları (gram > 0 olanlar gönderilir).
    extra_rows: extraRows
      .filter((row) => Number(normalizeTextInput(row.gram || '0')) > 0)
      .map((row) => ({
        row_key: row.row_key,
        kind: row.kind,
        label: row.label,
        metal: row.metal,
        karat: row.karat,
        gram: Number(normalizeTextInput(row.gram || '0')),
        avance_percent: Number(normalizeTextInput(row.avance_percent || '0')),
      })),
    silver_rows: silverRows.map((row) => ({
      type_code: row.type_code,
      gram: Number(normalizeTextInput(row.gram || '0')),
      avance_percent: Number(normalizeTextInput(row.avance_percent || '0')),
    })),
    bar_rows: barRows.map((row) => ({
      bar_type: row.bar_type,
      gram: Number(normalizeTextInput(row.gram || '0')),
      avance_percent: Number(normalizeTextInput(row.avance_percent || '0')),
    })),
    ptpd_rows: ptpdRows.map((row) => ({
      metal: row.metal,
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
      gold_rates_dkk: Object.fromEntries(
        Object.entries(marketRates.gold_rates_dkk || {}).map(([key, value]) => [key, Number(normalizeTextInput(value || '0'))]),
      ),
      silver_rates_dkk: Object.fromEntries(
        Object.entries(marketRates.silver_rates_dkk || {}).map(([key, value]) => [key, Number(normalizeTextInput(value || '0'))]),
      ),
      plet_dkk: Number(normalizeTextInput(marketRates.plet_dkk || '0.02')),
      gold_bar_dkk: Number(normalizeTextInput(marketRates.gold_bar_dkk || '0')),
      silver_bar_dkk: Number(normalizeTextInput(marketRates.silver_bar_dkk || '0')),
      platinum_dkk: Number(normalizeTextInput(marketRates.platinum_dkk || '0')),
      palladium_dkk: Number(normalizeTextInput(marketRates.palladium_dkk || '0')),
    },
    afg_note: afgNote.trim() || null,
    purchase_vat_enabled: purchaseVatEnabled,
    purchase_vat_rate_percent: purchaseVatEnabled ? 25 : 0,
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
    payment_method: 'bank' as const,
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
    identity_doc_type: workspace.customer.identity_doc_type || '',
    identity_doc_number: workspace.customer.identity_doc_number || '',
    identity_doc_country: workspace.customer.identity_doc_country || '',
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
      customer.identity_doc_number.trim() ||
      customer.identity_doc_type.trim() ||
      customer.identity_doc_country.trim(),
  );
}

function customerRequestPayload(customer: EditableCustomer) {
  const normalizedPostal = customer.postal_code.replace(/\D/g, '').slice(0, 4);
  return {
    name: customer.name.trim() || null,
    email: customer.email.trim() || null,
    phone: customer.phone.trim() || null,
    address: customer.address.trim() || null,
    postal_code: normalizedPostal || null,
    city: customer.city.trim() || null,
    cpr_number: customer.cpr_number.trim() || null,
    identity_doc_type: customer.identity_doc_type.trim() || null,
    identity_doc_number: customer.identity_doc_number.trim() || null,
    identity_doc_country: customer.identity_doc_country.trim() || null,
  };
}

function hasPartialPostalCode(customer: EditableCustomer) {
  const normalizedPostal = customer.postal_code.replace(/\D/g, '');
  return normalizedPostal.length > 0 && normalizedPostal.length < 4;
}

export function reconcileDraftCustomerAutosaveAcknowledgement({
  customerMode,
  customerForm,
  newCustomer,
  acknowledgedPayload,
  savedCustomer,
}: {
  customerMode: 'existing' | 'new' | null;
  customerForm: EditableCustomer;
  newCustomer: EditableCustomer;
  acknowledgedPayload: EditableCustomer;
  savedCustomer: EditableCustomer;
}): { settled: boolean; autosaveKey?: string } {
  const activeCustomer = customerMode === 'new' ? newCustomer : customerForm;
  if (JSON.stringify(activeCustomer) !== JSON.stringify(acknowledgedPayload)) {
    return { settled: false };
  }
  return { settled: true, autosaveKey: JSON.stringify(savedCustomer) };
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

function toEditableBarRows(rows: PosWorkspaceBarRow[] | undefined): EditableBarRow[] {
  return (rows || []).map((row) => ({
    row_key: row.row_key,
    bar_type: row.bar_type,
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

function toEditablePtPdRows(rows: PosWorkspacePtPdRow[] | undefined): EditablePtPdRow[] {
  return (rows || []).map((row) => ({
    row_key: row.row_key,
    metal: row.metal,
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

function toEditableExtraRows(rows: PosWorkspaceExtraRow[] | undefined): EditableExtraRow[] {
  return (rows || []).map((row) => ({
    row_key: row.row_key,
    kind: row.kind,
    label: row.label,
    metal: row.metal,
    karat: row.karat,
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
  barRows: EditableBarRow[] = [],
  ptpdRows: EditablePtPdRow[] = [],
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
  // Sunucu sırasıyla aynı: altın → bar → gümüş → Pt/Pd.
  for (const row of barRows) {
    if (toNumeric(row.gram) <= 0) continue;
    generated.push({
      code: row.bar_type === 'gold' ? '6' : '7',
      label: row.label,
      fineness: row.lodighed,
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
  for (const row of ptpdRows) {
    if (toNumeric(row.gram) <= 0) continue;
    generated.push({
      code: row.metal === 'platinum' ? '8' : '9',
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

function computedPreviewBarRowsPayload(rows: EditableBarRow[], marketRates: PosWorkspaceMarketRates) {
  return rows.map((row) => {
    const liveRate = toNumeric(
      row.bar_type === 'gold' ? marketRates.gold_bar_dkk : marketRates.silver_bar_dkk,
    );
    const gram = toNumeric(row.gram);
    const avance = toNumeric(row.avance_percent);
    const unitPrice = liveRate * (1 - avance / 100);
    return {
      row_key: row.row_key,
      bar_type: row.bar_type,
      label: row.label,
      lodighed: row.lodighed,
      purity_percentage: normalizeTextInput(row.purity_percentage || '0'),
      gram: normalizeTextInput(row.gram || '0'),
      avance_percent: normalizeTextInput(row.avance_percent || '0'),
      rate_dkk: quantize2(liveRate),
      unit_price_dkk: quantize2(unitPrice),
      line_total_dkk: quantize2(unitPrice * gram),
    };
  });
}

function computedPreviewPtPdRowsPayload(rows: EditablePtPdRow[], marketRates: PosWorkspaceMarketRates) {
  return rows.map((row) => {
    const liveRate = toNumeric(
      row.metal === 'platinum' ? marketRates.platinum_dkk : marketRates.palladium_dkk,
    );
    const gram = toNumeric(row.gram);
    const avance = toNumeric(row.avance_percent);
    const unitPrice = liveRate * (1 - avance / 100);
    return {
      row_key: row.row_key,
      metal: row.metal,
      label: row.label,
      lodighed: row.lodighed,
      purity_percentage: normalizeTextInput(row.purity_percentage || '0'),
      gram: normalizeTextInput(row.gram || '0'),
      avance_percent: normalizeTextInput(row.avance_percent || '0'),
      rate_dkk: quantize2(liveRate),
      unit_price_dkk: quantize2(unitPrice),
      line_total_dkk: quantize2(unitPrice * gram),
    };
  });
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
  return rows.map((row) => {
    // Karat oranı saflığı zaten içerir; sunucu matematiğiyle aynı:
    // unit = rate × (1 − avance/100), saflık ikinci kez uygulanmaz.
    const liveRate = toNumeric(marketRates.gold_rates_dkk?.[normalizeRateKey(row.karat)]);
    const gram = toNumeric(row.gram);
    const avance = toNumeric(row.avance_percent);
    const unitPrice = liveRate * (1 - avance / 100);
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
  return rows.map((row) => {
    const liveRate = toNumeric(marketRates.silver_rates_dkk?.[normalizeRateKey(row.lodighed)]);
    const gram = toNumeric(row.gram);
    const avance = toNumeric(row.avance_percent);
    const unitPrice = liveRate * (1 - avance / 100);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  // Müşteri ekranındaki "Alış başlat" bir kez uygulanır; param temizlenmeden
  // yeniden tetiklenmesin diye ref'te tutulur.
  const pendingCustomerParamRef = useRef<string | null>(searchParams.get('customer'));
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
  const [barRows, setBarRows] = useState<EditableBarRow[]>([]);
  const [ptpdRows, setPtpdRows] = useState<EditablePtPdRow[]>([]);
  const [extraRows, setExtraRows] = useState<EditableExtraRow[]>([]);
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
  // Başlangıç yalnızca yer tutucudur; workspace yüklenince oranlar backend
  // profilinden gelir. localStorage'daki bayat snapshot ("382 girildi, 2850
  // kaldı" hatası) artık okunmaz.
  const [marketRates, setMarketRates] = useState<PosWorkspaceMarketRates>(() =>
    normalizeMarketRatesInput(
      buildDefaultMarketRates(DEFAULT_MARKET_GOLD_DKK, DEFAULT_MARKET_SILVER_DKK, DEFAULT_MARKET_FX),
    ),
  );
  const [afgNote, setAfgNote] = useState('');
  const [purchaseVatEnabled, setPurchaseVatEnabled] = useState(false);
  const [calculators, setCalculators] = useState<PosWorkspaceCalculators>({ gold_rows: [], silver_rows: [] });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank');
  const [priceOpen, setPriceOpen] = useState(false);
  const goldRowsRef = useRef<EditableGoldRow[]>([]);
  const barRowsRef = useRef<EditableBarRow[]>([]);
  // Finalize sürerken autosave/auto-regen PUT'ları susturulur; yarışan geç
  // PUT'ların 409/400 toast'ları ("3 hata" gözlemi) bu kaynaktan geliyordu.
  const finalizeInFlightRef = useRef(false);
  const ptpdRowsRef = useRef<EditablePtPdRow[]>([]);
  const extraRowsRef = useRef<EditableExtraRow[]>([]);
  const silverRowsRef = useRef<EditableSilverRow[]>([]);

  const autosaveKeyRef = useRef('');
  const customerAutosaveKeyRef = useRef('');
  const initializedSessionRef = useRef<string | null>(null);
  const workspaceRevisionRef = useRef(1);
  const queuedSectionsPayloadRef = useRef<ReturnType<typeof workspaceRowsPayload> | null>(null);
  const queuedCustomerPayloadRef = useRef<EditableCustomer | null>(null);
  const sectionsSaveInFlightRef = useRef(false);
  const customerSaveInFlightRef = useRef(false);
  const sectionsSavePromiseRef = useRef<Promise<void> | null>(null);
  const customerSavePromiseRef = useRef<Promise<void> | null>(null);
  const workspaceWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const clerkPreviewSocketRef = useRef<WebSocket | null>(null);
  const clerkPreviewReconnectRef = useRef<number | null>(null);
  const pendingPreviewPayloadRef = useRef<Record<string, unknown> | null>(null);
  const previewSequenceRef = useRef(0);
  const artifactRetryInFlightRef = useRef<Set<string>>(new Set());
  const autosaveRetryTimerRef = useRef<number | null>(null);
  const autosaveRetryAttemptRef = useRef(0);
  const autosaveWarningShownRef = useRef(false);
  const draftBaselineRef = useRef<PosWorkspace | null>(null);
  const draftGenerationRef = useRef(0);
  const draftPersistTimerRef = useRef<number | null>(null);
  const draftRecoverySessionRef = useRef<string | null>(null);
  const draftRecoveryLoadedRef = useRef(false);
  // A GET can resolve with the same server revision after a user has edited
  // locally but before the debounced PUT is queued.  Revision equality alone
  // cannot distinguish that response from a clean read; track the local edit
  // sequence so a late response never rehydrates over an unsaved keystroke.
  const localEditGenerationRef = useRef(0);
  const observedLocalFingerprintRef = useRef('');
  const observedLocalSessionRef = useRef<string | null>(null);

  function markLocalWorkspaceEdit() {
    if (workspace?.session.id && initializedSessionRef.current === workspace.session.id) {
      // Mark the edit synchronously.  The fingerprint effect remains a
      // second line of defence, but a pending GET must be invalidated before
      // its promise can resolve in the same tick.
      localEditGenerationRef.current += 1;
    }
  }

  function emitWorkspaceArtifactSync(
    sessionId: string,
    source: string,
    artifactState?: PosWorkspace['artifact_sync_state'],
  ) {
    emitArtifactSync({
      kind: 'alis-workspace',
      key: sessionId,
      source,
    });
    if (source !== 'alis-ui' || artifactState !== 'error' || artifactRetryInFlightRef.current.has(sessionId)) {
      return;
    }
    artifactRetryInFlightRef.current.add(sessionId);
    void apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${sessionId}/artifact/sync`, {
      method: 'POST',
    })
      .then((synced) => {
        emitArtifactSync({
          kind: 'alis-workspace',
          key: sessionId,
          source: 'alis-artifact-retry',
          artifact_updated_at: new Date().toISOString(),
        });
        if (synced.artifact_sync_state === 'error') {
          // The next core save will schedule another retry; do not create a
          // tight loop while the backend or Office projection is unavailable.
        }
      })
      .catch(() => {
        // Core workspace data is already saved.  Keep the local warning/state
        // and allow the next edit or explicit Office open to retry.
      })
      .finally(() => artifactRetryInFlightRef.current.delete(sessionId));
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

  function isStaleWorkspaceResponse(data: PosWorkspace) {
    return initializedSessionRef.current === data.session.id
      && (data.workspace_revision || 1) < workspaceRevisionRef.current;
  }

  function localWorkspaceFingerprint() {
    if (!workspace?.session.id) return '';
    const customer = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    return JSON.stringify({
      session_id: workspace.session.id,
      sections: workspaceRowsPayload(
        goldRows,
        silverRows,
        bankInfo,
        marketRates,
        afgNote,
        purchaseVatEnabled,
        calculators,
        paymentMethod,
        numbering,
        invoiceGoldMode,
        invoiceGoldRows,
        invoiceGoldFooterLines,
        invoiceMiscMode,
        invoiceMiscRows,
        barRowsRef.current,
        ptpdRowsRef.current,
        extraRowsRef.current,
      ),
      customer,
    });
  }

  function applyWorkspace(
    data: PosWorkspace,
    _options?: {
      paymentMethodOverride?: PaymentMethod;
    },
  ) {
    if (isStaleWorkspaceResponse(data)) return false;
    initializedSessionRef.current = data.session.id;
    workspaceRevisionRef.current = data.workspace_revision || 1;
    draftBaselineRef.current = data;
    const editableCustomer = toEditableCustomer(data);
    const hasDraftCustomerShadow = !data.customer.customer_id && hasEditableCustomerData(editableCustomer);
    setCustomerForm(editableCustomer);
    setNewCustomer(hasDraftCustomerShadow ? editableCustomer : EMPTY_CUSTOMER);
    setGoldRows(toEditableGoldRows(data.gold_rows));
    setBarRows(toEditableBarRows(data.bar_rows));
    setPtpdRows(toEditablePtPdRows(data.ptpd_rows));
    setExtraRows(toEditableExtraRows(data.extra_rows));
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
    setPurchaseVatEnabled(data.purchase_vat_enabled === true);
    setCalculators(data.calculators);
    const resolvedPaymentMethod: PaymentMethod = 'bank';
    setPaymentMethod(resolvedPaymentMethod);
    setCustomerMode(hasDraftCustomerShadow ? 'new' : null);
    const sectionsPayload = workspaceRowsPayload(
      toEditableGoldRows(data.gold_rows),
      toEditableSilverRows(data.silver_rows),
      resolvedBankInfo,
      normalizeMarketRatesInput(data.market_rates),
      data.afg_note || '',
      data.purchase_vat_enabled === true,
      data.calculators,
      resolvedPaymentMethod,
      toEditableNumbering(data.numbering_preview),
      data.invoice_gold_mode,
      toEditableInvoiceGoldRows(data.invoice_gold.rows),
      [...data.invoice_gold.footer_lines, '', '', ''].slice(0, 3),
      data.invoice_misc_mode,
      toEditableInvoiceMiscRows(data.invoice_misc.rows),
      toEditableBarRows(data.bar_rows),
      toEditablePtPdRows(data.ptpd_rows),
      toEditableExtraRows(data.extra_rows),
    );
    // Legacy drafts with grams but zero persisted pricing are rendered from
    // the resolved rate matrix, then persisted through the normal revisioned
    // PUT queue.  GET/build stays read-only.
    autosaveKeyRef.current = data.needs_price_repair ? '' : JSON.stringify(sectionsPayload);
    customerAutosaveKeyRef.current = JSON.stringify(editableCustomer);
    return true;
  }

  function activateWorkspace(
    data: PosWorkspace,
    options?: {
      paymentMethodOverride?: PaymentMethod;
    },
  ) {
    if (draftRecoverySessionRef.current !== data.session.id) {
      draftRecoverySessionRef.current = null;
      draftRecoveryLoadedRef.current = false;
    }
    queuedSectionsPayloadRef.current = null;
    queuedCustomerPayloadRef.current = null;
    if (!applyWorkspace(data, {
      paymentMethodOverride: options?.paymentMethodOverride ?? 'bank',
    })) return;
    setWorkspace(data);
    setDraftWorkspace(null);
    setActiveWorkspaceViewState('system');
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
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui', data.artifact_sync_state);
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
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui', data.artifact_sync_state);
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

  const cancelUnicontaMutation = useMutation({
    mutationFn: (payload: { sequence_no: number; reason: string }) =>
      apiRequest<{
        ok: boolean;
        message?: string | null;
        idempotent?: boolean;
        credit_note_number?: string | null;
        cancelled_at?: string | null;
        cancel_reason?: string | null;
        uniconta_sync_status?: string | null;
      }>(`/api/v2/uniconta/invoice/cancel-from-pos/${payload.sequence_no}`, {
        method: 'POST',
        body: JSON.stringify({ reason: payload.reason }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (result) => {
      if (result?.idempotent) {
        toast.info(
          'Zaten iptal edilmiş',
          result.credit_note_number
            ? `Bu belge daha önce Uniconta'da iptal edilmiş (kreditnota no: ${result.credit_note_number}).`
            : 'Bu belge daha önce iptal edilmiş.',
        );
      } else if (result?.ok) {
        toast.success(
          'Uniconta iptal başarılı',
          result.credit_note_number ? `Kreditnota no: ${result.credit_note_number}` : undefined,
        );
      } else {
        toast.warning('Uniconta iptal tamamlanamadı', result?.message || undefined);
      }
      void queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['pos', 'alis', 'detail'] });
      void queryClient.invalidateQueries({ queryKey: ['uniconta', 'invoices'] });
      emitArtifactSync({ kind: 'uniconta', key: 'live', source: 'alis-ui' });
    },
    onError: (error) => {
      toast.error('Uniconta iptal hatası', error instanceof Error ? error.message : undefined);
    },
  });

  const handleCancelUnicontaInvoice = async (item: PosSavedPurchaseListItem) => {
    if (cancelUnicontaMutation.isPending) return;
    if (item.uniconta_sync_status !== 'synced' || !item.uniconta_invoice_number) {
      toast.warning(
        'İptal yapılamaz',
        'Bu belge Uniconta\'ya senkronize edilmemiş; iptal edilecek fatura yok.',
      );
      return;
    }
    const result = await confirm({
      title: 'Uniconta faturasını iptal et',
      message:
        `Fatura #${item.uniconta_invoice_number} için Uniconta'da kreditnota oluşturulacak.\n` +
        `Bu işlem geri alınamaz.`,
      confirmText: 'Kreditnota oluştur',
      cancelText: 'Vazgeç',
      variant: 'danger',
      input: {
        label: 'İptal sebebi (Uniconta audit\'inde görünür)',
        placeholder: `Faktura #${item.uniconta_invoice_number} iptal — operatör onayı`,
        required: true,
        multiline: true,
      },
    });
    if (typeof result !== 'string' || !result.trim()) return;
    cancelUnicontaMutation.mutate({ sequence_no: item.sequence_no, reason: result.trim() });
  };

  const selectCustomerMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/customer/select`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, base_revision: workspaceRevisionRef.current }),
      }),
    onSuccess: (data) => {
      if (!applyWorkspace(data)) return;
      setWorkspace(data);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui', data.artifact_sync_state);
      setCustomerSearchTerm('');
      setNewCustomer(EMPTY_CUSTOMER);
      setCustomerMode(null);
    },
    onError: (error) => {
      toast.warning('Müşteri seçilemedi', error instanceof Error ? error.message : 'Workspace başka bir yüzeyde değişti.');
    },
  });

  useEffect(() => {
    const customerId = pendingCustomerParamRef.current;
    if (!customerId || !workspace?.session.id) return;
    pendingCustomerParamRef.current = null;
    if (!workspace.customer.customer_id) {
      selectCustomerMutation.mutate({ customer_id: customerId });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('customer');
    // 'Yeni alış başlat' butonunun eklediği start bayrağı da URL'de kalmasın.
    next.delete('start');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.session.id]);

  const updateDraftCustomerMutation = useMutation({
    mutationFn: (payload: EditableCustomer) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/draft-customer`, {
        method: 'PUT',
        body: JSON.stringify({ ...customerRequestPayload(payload), base_revision: workspaceRevisionRef.current }),
      }),
    onSuccess: (data, payload) => {
      if (initializedSessionRef.current !== data.session.id) return;
      if (isStaleWorkspaceResponse(data)) return;
      // Draft-customer saves originate from newCustomer. Comparing against
      // customerForm here would make every successful new draft look stale,
      // leaving its autosave key behind and blocking a view switch/finalize.
      const acknowledgement = reconcileDraftCustomerAutosaveAcknowledgement({
        customerMode,
        customerForm,
        newCustomer,
        acknowledgedPayload: payload,
        savedCustomer: toEditableCustomer(data),
      });
      if (!acknowledgement.settled) {
        workspaceRevisionRef.current = data.workspace_revision || workspaceRevisionRef.current;
        setWorkspace((current) => current ? { ...current, workspace_revision: data.workspace_revision } : data);
        return;
      }
      if (!applyWorkspace(data)) return;
      setWorkspace(data);
      customerAutosaveKeyRef.current = acknowledgement.autosaveKey || '';
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui', data.artifact_sync_state);
    },
    onError: (error) => {
      if (!autosaveWarningShownRef.current) {
        autosaveWarningShownRef.current = true;
        toast.warning(
          'Müşteri değişikliği beklemeye alındı',
          error instanceof Error ? error.message : 'Bağlantı yeniden kurulunca otomatik denenecek.',
        );
      }
    },
  });

  const updateSectionsMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof workspaceRowsPayload>) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/rows`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, base_revision: workspaceRevisionRef.current }),
      }),
    onSuccess: (data, payload) => {
      if (initializedSessionRef.current !== data.session.id) return;
      if (isStaleWorkspaceResponse(data)) return;
      const currentSectionsPayload = workspaceRowsPayload(
        goldRowsRef.current,
        silverRowsRef.current,
        bankInfo,
        marketRates,
        afgNote,
        purchaseVatEnabled,
        calculators,
        paymentMethod,
        numbering,
        invoiceGoldMode,
        invoiceGoldRows,
        invoiceGoldFooterLines,
        invoiceMiscMode,
        invoiceMiscRows,
        barRowsRef.current,
        ptpdRowsRef.current,
        extraRowsRef.current,
      );
      if (JSON.stringify(currentSectionsPayload) !== JSON.stringify(payload)) {
        workspaceRevisionRef.current = data.workspace_revision || workspaceRevisionRef.current;
        setWorkspace((current) => current ? { ...current, workspace_revision: data.workspace_revision } : data);
        return;
      }
      workspaceRevisionRef.current = data.workspace_revision || workspaceRevisionRef.current;
      setWorkspace(data);
      setGoldRows(toEditableGoldRows(data.gold_rows));
      setBarRows(toEditableBarRows(data.bar_rows));
      setPtpdRows(toEditablePtPdRows(data.ptpd_rows));
      setExtraRows(toEditableExtraRows(data.extra_rows));
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
      setPurchaseVatEnabled(data.purchase_vat_enabled === true);
      setCalculators(data.calculators);
      setPaymentMethod('bank');
      autosaveKeyRef.current = JSON.stringify(payload);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui', data.artifact_sync_state);
    },
    onError: (error) => {
      if (!autosaveWarningShownRef.current) {
        autosaveWarningShownRef.current = true;
        toast.warning(
          'Alış satırları beklemeye alındı',
          error instanceof Error ? error.message : 'Bağlantı yeniden kurulunca otomatik denenecek.',
        );
      }
    },
  });

  const updateCustomerMutation = useMutation({
    mutationFn: (payload: EditableCustomer) =>
      apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace?.session.id}/customer`, {
        method: 'PUT',
        body: JSON.stringify({ ...customerRequestPayload(payload), base_revision: workspaceRevisionRef.current }),
      }),
    onSuccess: (data, payload) => {
      if (initializedSessionRef.current !== data.session.id) return;
      if (isStaleWorkspaceResponse(data)) return;
      const newerCustomerEdit = JSON.stringify(customerForm) !== JSON.stringify(payload);
      if (newerCustomerEdit) {
        workspaceRevisionRef.current = data.workspace_revision || workspaceRevisionRef.current;
        setWorkspace((current) => current ? { ...current, workspace_revision: data.workspace_revision } : data);
        return;
      }
      if (!applyWorkspace(data)) return;
      setWorkspace(data);
      customerAutosaveKeyRef.current = JSON.stringify(payload);
      emitWorkspaceArtifactSync(data.session.id, 'alis-ui', data.artifact_sync_state);
    },
    onError: (error) => {
      if (!autosaveWarningShownRef.current) {
        autosaveWarningShownRef.current = true;
        toast.warning(
          'Müşteri değişikliği beklemeye alındı',
          error instanceof Error ? error.message : 'Bağlantı yeniden kurulunca otomatik denenecek.',
        );
      }
    },
  });

  function isTransientAutosaveError(error: unknown) {
    return error instanceof TransportError || (error instanceof ApiError && error.status >= 500);
  }

  function scheduleAutosaveRetry() {
    if (autosaveRetryTimerRef.current !== null || !workspace?.session.id) return;
    const attempt = autosaveRetryAttemptRef.current;
    const delay = Math.min(10_000, 1_000 * 2 ** attempt);
    autosaveRetryAttemptRef.current = Math.min(attempt + 1, 4);
    autosaveRetryTimerRef.current = window.setTimeout(() => {
      autosaveRetryTimerRef.current = null;
      void Promise.all([flushQueuedSectionsSave(), flushQueuedCustomerSave()]).finally(() => {
        if (queuedSectionsPayloadRef.current || queuedCustomerPayloadRef.current) {
          scheduleAutosaveRetry();
        }
      });
    }, delay);
  }

  function markAutosaveSuccess() {
    autosaveRetryAttemptRef.current = 0;
    autosaveWarningShownRef.current = false;
  }

  async function flushQueuedSectionsSave() {
    if (sectionsSavePromiseRef.current) return sectionsSavePromiseRef.current;
    if (!initializedSessionRef.current || !queuedSectionsPayloadRef.current) return;

    sectionsSaveInFlightRef.current = true;
    const promise = enqueueWorkspaceWrite(async () => {
      try {
        while (queuedSectionsPayloadRef.current) {
          const payload = queuedSectionsPayloadRef.current;
          queuedSectionsPayloadRef.current = null;
          if (JSON.stringify(payload) === autosaveKeyRef.current) continue;
          try {
            await updateSectionsMutation.mutateAsync(payload);
            markAutosaveSuccess();
          } catch (error) {
            // Keep the newest unsaved payload.  Dropping it here was the
            // reason a temporary backend outage lost edits and later GETs
            // appeared to resurrect the old values.
            if (!queuedSectionsPayloadRef.current) queuedSectionsPayloadRef.current = payload;
            if (isTransientAutosaveError(error)) scheduleAutosaveRetry();
            break;
          }
        }
      } finally {
        sectionsSaveInFlightRef.current = false;
        sectionsSavePromiseRef.current = null;
      }
    });
    sectionsSavePromiseRef.current = promise;
    return promise;
  }

  function queueSectionsSave(payload: ReturnType<typeof workspaceRowsPayload>) {
    queuedSectionsPayloadRef.current = payload;
    void flushQueuedSectionsSave();
  }

  function enqueueWorkspaceWrite(task: () => Promise<void>) {
    const previous = workspaceWriteChainRef.current.catch(() => undefined);
    const next = previous.then(task);
    workspaceWriteChainRef.current = next.catch(() => undefined);
    return next;
  }

  async function flushQueuedCustomerSave() {
    if (customerSavePromiseRef.current) return customerSavePromiseRef.current;
    if (!initializedSessionRef.current || !queuedCustomerPayloadRef.current) return;

    customerSaveInFlightRef.current = true;
    const promise = enqueueWorkspaceWrite(async () => {
      try {
        while (queuedCustomerPayloadRef.current) {
          const payload = queuedCustomerPayloadRef.current;
          queuedCustomerPayloadRef.current = null;
          if (JSON.stringify(payload) === customerAutosaveKeyRef.current) continue;
          try {
            if (workspace?.customer.customer_id) {
              await updateCustomerMutation.mutateAsync(payload);
            } else {
              await updateDraftCustomerMutation.mutateAsync(payload);
            }
            markAutosaveSuccess();
          } catch (error) {
            if (!queuedCustomerPayloadRef.current) queuedCustomerPayloadRef.current = payload;
            if (isTransientAutosaveError(error)) scheduleAutosaveRetry();
            break;
          }
        }
      } finally {
        customerSaveInFlightRef.current = false;
        customerSavePromiseRef.current = null;
      }
    });
    customerSavePromiseRef.current = promise;
    return promise;
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
    barRows?: EditableBarRow[];
    ptpdRows?: EditablePtPdRow[];
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
    const rawPostal = previewCustomer.postal_code.replace(/\D/g, '');
    const committedPostal = workspace.customer.postal_code || '';
    const previewPostal = rawPostal.length === 4 || rawPostal.length === 0 ? rawPostal : committedPostal;

    return {
      workspace_revision: workspace.workspace_revision || 1,
      customer_name: previewCustomer.name || '',
      customer_phone: previewCustomer.phone || '',
      customer_email: previewCustomer.email || '',
      customer_address: previewCustomer.address || '',
      customer_postal_code: previewPostal,
      customer_city: previewCustomer.city || '',
      customer_cpr: previewCustomer.cpr_number || '',
      customer_identity_doc_number: previewCustomer.identity_doc_number || '',
      preview_gold_rows: computedPreviewGoldRowsPayload(options?.goldRows ?? goldRowsRef.current, marketRates),
      preview_silver_rows: computedPreviewSilverRowsPayload(options?.silverRows ?? silverRowsRef.current, marketRates),
      preview_bar_rows: computedPreviewBarRowsPayload(options?.barRows ?? barRowsRef.current, marketRates),
      preview_ptpd_rows: computedPreviewPtPdRowsPayload(options?.ptpdRows ?? ptpdRowsRef.current, marketRates),
    };
  }

  const finalizeMutation = useMutation({
    onSettled: () => {
      finalizeInFlightRef.current = false;
    },
    mutationFn: () =>
      apiRequest<PosWorkspaceFinalizeResponse>(`/api/v2/alis/workspace/${workspace?.session.id}/finalize`, {
        method: 'POST',
        body: JSON.stringify({
          notes: afgNote.trim() || null,
          bank_info: {
            reg_number: bankInfo.reg_number || '',
            account_number: bankInfo.account_number || '',
          },
          payment_method: 'bank',
          purchase_vat_enabled: purchaseVatEnabled,
          purchase_vat_rate_percent: purchaseVatEnabled ? 25 : 0,
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
        void clearPendingDraft(closedSessionId);
      }
      draftRecoverySessionRef.current = null;
      draftRecoveryLoadedRef.current = false;
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
      requestCriticalBackup();
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
        void clearPendingDraft(closedSessionId);
      }
      draftRecoverySessionRef.current = null;
      draftRecoveryLoadedRef.current = false;
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
    if (finalizeInFlightRef.current) return;
    setInvoiceGoldRows((current) => buildAutoInvoiceGoldRows(goldRows, silverRows, current, barRows, ptpdRows));
    setInvoiceGoldFooterLines(['', '', '']);
  }, [workspace?.session.id, goldRows, silverRows, barRows, ptpdRows, invoiceGoldMode]);

  useEffect(() => {
    if (!workspace?.session.id || invoiceMiscMode !== 'auto') return;
    setInvoiceMiscRows((current) => (current.length > 0 ? buildDefaultInvoiceMiscRows().map((row, index) => ({ ...row, row_key: current[index]?.row_key || row.row_key })) : buildDefaultInvoiceMiscRows()));
  }, [workspace?.session.id, invoiceMiscMode]);

  useEffect(() => {
    return listenArtifactSync((signal) => {
      if (signal.source === 'alis-ui') return;

      // 1) Office/Excel workbook senkronizasyonu: yalnız alis-workspace kind + session key match
      if (signal.kind === 'alis-workspace') {
        // Only the visible system surface may consume an Office invalidation.
        // While Office owns the session, the hidden system form must not
        // rehydrate itself or cancel a local edit.
        if (activeWorkspaceView !== 'system') return;
        const activeSessionId = workspace?.session.id || null;
        const draftSessionId = draftWorkspace?.session.id || null;
        if (!activeSessionId && !draftSessionId) return;
        if (signal.key !== activeSessionId && signal.key !== draftSessionId) return;

        if (activeSessionId && signal.key === activeSessionId) {
          if (hasPendingWorkspaceSync()) return;
          const requestGeneration = localEditGenerationRef.current;
          void apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${activeSessionId}`).then((data) => {
            if (initializedSessionRef.current !== data.session.id) return;
            if (localEditGenerationRef.current !== requestGeneration) return;
            if (hasPendingWorkspaceSync()) return;
            if (!applyWorkspace(data)) return;
            setWorkspace(data);
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
  }, [activeWorkspaceView, draftWorkspace?.session.id, queryClient, workspace?.session.id, workspaceQuery]);

  useEffect(() => {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;
    const requestGeneration = localEditGenerationRef.current;

    void apiRequest<PosWorkspace>(`/api/v2/alis/workspace/${workspace.session.id}`)
      .then((data) => {
        if (initializedSessionRef.current !== data.session.id) return;
        if (localEditGenerationRef.current !== requestGeneration) return;
        if (hasPendingWorkspaceSync()) return;
        if (!applyWorkspace(data)) return;
        setWorkspace(data);
      })
      .catch(() => {
        // Keep the current local state if the authoritative refresh fails during view switches.
      });
  }, [activeWorkspaceView, workspace?.session.id]);

  useEffect(() => {
    const sessionId = workspace?.session.id || null;
    if (!sessionId) {
      observedLocalSessionRef.current = null;
      observedLocalFingerprintRef.current = '';
      return;
    }

    const fingerprint = localWorkspaceFingerprint();
    if (observedLocalSessionRef.current !== sessionId) {
      observedLocalSessionRef.current = sessionId;
      observedLocalFingerprintRef.current = fingerprint;
      return;
    }
    if (observedLocalFingerprintRef.current !== fingerprint) {
      observedLocalFingerprintRef.current = fingerprint;
      localEditGenerationRef.current += 1;
    }
    // The fingerprint helper intentionally reads the current form state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace?.session.id,
    workspace?.customer.customer_id,
    customerMode,
    customerForm,
    newCustomer,
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
  ]);

  useEffect(() => {
    goldRowsRef.current = goldRows;
  }, [goldRows]);

  useEffect(() => {
    barRowsRef.current = barRows;
  }, [barRows]);
  useEffect(() => {
    ptpdRowsRef.current = ptpdRows;
  }, [ptpdRows]);
  useEffect(() => {
    extraRowsRef.current = extraRows;
  }, [extraRows]);

  useEffect(() => {
    silverRowsRef.current = silverRows;
  }, [silverRows]);

  useEffect(() => {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;
    if (finalizeInFlightRef.current) return;
    const payload = workspaceRowsPayload(
      goldRows,
      silverRows,
      bankInfo,
      marketRates,
      afgNote,
      purchaseVatEnabled,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
      barRows,
      ptpdRows,
      extraRows,
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
    // 0.3.6/0.3.7 dersi: payload REF'ten okunup diziler deps dışında kalınca
    // bar/ptpd düzenlemeleri hiç PUT edilmiyordu (TOPLAM 0, müşteri ekranı boş).
    // Artık TÜM satır bölümleri state olarak hem payload'a hem deps'e girer.
  }, [
    workspace?.session.id,
    goldRows,
    silverRows,
    barRows,
    ptpdRows,
    extraRows,
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
    purchaseVatEnabled,
    calculators,
    // updateSectionsMutation referansı her render'da yeni — dep'ten çıkarıldı,
    // queueSectionsSave closure üzerinden günceli okur.
  ]);

  useEffect(() => {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return;
    const nextPayload = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    if (!nextPayload) return;
    if (hasPartialPostalCode(nextPayload)) return;
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
    if (!workspace?.session.id || !isTauriRuntime()) return;
    if (draftPersistTimerRef.current !== null) window.clearTimeout(draftPersistTimerRef.current);
    draftPersistTimerRef.current = window.setTimeout(() => {
      draftPersistTimerRef.current = null;
      void persistPendingDraftSnapshot();
    }, 150);
    return () => {
      if (draftPersistTimerRef.current !== null) window.clearTimeout(draftPersistTimerRef.current);
      draftPersistTimerRef.current = null;
    };
    // The snapshot helper reads the latest refs/state from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace?.session.id,
    workspace?.workspace_revision,
    goldRows,
    silverRows,
    bankInfo,
    marketRates,
    afgNote,
    calculators,
    numbering,
    invoiceGoldMode,
    invoiceGoldRows,
    invoiceGoldFooterLines,
    invoiceMiscMode,
    invoiceMiscRows,
    customerForm,
    newCustomer,
    customerMode,
  ]);

  useEffect(() => {
    if (!workspace?.session.id || !isTauriRuntime()) return;
    if (draftRecoverySessionRef.current === workspace.session.id) return;
    draftRecoverySessionRef.current = workspace.session.id;
    void recoverPendingDraftForWorkspace(workspace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.session.id]);

  useEffect(() => {
    if (!workspace?.session.id || !isTauriRuntime() || !draftRecoveryLoadedRef.current) return;
    if (hasDirtyWorkspaceChanges() || hasPendingWorkspaceAutosave()) return;
    void clearPendingDraft(workspace.session.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    workspace?.session.id,
    workspace?.workspace_revision,
    goldRows,
    silverRows,
    customerForm,
    newCustomer,
    customerMode,
    bankInfo,
    marketRates,
    afgNote,
    calculators,
    numbering,
    invoiceGoldMode,
    invoiceGoldRows,
    invoiceGoldFooterLines,
    invoiceMiscMode,
    invoiceMiscRows,
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
        buildWsUrl(`/api/pos/sessions/${workspace.session.id}/ws`),
        ['seroguld-auth', token],
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
    // Eski sürümlerin bıraktığı bayat snapshot'lar temizlenir; oranların tek
    // kaynağı backend profili + workspace payload'ıdır.
    window.localStorage.removeItem('market_gold');
    window.localStorage.removeItem('market_silver');
    window.localStorage.removeItem('market_fx');
  }, []);

  useEffect(() => {
    clearLegacyPaymentMethodPreference();
  }, []);

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
    openWorkspaceMutation.mutate({
      payment_method: 'bank',
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
            void flushPendingWorkspaceSync().then(() => {
              if (!hasPendingWorkspaceSync()) finalizeMutation.mutate();
            });
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
        identity_doc_type: newCustomer.identity_doc_type || null,
        identity_doc_number: newCustomer.identity_doc_number || null,
        identity_doc_country: newCustomer.identity_doc_country || null,
      },
    });
  }

  // Satır bölümü kayıt defteri: state + ref + set + preview anahtarı TEK yerde.
  // 0.3.6/0.3.7'de bar/ptpd için update fonksiyonları kopyalanırken preview
  // çağrısı unutulmuştu; registry ile yeni bölüm eklemek tek girdi demek ve
  // preview/autosave zinciri yapısal olarak atlanamaz.
  type SectionKey = 'gold' | 'silver' | 'bar' | 'ptpd';
  function updateSectionRow(section: SectionKey, rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    markLocalWorkspaceEdit();
    const normalized = normalizeTextInput(value);
    const apply = <T extends { row_key: string }>(rows: T[]): T[] =>
      rows.map((row) => (row.row_key === rowKey ? { ...row, [field]: normalized } : row));
    if (section === 'gold') {
      const nextRows = apply(goldRowsRef.current);
      goldRowsRef.current = nextRows;
      setGoldRows(nextRows);
      const payload = buildPreviewPayload({ goldRows: nextRows });
      if (payload) sendClerkPreview(payload);
      return;
    }
    if (section === 'silver') {
      const nextRows = apply(silverRowsRef.current);
      silverRowsRef.current = nextRows;
      setSilverRows(nextRows);
      const payload = buildPreviewPayload({ silverRows: nextRows });
      if (payload) sendClerkPreview(payload);
      return;
    }
    if (section === 'bar') {
      const nextRows = apply(barRowsRef.current);
      barRowsRef.current = nextRows;
      setBarRows(nextRows);
      const payload = buildPreviewPayload({ barRows: nextRows });
      if (payload) sendClerkPreview(payload);
      return;
    }
    const nextRows = apply(ptpdRowsRef.current);
    ptpdRowsRef.current = nextRows;
    setPtpdRows(nextRows);
    const payload = buildPreviewPayload({ ptpdRows: nextRows });
    if (payload) sendClerkPreview(payload);
  }

  function updateGoldRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    updateSectionRow('gold', rowKey, field, value);
  }

  // Hesaplayıcı "Aktar" hedefi gold:karat anahtarı taşır. 'gold:22b' sabit
  // grid'de yoktur (backend karat eşleşmesi); 22K-2 extra satırına yönlendirilir:
  // varsa mevcut satır güncellenir, yoksa satır oluşturulup gram doğrudan yazılır.
  function applyGoldCalculatorTarget(rowKey: string, totalWeight: string) {
    const karatKey = rowKey.replace(/^gold:/, '');
    if (karatKey !== '22b') {
      updateGoldRow(rowKey, 'gram', totalWeight);
      return;
    }
    const existing = extraRowsRef.current.find((row) => row.metal === 'gold' && row.karat === '22b');
    if (existing) {
      updateExtraRow(existing.row_key, 'gram', totalWeight);
      return;
    }
    addExtraRows([{ kind: 'quarter', metal: 'gold', karat: '22b', label: '22K-2', gram: Number(normalizeTextInput(totalWeight)) || 0 }]);
  }

  function updateSilverRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    updateSectionRow('silver', rowKey, field, value);
  }

  function updateBarRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    updateSectionRow('bar', rowKey, field, value);
  }

  function updatePtPdRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    updateSectionRow('ptpd', rowKey, field, value);
  }

  // R2-01 — dinamik kniv/çeyrek satırları.
  function updateExtraRow(rowKey: string, field: 'gram' | 'avance_percent', value: string) {
    markLocalWorkspaceEdit();
    const normalized = normalizeTextInput(value);
    // UX tuzağı önlemi: gram 0/boş bırakmak satırı SESSİZCE silmesin (backend
    // gram<=0 satırı kalıcılaştırmaz). Silme yalnız açık "Sil" butonuyla olur;
    // geçersiz/0 gram girişi önceki değeri korur.
    if (field === 'gram' && !(Number(normalized || '0') > 0)) return;
    const nextRows = extraRowsRef.current.map((row) =>
      row.row_key === rowKey ? { ...row, [field]: normalized } : row,
    );
    extraRowsRef.current = nextRows;
    setExtraRows(nextRows);
  }

  function deleteExtraRow(rowKey: string) {
    // R2-08 — satır silme: dinamik satırı listeden çıkar; autosave güncel toplamı yazar.
    markLocalWorkspaceEdit();
    const nextRows = extraRowsRef.current.filter((row) => row.row_key !== rowKey);
    extraRowsRef.current = nextRows;
    setExtraRows(nextRows);
  }

  // Hesaplayıcı blok aktarımı: çeyrek/kniv toplamını YENİ satır olarak ekler.
  function addExtraRows(
    rows: Array<{ kind: 'kniv' | 'quarter'; metal: 'gold' | 'silver'; karat: string; label: string; gram: number; allowEmptyGram?: boolean }>,
  ) {
    markLocalWorkspaceEdit();
    const stamp = Date.now();
    const created: EditableExtraRow[] = rows
      // allowEmptyGram: dropdown'dan eklenen 22K-2 (karat '22b') satırı gram 0 ile
      // oluşturulur; hesaplayıcıdan gelen satırlar ise yine gram > 0 şartına bağlı.
      .filter((row) => row.allowEmptyGram || row.gram > 0)
      .map((row, index) => {
        const rateStr = row.metal === 'gold'
          ? marketRates.gold_rates_dkk?.[row.karat]
          : marketRates.silver_rates_dkk?.[row.karat];
        const rate = Number(normalizeTextInput(String(rateStr ?? '0')));
        const gram = row.gram;
        const total = rate * gram;
        const karatNumeric = Number(String(row.karat).replace(/[^0-9.]/g, '')) || 0;  // '22b' → 22
        const purity = row.metal === 'gold'
          ? (karatNumeric / 24) * 100
          : (karatNumeric / 1000) * 100;
        return {
          row_key: `extra:${stamp}-${index}`,
          kind: row.kind,
          label: row.label,
          metal: row.metal,
          karat: row.karat,
          purity_percentage: purity.toFixed(2),
          gram: gram.toFixed(2),
          avance_percent: '0',
          rate_dkk: rate.toFixed(2),
          unit_price_dkk: rate.toFixed(2),
          line_total_dkk: total.toFixed(2),
        };
      });
    if (created.length === 0) return;
    const nextRows = [...extraRowsRef.current, ...created];
    extraRowsRef.current = nextRows;
    setExtraRows(nextRows);
  }

  function updateNumbering(field: keyof EditableWorkspaceNumbering, value: string) {
    markLocalWorkspaceEdit();
    setNumbering((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateInvoiceGoldRow(rowKey: string, field: 'code' | 'fineness' | 'gram', value: string) {
    markLocalWorkspaceEdit();
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
    markLocalWorkspaceEdit();
    setInvoiceGoldMode('manual');
    setInvoiceGoldFooterLines((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function updateInvoiceMiscRow(rowKey: string, field: 'text' | 'quantity' | 'unit_price_dkk', value: string) {
    markLocalWorkspaceEdit();
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
    if (hasPartialPostalCode(nextPayload)) return;
    if (nextPayload.name.trim().length > 0 && nextPayload.name.trim().length < 2) return;
    const serialized = JSON.stringify(nextPayload);
    if (serialized === customerAutosaveKeyRef.current) return;
    queueCustomerSave(nextPayload);
  }

  function handleResumeDraft() {
    if (!draftWorkspace) return;
    if (!applyWorkspace(draftWorkspace)) return;
    setWorkspace(draftWorkspace);
  }

  function handleExportDocument(item: PosSavedPurchaseListItem) {
    void downloadAuthedDocument(
      `/api/v2/alis/documents/${item.sequence_no}/export?format=xlsx`,
      `AFG-${item.document_number.replaceAll('/', '-')}.xlsx`,
    ).catch((error: unknown) => {
      toast.error('Belge indirilemedi', localizeApiError(error));
    });
  }

  function closePdfModal() {
    setPdfState((current) => {
      if (current.url) URL.revokeObjectURL(current.url);
      return { url: null, filename: '', loading: false, error: null };
    });
  }

  function handlePrintDocument(item: PosSavedPurchaseListItem) {
    // R2-13 — yazdırma doğrudan WebView2 native diyaloğuyla açılır
    // (eski openUnicontaPdfModal fallback'i Tauri'de sessizce yutuluyordu).
    void printAuthedDocument(`/api/v2/alis/documents/${item.sequence_no}/print?format=html`).catch(
      (error: unknown) => {
        toast.error('Belge yazdırılamadı', localizeApiError(error));
      },
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
      purchaseVatEnabled,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
      barRowsRef.current,
      ptpdRowsRef.current,
      extraRowsRef.current,
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
    if (hasPartialPostalCode(nextCustomerPayload)) return;
    if (nextCustomerPayload.name.trim().length > 0 && nextCustomerPayload.name.trim().length < 2) return;
    if (JSON.stringify(nextCustomerPayload) === customerAutosaveKeyRef.current) return;
    queuedCustomerPayloadRef.current = nextCustomerPayload;
    await flushQueuedCustomerSave();
  }

  async function handleWorkspaceViewChange(nextView: WorkspaceSurfaceView) {
    if (nextView === activeWorkspaceView) return;
    try {
      await flushPendingWorkspaceSync();
      if (hasPendingWorkspaceSync()) {
        toast.warning('Senkron tamamlanmadı', 'Güncel Alış değişiklikleri kaydedilmeden yüzey değiştirilemez.');
        return;
      }
    } catch {
      toast.warning('Senkron tamamlanmadı', 'Güncel Alış değişiklikleri kaydedilmeden yüzey değiştirilemez.');
      return;
    }
    setActiveWorkspaceViewState(nextView);
  }

  function handleResetInvoiceGoldToAuto() {
    setInvoiceGoldMode('auto');
    setInvoiceGoldRows((current) => buildAutoInvoiceGoldRows(goldRowsRef.current, silverRowsRef.current, current, barRowsRef.current, ptpdRowsRef.current));
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
    openWorkspaceMutation.mutate({
      customer_id: item.customer_id,
      payment_method: 'bank',
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

  function hasPendingWorkspaceSync() {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return false;
    if (
      updateSectionsMutation.isPending ||
      updateCustomerMutation.isPending ||
      updateDraftCustomerMutation.isPending ||
      queuedSectionsPayloadRef.current ||
      queuedCustomerPayloadRef.current
    ) {
      return true;
    }
    const sectionsPayload = workspaceRowsPayload(
      goldRowsRef.current,
      silverRowsRef.current,
      bankInfo,
      marketRates,
      afgNote,
      purchaseVatEnabled,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
      barRowsRef.current,
      ptpdRowsRef.current,
      extraRowsRef.current,
    );
    if (JSON.stringify(sectionsPayload) !== autosaveKeyRef.current) return true;

    const customerPayload = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    // Invalid/partial drafts are intentionally not autosaved, but they are
    // still dirty and must block a surface switch/finalize until corrected.
    return Boolean(customerPayload && JSON.stringify(customerPayload) !== customerAutosaveKeyRef.current);
  }

  function hasPendingWorkspaceAutosave() {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return false;
    return Boolean(
      updateSectionsMutation.isPending ||
        updateCustomerMutation.isPending ||
        updateDraftCustomerMutation.isPending ||
        queuedSectionsPayloadRef.current ||
        queuedCustomerPayloadRef.current,
    );
  }

  function hasDirtyWorkspaceChanges() {
    if (!workspace?.session.id || initializedSessionRef.current !== workspace.session.id) return false;
    const sectionsPayload = workspaceRowsPayload(
      goldRowsRef.current,
      silverRowsRef.current,
      bankInfo,
      marketRates,
      afgNote,
      purchaseVatEnabled,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
      barRowsRef.current,
      ptpdRowsRef.current,
      extraRowsRef.current,
    );
    if (JSON.stringify(sectionsPayload) !== autosaveKeyRef.current) return true;

    const customerPayload = workspace.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    return Boolean(customerPayload && JSON.stringify(customerPayload) !== customerAutosaveKeyRef.current);
  }

  function buildPendingDraftLocalSnapshot() {
    const sections = workspaceRowsPayload(
      goldRowsRef.current,
      silverRowsRef.current,
      bankInfo,
      marketRates,
      afgNote,
      purchaseVatEnabled,
      calculators,
      paymentMethod,
      numbering,
      invoiceGoldMode,
      invoiceGoldRows,
      invoiceGoldFooterLines,
      invoiceMiscMode,
      invoiceMiscRows,
      barRowsRef.current,
      ptpdRowsRef.current,
      extraRowsRef.current,
    );
    const customer = workspace?.customer.customer_id
      ? customerForm
      : customerMode === 'new'
        ? newCustomer
        : null;
    return { sections, customer };
  }

  async function persistPendingDraftSnapshot() {
    const currentWorkspace = workspace;
    const ownerKey = getCurrentUser()?.id;
    if (
      !currentWorkspace?.session.id
      || !ownerKey
      || !isTauriRuntime()
      || draftRecoverySessionRef.current !== currentWorkspace.session.id
      || !hasDirtyWorkspaceChanges()
    ) {
      return;
    }
    const local = buildPendingDraftLocalSnapshot();
    const generation = ++draftGenerationRef.current;
    await persistPendingPurchaseDraft({
      ownerKey,
      sessionId: currentWorkspace.session.id,
      baseRevision: Number(currentWorkspace.workspace_revision || workspaceRevisionRef.current || 1),
      generation,
      baseline: draftBaselineRef.current || currentWorkspace,
      local,
    });
  }

  async function clearPendingDraft(sessionId: string | null | undefined) {
    const ownerKey = getCurrentUser()?.id;
    if (!ownerKey || !sessionId || !isTauriRuntime()) return;
    await deletePendingPurchaseDraft(ownerKey, sessionId);
  }

  function applyRecoveredDraftLocal(local: unknown) {
    if (!local || typeof local !== 'object') return;
    markLocalWorkspaceEdit();
    const record = local as { sections?: Record<string, unknown>; customer?: EditableCustomer | null };
    const sections = record.sections;
    if (sections && typeof sections === 'object') {
      const incomingGold = Array.isArray(sections.gold_rows) ? sections.gold_rows : [];
      const incomingSilver = Array.isArray(sections.silver_rows) ? sections.silver_rows : [];
      setGoldRows((current) => current.map((row) => {
        const incoming = incomingGold.find((value) => value && typeof value === 'object' && String((value as { karat?: unknown }).karat) === String(row.karat)) as { gram?: unknown; avance_percent?: unknown } | undefined;
        return incoming ? { ...row, gram: String(incoming.gram ?? '0'), avance_percent: String(incoming.avance_percent ?? '0') } : row;
      }));
      setSilverRows((current) => current.map((row) => {
        const incoming = incomingSilver.find((value) => value && typeof value === 'object' && String((value as { type_code?: unknown }).type_code) === String(row.type_code)) as { gram?: unknown; avance_percent?: unknown } | undefined;
        return incoming ? { ...row, gram: String(incoming.gram ?? '0'), avance_percent: String(incoming.avance_percent ?? '0') } : row;
      }));
      if (sections.market_rates && typeof sections.market_rates === 'object') {
        setMarketRates(normalizeMarketRatesInput(sections.market_rates as PosWorkspaceMarketRates));
      }
      if (typeof sections.afg_note === 'string' || sections.afg_note === null) setAfgNote(String(sections.afg_note || ''));
      if (typeof sections.purchase_vat_enabled === 'boolean') setPurchaseVatEnabled(sections.purchase_vat_enabled);
      if (sections.bank_info && typeof sections.bank_info === 'object') {
        const bank = sections.bank_info as { reg_number?: unknown; account_number?: unknown };
        setBankInfo({ reg_number: String(bank.reg_number || ''), account_number: String(bank.account_number || '') });
      }
    }
    if (record.customer && typeof record.customer === 'object') {
      setCustomerForm(record.customer);
      if (!workspace?.customer.customer_id) {
        setNewCustomer(record.customer);
        setCustomerMode('new');
      }
    }
  }

  async function recoverPendingDraftForWorkspace(currentWorkspace: PosWorkspace) {
    const ownerKey = getCurrentUser()?.id;
    if (!ownerKey || !isTauriRuntime()) return;
    const drafts = await listPendingPurchaseDrafts(ownerKey);
    draftRecoveryLoadedRef.current = true;
    const draft = drafts.find((item) => item.sessionId === currentWorkspace.session.id);
    if (!draft) return;
    const serverRevision = Number(currentWorkspace.workspace_revision || 1);
    const sameRevision = draft.baseRevision === serverRevision;
    const localRecord = draft.local as { sections?: { gold_rows?: unknown[]; silver_rows?: unknown[] } } | null;
    const rowCount = (localRecord?.sections?.gold_rows?.length || 0) + (localRecord?.sections?.silver_rows?.length || 0);
    const accepted = await confirm({
      title: sameRevision ? 'Yerel Alış taslağı bulundu' : 'Çakışan yerel Alış taslağı bulundu',
      message: `${rowCount} matris satırı içeren şifreli taslak var. Sunucu revizyonu ${serverRevision}, yerel temel revizyonu ${draft.baseRevision}. ${sameRevision ? 'Özeti uygulamak için devam edin.' : 'Karşılaştırma özetini inceleyip yerel taslağı uygulamak ister misiniz?'}`,
      confirmText: 'Yerel taslağı uygula',
      cancelText: 'Sunucudakiyle devam et',
      variant: sameRevision ? 'warning' : 'danger',
    });
    if (!accepted) {
      await clearPendingDraft(currentWorkspace.session.id);
      return;
    }
    applyRecoveredDraftLocal(draft.local);
  }

  const setCustomerFormFromUi = (next: SetStateAction<EditableCustomer>) => {
    markLocalWorkspaceEdit();
    setCustomerForm(next);
  };
  const setNewCustomerFromUi = (next: SetStateAction<EditableCustomer>) => {
    markLocalWorkspaceEdit();
    setNewCustomer(next);
  };
  const setNumberingFromUi = (next: SetStateAction<EditableWorkspaceNumbering>) => {
    markLocalWorkspaceEdit();
    setNumbering(next);
  };
  const setBankInfoFromUi = (next: SetStateAction<PosWorkspaceBankInfo>) => {
    markLocalWorkspaceEdit();
    setBankInfo(next);
  };
  const setMarketRatesFromUi = (next: SetStateAction<PosWorkspaceMarketRates>) => {
    markLocalWorkspaceEdit();
    setMarketRates(next);
  };
  const setAfgNoteFromUi = (next: SetStateAction<string>) => {
    markLocalWorkspaceEdit();
    setAfgNote(next);
  };
  const setPurchaseVatEnabledFromUi = (next: SetStateAction<boolean>) => {
    markLocalWorkspaceEdit();
    setPurchaseVatEnabled(next);
  };
  const setCalculatorsFromUi = (next: SetStateAction<PosWorkspaceCalculators>) => {
    markLocalWorkspaceEdit();
    setCalculators(next);
  };
  const setPaymentMethodFromUi = (next: SetStateAction<PaymentMethod>) => {
    markLocalWorkspaceEdit();
    setPaymentMethod(next);
  };

  return {
    detailPurchase,
    detail: detailDocumentQuery.data || null,
    detailLoading: detailDocumentQuery.isLoading,
    detailError: detailDocumentQuery.error
      ? detailDocumentQuery.error instanceof Error
        ? detailDocumentQuery.error.message
        : 'Belge detayı yüklenemedi.'
      : null,
    onRetryDetail: () => {
      void detailDocumentQuery.refetch();
    },
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
      ).catch((error: unknown) => {
        toast.error('Belge indirilemedi', localizeApiError(error));
      });
    },
    onPrintDetail: () => {
      if (!detailDocumentQuery.data) return;
      void printAuthedDocument(`/api/v2/alis/documents/${detailDocumentQuery.data.sequence_no}/print?format=html`).catch(
        (error: unknown) => {
          toast.error('Belge yazdırılamadı', localizeApiError(error));
        },
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
    onCancelUnicontaInvoice: handleCancelUnicontaInvoice,
    cancelPendingSequenceNo: cancelUnicontaMutation.isPending
      ? (cancelUnicontaMutation.variables?.sequence_no ?? null)
      : null,
    listLoading: savedPurchasesQuery.isLoading,
    listError: savedPurchasesQuery.error
      ? savedPurchasesQuery.error instanceof Error
        ? savedPurchasesQuery.error.message
        : 'Alış listesi yüklenemedi.'
      : null,
    onRetryDocuments: () => {
      void savedPurchasesQuery.refetch();
    },
    actionPendingSequenceNo: actionSequenceNo,
    customerMode,
    setCustomerMode,
    customerSearchTerm,
    setCustomerSearchTerm,
    candidateCustomers,
    newCustomer,
    setNewCustomer: setNewCustomerFromUi,
    onSelectExistingCustomer: handleSelectExistingCustomer,
    onCreateNewCustomer: handleCreateNewCustomer,
    customerForm,
    setCustomerForm: setCustomerFormFromUi,
    onCustomerBlur: handleCustomerBlur,
    goldRows,
    silverRows,
    onUpdateGoldRow: updateGoldRow,
    barRows,
    ptpdRows,
    extraRows,
    onUpdateBarRow: updateBarRow,
    onUpdatePtPdRow: updatePtPdRow,
    onUpdateExtraRow: updateExtraRow,
    onDeleteExtraRow: deleteExtraRow,
    onAddExtraRows: addExtraRows,
    onApplyGoldCalculatorTarget: applyGoldCalculatorTarget,
    onUpdateSilverRow: updateSilverRow,
    activeWorkspaceView,
    setActiveWorkspaceView: handleWorkspaceViewChange,
    numbering,
    setNumbering: setNumberingFromUi,
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
    setBankInfo: setBankInfoFromUi,
    marketRates,
    setMarketRates: setMarketRatesFromUi,
    afgNote,
    setAfgNote: setAfgNoteFromUi,
    purchaseVatEnabled,
    setPurchaseVatEnabled: setPurchaseVatEnabledFromUi,
    calculators,
    setCalculators: setCalculatorsFromUi,
    paymentMethod,
    setPaymentMethod: setPaymentMethodFromUi,
    onPrintWorkspace: () => {
      if (!workspace) return;
      void printAuthedDocument(`/api/v2/alis/workspace/${workspace.session.id}/print?format=html`).catch(
        (error: unknown) => {
          toast.error('Belge yazdırılamadı', localizeApiError(error));
        },
      );
    },
    onOpenWorkspaceExcelPreview: handleOpenWorkspaceExcelPreview,
    onCancelWorkspace: () => cancelMutation.mutate(),
    onFinalizeWorkspace: async () => {
      finalizeInFlightRef.current = true;
      try {
        await flushPendingWorkspaceSync();
        if (hasPendingWorkspaceSync()) {
          // Kısa bekleme + tek tekrar; hâlâ bekleyen varsa SESSİZCE dönme —
          // kullanıcıya durumu söyle (eski davranış: buton hiçbir şey yapmıyordu).
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          await flushPendingWorkspaceSync();
        }
        if (hasPendingWorkspaceSync()) {
          finalizeInFlightRef.current = false;
          toast.warning('Taslak hâlâ kaydediliyor', 'Değişiklikler sunucuya yazılamadı; bağlantıyı kontrol edip tekrar deneyin.');
          return;
        }
        finalizeMutation.mutate();
      } catch (error) {
        finalizeInFlightRef.current = false;
        toast.error('Alış tamamlanamadı', error instanceof Error ? error.message : 'Taslak kaydedilemedi.');
      }
    },
    customerPending: updateCustomerMutation.isPending || updateDraftCustomerMutation.isPending,
    customerSelecting: selectCustomerMutation.isPending,
    finalizePending: finalizeMutation.isPending,
    cancelPending: cancelMutation.isPending,
    onStartBlankWorkspace: handleStartBlankWorkspace,
    startPending: openWorkspaceMutation.isPending,
    hasPendingWorkspaceAutosave,
    hasDirtyWorkspaceChanges,
    hasPendingWorkspaceSync,
    flushPendingWorkspaceSync,
    priceOpen,
    setPriceOpen,
    pdfState,
    onClosePdfModal: closePdfModal,
  };
}
