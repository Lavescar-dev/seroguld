import { type Dispatch, type SetStateAction } from 'react';

import { formatNumber } from '@/lib/format';
import type { PosWorkspace, PosWorkspaceBankInfo, PosWorkspaceMarketRates } from '@/types';

import { formatDecimalFixed, parseDecimalValue } from './marketRates';
import type {
  CompanionMode,
  EditableCustomer,
  EditableGoldRow,
  EditableInvoiceGoldRow,
  EditableInvoiceMiscRow,
  EditableSilverRow,
  PaymentMethod,
} from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

const INVOICE_GOLD_CODE_OPTIONS = [
  { value: '1', label: 'Guld' },
  { value: '2', label: 'Finsølv' },
  { value: '3', label: 'Sterling sølv' },
  { value: '4', label: '3 tårnet sølv' },
  { value: '5', label: 'Sølv' },
] as const;
const INVOICE_GOLD_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(
  INVOICE_GOLD_CODE_OPTIONS.map((option) => [option.value, option.label]),
);
const INVOICE_GOLD_DEFAULT_LODIGHED: Record<string, string> = {
  '2': '999',
  '3': '925',
  '4': '830',
  '5': '800',
};

function formatDateOnly(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('tr-TR');
}

function computeInvoiceGoldLabel(row: EditableInvoiceGoldRow) {
  return INVOICE_GOLD_LABEL_BY_CODE[row.code] || row.label || '—';
}

function computeInvoiceGoldLodighed(row: EditableInvoiceGoldRow) {
  if (row.code === '1') {
    const karat = parseDecimalValue(row.fineness);
    if (karat <= 0) return row.lodighed || '—';
    if (Math.abs(karat - 14) < 0.001) return '585';
    return String(Math.ceil((karat / 24) * 999));
  }
  return row.fineness.trim() || INVOICE_GOLD_DEFAULT_LODIGHED[row.code] || row.lodighed || '—';
}

function computeInvoiceGoldUnitPrice(row: EditableInvoiceGoldRow, marketRates: PosWorkspaceMarketRates) {
  if (row.code === '1') {
    const karat = parseDecimalValue(row.fineness);
    if (karat > 0) {
      return (parseDecimalValue(marketRates.gold_24k_dkk) * karat) / 24;
    }
  }
  const lodighed = parseDecimalValue(computeInvoiceGoldLodighed(row));
  if (lodighed > 0) {
    return (parseDecimalValue(marketRates.silver_dkk) * lodighed) / 999;
  }
  return parseDecimalValue(row.unit_price_dkk);
}

function computeInvoiceGoldLineTotal(row: EditableInvoiceGoldRow, marketRates: PosWorkspaceMarketRates) {
  return computeInvoiceGoldUnitPrice(row, marketRates) * parseDecimalValue(row.gram);
}

function computeInvoiceMiscQuantity(row: EditableInvoiceMiscRow) {
  const parsed = row.quantity.trim() ? parseDecimalValue(row.quantity) : null;
  if (parsed != null) return parsed;
  return row.text.trim() || parseDecimalValue(row.unit_price_dkk) > 0 ? 1 : 0;
}

function computeInvoiceMiscLineTotal(row: EditableInvoiceMiscRow) {
  return computeInvoiceMiscQuantity(row) * parseDecimalValue(row.unit_price_dkk);
}

export function AfregningsSheetEditor({
  workspace,
  customerForm,
  goldRows,
  silverRows,
  onUpdateGoldRow,
  onUpdateSilverRow,
  bankInfo,
  setBankInfo,
}: {
  workspace: PosWorkspace;
  customerForm: EditableCustomer;
  goldRows: EditableGoldRow[];
  silverRows: EditableSilverRow[];
  onUpdateGoldRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdateSilverRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  bankInfo: PosWorkspaceBankInfo;
  setBankInfo: Dispatch<SetStateAction<PosWorkspaceBankInfo>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
}) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between border-b border-brand-600 bg-brand-800 px-4 py-2">
          <p className="text-xs font-black uppercase tracking-widest text-brand-300">Ürün Detayları — Guld & Sølv</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="mono bg-amber-500 px-1.5 py-0.5 font-black text-white">1=Guld</span>
            <span className="mono bg-slate-500 px-1.5 py-0.5 font-black text-white">2=Finsølv</span>
            <span className="mono bg-slate-400 px-1.5 py-0.5 font-black text-white">3=Sterling</span>
            <span className="mono bg-slate-400 px-1.5 py-0.5 font-black text-white">4=3-tårnet</span>
            <span className="mono bg-slate-400 px-1.5 py-0.5 font-black text-white">5=Sølv</span>
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-brand-400">
              <th className="w-8 border border-brand-300 bg-brand-100 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600">#</th>
              <th className="w-12 border border-brand-300 bg-brand-100 px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-brand-600">Type</th>
              <th className="border border-brand-300 bg-brand-100 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600">Açıklama</th>
              <th className="w-28 border border-orange-200 bg-orange-50 px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-orange-700">Avance %</th>
              <th className="w-24 border border-brand-300 bg-brand-100 px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-brand-600">Karat</th>
              <th className="w-20 border border-brand-300 bg-brand-100 px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-brand-600">Lødighed</th>
              <th className="w-28 border border-amber-300 bg-amber-100 px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-amber-800">Vægt i g</th>
              <th className="w-32 border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-right text-xs font-black uppercase tracking-wider text-emerald-700">Enhedspris/g</th>
              <th className="w-36 border border-emerald-300 bg-emerald-100 px-3 py-2.5 text-right text-xs font-black uppercase tracking-wider text-emerald-800">I alt (DKK)</th>
            </tr>
          </thead>
          <tbody>
            {goldRows.map((row, index) => {
              const hasGram = parseDecimalValue(row.gram) > 0;
              return (
                <tr
                  key={row.row_key}
                  className={`border-b transition-colors ${hasGram ? 'border-amber-200 border-l-4 border-l-amber-400' : 'border-brand-100 border-l-4 border-l-transparent opacity-55 hover:opacity-90'}`}
                  style={{ background: hasGram ? '#fffbeb' : '#ffffff' }}
                >
                  <td className="mono border border-brand-300 px-2 py-2.5 text-center text-xs font-bold text-brand-400">{index + 1}</td>
                  <td className="border border-brand-300 px-2 py-2.5 text-center">
                    <span className="mono bg-amber-200 px-2 py-0.5 text-xs font-black text-amber-800">1</span>
                  </td>
                  <td className="border border-brand-300 px-3 py-2.5">
                    <span className="text-sm font-semibold text-brand-800">Guld</span>
                    <span className="ml-2 bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700">{row.label}</span>
                  </td>
                  <td className="border border-orange-300 bg-orange-50 px-1.5 py-2">
                    <div className="flex items-center">
                      <input
                        value={row.avance_percent}
                        onChange={(event) => onUpdateGoldRow(row.row_key, 'avance_percent', event.target.value)}
                        className="mono w-full border border-orange-200 bg-white px-2 py-1 text-center text-sm text-orange-800 outline-none focus:border-orange-500"
                      />
                      <span className="ml-1 text-xs font-bold text-orange-400">%</span>
                    </div>
                  </td>
                  <td className="mono border border-brand-300 px-3 py-2.5 text-center text-sm font-bold text-amber-700">{row.karat}</td>
                  <td className="mono border border-brand-300 px-3 py-2.5 text-center text-sm text-amber-600">{row.lodighed}</td>
                  <td className="border border-amber-300 bg-amber-50 px-1.5 py-2">
                    <input
                      value={row.gram}
                      onChange={(event) => onUpdateGoldRow(row.row_key, 'gram', event.target.value)}
                      className={`mono w-full border px-2 py-1 text-center text-sm font-bold outline-none ${
                        hasGram
                          ? 'border-amber-400 bg-white text-amber-900 focus:border-amber-600'
                          : 'border-amber-200 bg-white text-brand-700 focus:border-amber-400'
                      }`}
                    />
                  </td>
                  <td className="mono border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-right text-sm">
                    <span className={hasGram ? 'font-semibold text-emerald-700' : 'text-brand-300'}>
                      {hasGram ? Number(row.unit_price_dkk).toFixed(2) : '—'}
                    </span>
                  </td>
                  <td className={`mono border px-3 py-2.5 text-right text-sm ${
                    hasGram ? 'border-amber-300 bg-amber-100 font-black text-amber-900' : 'border-brand-300 bg-brand-50 text-brand-300'
                  }`}>
                    {hasGram ? Number(row.line_total_dkk).toFixed(2) : '—'}
                  </td>
                </tr>
              );
            })}

            <tr>
              <td colSpan={9} className="border-y-2 border-slate-400 bg-slate-600 px-4 py-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black uppercase tracking-widest text-white">Sølv — Gümüş</span>
                  <span className="h-3 w-px bg-slate-400" />
                  <span className="mono text-xs text-slate-300">999 · 925 · 830 · 800</span>
                </div>
              </td>
            </tr>
            {silverRows.map((row, index) => {
              const hasGram = parseDecimalValue(row.gram) > 0;
              return (
                <tr
                  key={row.row_key}
                  className={`border-b transition-colors ${hasGram ? 'border-slate-200 border-l-4 border-l-slate-400' : 'border-brand-100 border-l-4 border-l-transparent opacity-55 hover:opacity-90'}`}
                  style={{ background: hasGram ? '#f8fafc' : '#ffffff' }}
                >
                  <td className="mono border border-brand-300 px-2 py-2.5 text-center text-xs font-bold text-brand-400">{goldRows.length + index + 1}</td>
                  <td className="border border-brand-300 px-2 py-2.5 text-center">
                    <span className="mono bg-slate-200 px-2 py-0.5 text-xs font-black text-slate-700">{row.type_code}</span>
                  </td>
                  <td className="border border-brand-300 px-3 py-2.5">
                    <span className="text-sm font-semibold text-brand-800">{row.label}</span>
                    <span className="mono ml-2 bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{row.lodighed}‰</span>
                  </td>
                  <td className="border border-orange-300 bg-orange-50 px-1.5 py-2">
                    <div className="flex items-center">
                      <input
                        value={row.avance_percent}
                        onChange={(event) => onUpdateSilverRow(row.row_key, 'avance_percent', event.target.value)}
                        className="mono w-full border border-orange-200 bg-white px-2 py-1 text-center text-sm text-orange-800 outline-none focus:border-orange-500"
                      />
                      <span className="ml-1 text-xs font-bold text-orange-400">%</span>
                    </div>
                  </td>
                  <td className="mono border border-brand-300 px-3 py-2.5 text-center text-sm text-brand-300">—</td>
                  <td className="mono border border-brand-300 px-3 py-2.5 text-center text-sm font-semibold text-slate-500">{row.lodighed}</td>
                  <td className="border border-slate-300 bg-slate-50 px-1.5 py-2">
                    <input
                      value={row.gram}
                      onChange={(event) => onUpdateSilverRow(row.row_key, 'gram', event.target.value)}
                      className={`mono w-full border px-2 py-1 text-center text-sm font-bold outline-none ${
                        hasGram
                          ? 'border-slate-400 bg-white text-slate-900 focus:border-slate-600'
                          : 'border-slate-200 bg-white text-brand-700 focus:border-slate-400'
                      }`}
                    />
                  </td>
                  <td className="mono border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-right text-sm">
                    <span className={hasGram ? 'font-semibold text-emerald-700' : 'text-brand-300'}>
                      {hasGram ? Number(row.unit_price_dkk).toFixed(2) : '—'}
                    </span>
                  </td>
                  <td className={`mono border px-3 py-2.5 text-right text-sm ${
                    hasGram ? 'border-slate-300 bg-slate-100 font-black text-slate-800' : 'border-brand-300 bg-brand-50 text-brand-300'
                  }`}>
                    {hasGram ? Number(row.line_total_dkk).toFixed(2) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-brand-400">
              <td colSpan={6} className="border border-brand-300 bg-brand-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  {Number(workspace.summary.gold_weight_grams) > 0 ? (
                    <span className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-100 px-2.5 py-1">
                      <span className="text-xs font-black uppercase text-amber-700">Guld</span>
                      <span className="mono text-sm font-black text-amber-900">{formatNumber(workspace.summary.gold_weight_grams, ' g')}</span>
                    </span>
                  ) : null}
                  {Number(workspace.summary.silver_weight_grams) > 0 ? (
                    <span className="inline-flex items-center gap-1.5 border border-slate-300 bg-slate-100 px-2.5 py-1">
                      <span className="text-xs font-black uppercase text-slate-600">Sølv</span>
                      <span className="mono text-sm font-black text-slate-800">{formatNumber(workspace.summary.silver_weight_grams, ' g')}</span>
                    </span>
                  ) : null}
                  {Number(workspace.summary.gold_weight_grams) === 0 && Number(workspace.summary.silver_weight_grams) === 0 ? (
                    <span className="text-xs italic text-brand-400">Henüz gram girilmedi</span>
                  ) : null}
                </div>
              </td>
              <td colSpan={2} className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-emerald-700">
                I alt — Genel Toplam
              </td>
              <td className="border border-emerald-700 bg-emerald-800 px-4 py-3 text-right">
                <span className="mono text-xl font-black text-white">{Number(workspace.summary.total_amount_dkk || 0).toFixed(2)}</span>
                <span className="ml-1 text-xs font-bold text-emerald-300">DKK</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-2 divide-x-2 divide-brand-200 border-t-2 border-brand-300">
        <div className="bg-brand-50 px-6 py-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-100 px-3 py-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-black uppercase tracking-widest text-emerald-800">Bankoverførsel</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1 border border-emerald-300 bg-white px-2 py-0.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Profiline Bağlı</span>
            </span>
          </div>

          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-brand-200">
                <td className="w-28 border-r border-brand-200 bg-brand-100 px-3 py-2 pr-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-500">Reg.nr.</span>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    placeholder="0000"
                    value={bankInfo.reg_number || ''}
                    onChange={(event) => setBankInfo((current) => ({ ...current, reg_number: event.target.value }))}
                    className="mono w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50"
                  />
                </td>
              </tr>
              <tr className="border-b border-brand-200">
                <td className="border-r border-brand-200 bg-brand-100 px-3 py-2 pr-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-500">Kontonr.</span>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    placeholder="0000 0000 0000"
                    value={bankInfo.account_number || ''}
                    onChange={(event) => setBankInfo((current) => ({ ...current, account_number: event.target.value }))}
                    className="mono w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50"
                  />
                </td>
              </tr>
              <tr>
                <td colSpan={2} className="pt-2">
                  <p className="text-[10px] italic text-brand-400">
                    Bu bilgiler müşteri profiline kaydedilir ve mevcut müşteri seçildiğinde otomatik dolar.
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4">
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-brand-200">
                <td className="py-2.5 text-xs font-bold uppercase tracking-wider text-brand-600">Subtotal</td>
                <td className="py-2.5 text-right font-semibold text-brand-900" style={monoStyle}>
                  {Number(workspace.summary.total_amount_dkk || 0).toFixed(2)} DKK
                </td>
              </tr>
              <tr className="border-b border-brand-200">
                <td className="py-2.5 text-xs font-bold uppercase tracking-wider text-brand-400">Moms (25%)</td>
                <td className="py-2.5 text-right text-sm text-brand-400" style={monoStyle}>
                  — DKK
                </td>
              </tr>
              <tr className="bg-emerald-50">
                <td className="py-2.5 text-xs font-black uppercase tracking-wider text-emerald-800">I alt</td>
                <td className="py-2.5 text-right">
                  <span className="mono text-lg font-black text-emerald-900">{Number(workspace.summary.total_amount_dkk || 0).toFixed(2)}</span>
                  <span className="ml-1 text-xs font-bold text-emerald-600">DKK</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between bg-emerald-800 p-2.5">
            <p className="text-xs uppercase tracking-wider text-emerald-400">
              Overføres til konto
            </p>
            <p className="mono text-sm font-black text-white">
              {bankInfo.reg_number && bankInfo.account_number
                ? `${bankInfo.reg_number} — ${bankInfo.account_number}`
                : bankInfo.reg_number || bankInfo.account_number
                  ? `${bankInfo.reg_number || '????'}  ${bankInfo.account_number || '?????????????????????'}`
                  : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t-2 border-brand-300 bg-brand-50 px-6 py-5">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="mb-4 text-xs font-black uppercase tracking-widest text-brand-600">Underskrift</p>
            <div className="mb-2 h-12 border-b-2 border-brand-400" />
            <p className="text-xs text-brand-400">
              {customerForm.name || 'Müşteri adı'} — {formatDateOnly(workspace.session.updated_at)}
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-brand-600">Erklæring</p>
            <p className="text-xs leading-relaxed text-brand-500">
              Undertegnede erklærer hermed, at de solgte varer er min ejendom og sælges frivilligt. Varerne kan ikke
              returneres efter afregning. Prisen er beregnet på baggrund af dagens guld- og sølvpris.
            </p>
            <p className="mt-2 text-xs text-brand-400">Sero Guld · Tlf: +45 00 00 00 00 · CVR: 00 00 00 00</p>
          </div>
        </div>
      </div>
    </>
  );
}

export function InvoiceGoldSheetEditor({
  customerName,
  documentDate,
  invoiceNumber,
  marketRates,
  rows,
  footerLines,
  mode,
  onResetToAuto,
  onUpdateRow,
  onUpdateFooterLine,
}: {
  customerName: string;
  documentDate: string;
  invoiceNumber: string;
  marketRates: PosWorkspaceMarketRates;
  rows: EditableInvoiceGoldRow[];
  footerLines: string[];
  mode: CompanionMode;
  onResetToAuto: () => void;
  onUpdateRow: (rowKey: string, field: 'code' | 'fineness' | 'gram', value: string) => void;
  onUpdateFooterLine: (index: number, value: string) => void;
}) {
  const totalAmount = rows.reduce((sum, row) => sum + computeInvoiceGoldLineTotal(row, marketRates), 0);

  return (
    <div className="space-y-4 bg-white px-6 py-5">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="border border-brand-200 bg-brand-50 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Companion Sheet</p>
            <span className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
              mode === 'auto' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}>
              {mode === 'auto' ? 'Auto' : 'Manual'}
            </span>
          </div>
          <h2 className="mt-2 text-lg font-black uppercase tracking-[0.08em] text-brand-950">Faktura Guld & Sølv</h2>
          <p className="mt-2 text-sm text-brand-700">
            {mode === 'auto'
              ? 'AFG core satırlarından otomatik üretilir. İlk manuel değişiklikten sonra bu section override moduna geçer.'
              : 'Bu companion section şu an manuel override modunda. AFG core satırları artık bunu otomatik ezmez.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="border border-brand-200 bg-white px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Fakturanr.</p>
            <p className="mono mt-2 text-xl font-black text-brand-950">{invoiceNumber || '—'}</p>
          </div>
          <div className="border border-brand-200 bg-white px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Dato</p>
            <p className="mono mt-2 text-xl font-black text-brand-950">{formatDateOnly(documentDate)}</p>
          </div>
          <div className="border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">I alt</p>
            <p className="mono mt-2 text-xl font-black text-emerald-900">{formatDecimalFixed(totalAmount)}</p>
          </div>
        </div>
      </div>

      <div className="border border-brand-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-200 bg-brand-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Faktura Başlığı</p>
            <p className="mt-1 text-sm text-brand-700">
              {customerName || 'Müşteri seçilmedi'} · {formatDateOnly(documentDate)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-brand-500">
            {INVOICE_GOLD_CODE_OPTIONS.map((option) => (
              <span key={option.value} className="mono border border-brand-200 bg-white px-2 py-1 text-brand-700">
                {option.value}={option.label}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-brand-300">
                <th className="w-10 border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">#</th>
                <th className="w-24 border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Kod</th>
                <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Type</th>
                <th className="w-36 border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Finhed / Karat</th>
                <th className="w-28 border border-brand-200 bg-brand-100 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-brand-500">Lødighed</th>
                <th className="w-32 border border-amber-200 bg-amber-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-amber-700">Gram</th>
                <th className="w-36 border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-700">Enhedspris / g</th>
                <th className="w-40 border border-emerald-300 bg-emerald-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-800">I alt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const lodighed = computeInvoiceGoldLodighed(row);
                const unitPrice = computeInvoiceGoldUnitPrice(row, marketRates);
                const lineTotal = computeInvoiceGoldLineTotal(row, marketRates);
                const isActive = Boolean(row.code || row.fineness || parseDecimalValue(row.gram) > 0);
                return (
                  <tr key={row.row_key} className={isActive ? 'bg-white' : 'bg-brand-50/40'}>
                    <td className="mono border border-brand-200 px-3 py-2 text-xs text-brand-400">{index + 1}</td>
                    <td className="border border-brand-200 px-2 py-2">
                      <select
                        value={row.code}
                        onChange={(event) => onUpdateRow(row.row_key, 'code', event.target.value)}
                        className="w-full border border-brand-300 bg-white px-2 py-1.5 text-sm font-semibold text-brand-900 outline-none focus:border-brand-700"
                      >
                        <option value="">—</option>
                        {INVOICE_GOLD_CODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.value} · {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-900">{computeInvoiceGoldLabel(row)}</td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.fineness}
                        onChange={(event) => onUpdateRow(row.row_key, 'fineness', event.target.value)}
                        className="mono w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700"
                        placeholder={row.code === '1' ? '14 / 18 / 24' : '999 / 925 / 830'}
                      />
                    </td>
                    <td className="mono border border-brand-200 px-3 py-2 text-center text-sm font-black text-brand-700">{lodighed}</td>
                    <td className="border border-amber-200 bg-amber-50 px-2 py-2">
                      <input
                        type="text"
                        value={row.gram}
                        onChange={(event) => onUpdateRow(row.row_key, 'gram', event.target.value)}
                        className="mono w-full border border-amber-300 bg-white px-2 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="mono border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-sm font-semibold text-emerald-700">
                      {lineTotal > 0 || unitPrice > 0 ? formatDecimalFixed(unitPrice) : '—'}
                    </td>
                    <td className="mono border border-emerald-300 bg-emerald-100 px-3 py-2 text-right text-sm font-black text-emerald-900">
                      {lineTotal > 0 ? formatDecimalFixed(lineTotal) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="border border-brand-200 bg-white">
          <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Serbest Metin Satırları</p>
            <p className="mt-1 text-sm text-brand-700">Legacy invoice sheet’in altındaki üç serbest satır burada tutulur.</p>
          </div>
          <div className="space-y-3 px-4 py-4">
            {footerLines.map((line, index) => (
              <label key={index} className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">Metin {index + 1}</span>
                <input
                  type="text"
                  value={line}
                  onChange={(event) => onUpdateFooterLine(index, event.target.value)}
                  className="w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                  placeholder="Alt satır açıklaması"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="border border-brand-200 bg-brand-50 px-4 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Companion Davranışı</p>
          <div className="mt-3 space-y-2 text-sm leading-6 text-brand-700">
            <p>Bu tab ayrı bir workflow değil; aynı AFG draft’ın invoice companion yüzeyidir.</p>
            <p>ONLYOFFICE ve export edilen workbook aynı structured state’i kullanır.</p>
            <p>Hızlı AFG grid’iyle çelişen özel satırlar burada yaşayabilir; totals workbook mantığıyla korunur.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InvoiceMiscSheetEditor({
  customerName,
  documentDate,
  invoiceNumber,
  rows,
  mode,
  onResetToAuto,
  onUpdateRow,
}: {
  customerName: string;
  documentDate: string;
  invoiceNumber: string;
  rows: EditableInvoiceMiscRow[];
  mode: CompanionMode;
  onResetToAuto: () => void;
  onUpdateRow: (rowKey: string, field: 'text' | 'quantity' | 'unit_price_dkk', value: string) => void;
}) {
  const totalAmount = rows.reduce((sum, row) => sum + computeInvoiceMiscLineTotal(row), 0);

  return (
    <div className="space-y-4 bg-white px-6 py-5">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="border border-brand-200 bg-brand-50 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Companion Sheet</p>
            <span className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
              mode === 'auto' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}>
              {mode === 'auto' ? 'Auto' : 'Manual'}
            </span>
            {mode === 'manual' ? (
              <button
                type="button"
                onClick={onResetToAuto}
                className="inline-flex items-center gap-1 border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
              >
                Reset to Auto
              </button>
            ) : null}
          </div>
          <h2 className="mt-2 text-lg font-black uppercase tracking-[0.08em] text-brand-950">Faktura Diverse</h2>
          <p className="mt-2 text-sm text-brand-700">
            {mode === 'auto'
              ? 'Bu companion section varsayılan olarak boş tutulur. İlk manuel değişiklikten sonra override moduna geçer.'
              : 'Bu companion section şu an manuel override modunda. Reset ile tekrar boş auto durumuna dönebilir.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="border border-brand-200 bg-white px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Fakturanr.</p>
            <p className="mono mt-2 text-xl font-black text-brand-950">{invoiceNumber || '—'}</p>
          </div>
          <div className="border border-brand-200 bg-white px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Dato</p>
            <p className="mono mt-2 text-xl font-black text-brand-950">{formatDateOnly(documentDate)}</p>
          </div>
          <div className="border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">I alt</p>
            <p className="mono mt-2 text-xl font-black text-emerald-900">{formatDecimalFixed(totalAmount)}</p>
          </div>
        </div>
      </div>

      <div className="border border-brand-200 bg-white">
        <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Faktura Satırları</p>
          <p className="mt-1 text-sm text-brand-700">{customerName || 'Müşteri seçilmedi'} · {formatDateOnly(documentDate)}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-brand-300">
                <th className="w-10 border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">#</th>
                <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Tekst</th>
                <th className="w-28 border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Antal</th>
                <th className="w-36 border border-amber-200 bg-amber-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-amber-700">Pris</th>
                <th className="w-40 border border-emerald-300 bg-emerald-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-800">I alt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const lineTotal = computeInvoiceMiscLineTotal(row);
                const quantity = computeInvoiceMiscQuantity(row);
                const isActive = Boolean(row.text.trim() || quantity > 0 || parseDecimalValue(row.unit_price_dkk) > 0);
                return (
                  <tr key={row.row_key} className={isActive ? 'bg-white' : 'bg-brand-50/40'}>
                    <td className="mono border border-brand-200 px-3 py-2 text-xs text-brand-400">{index + 1}</td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.text}
                        onChange={(event) => onUpdateRow(row.row_key, 'text', event.target.value)}
                        className="w-full border border-brand-300 bg-white px-3 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700"
                        placeholder="Satır açıklaması"
                      />
                    </td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.quantity}
                        onChange={(event) => onUpdateRow(row.row_key, 'quantity', event.target.value)}
                        className="mono w-full border border-brand-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                        placeholder="1"
                      />
                    </td>
                    <td className="border border-amber-200 bg-amber-50 px-2 py-2">
                      <input
                        type="text"
                        value={row.unit_price_dkk}
                        onChange={(event) => onUpdateRow(row.row_key, 'unit_price_dkk', event.target.value)}
                        className="mono w-full border border-amber-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-amber-500"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="mono border border-emerald-300 bg-emerald-100 px-3 py-2 text-right text-sm font-black text-emerald-900">
                      {lineTotal > 0 ? formatDecimalFixed(lineTotal) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
