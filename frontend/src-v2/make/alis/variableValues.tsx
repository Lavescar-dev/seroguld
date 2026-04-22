import { type Dispatch, type SetStateAction } from 'react';

import type { PosWorkspaceCalculators, PosWorkspaceMarketRates } from '@/types';

import {
  GOLD_MATRIX_ROWS,
  SILVER_MATRIX_ROWS,
  formatDecimalFixed,
  normalizeTextInput,
  parseDecimalValue,
  syncMarketRateState,
} from './marketRates';
import type { EditableCalculatorRow, EditableWorkspaceNumbering } from './types';

const GOLD_CALCULATOR_TARGETS = [
  { value: 'gold:8', label: '8K' },
  { value: 'gold:14', label: '14K' },
  { value: 'gold:18', label: '18K' },
  { value: 'gold:21', label: '21K' },
  { value: 'gold:21.6', label: '21.6K' },
  { value: 'gold:22', label: '22K' },
  { value: 'gold:24', label: '24K' },
] as const;

const SILVER_CALCULATOR_TARGETS = [
  { value: 'silver:2', label: 'Finsølv' },
  { value: 'silver:3', label: 'Sterling' },
  { value: 'silver:4', label: '3 tårnet' },
  { value: 'silver:5', label: 'Sølv' },
] as const;

function withCalculatedTotal(row: EditableCalculatorRow): EditableCalculatorRow {
  const unitWeight = parseDecimalValue(row.unit_weight);
  const count = parseDecimalValue(row.count);
  return {
    ...row,
    total_weight: formatDecimalFixed(unitWeight * count),
  };
}

export function VariableValuesSheetEditor({
  numbering,
  onUpdateNumbering,
  marketRates,
  setMarketRates,
  afgNote,
  setAfgNote,
  calculators,
  setCalculators,
  onUpdateGoldRow,
  onUpdateSilverRow,
  title = 'Variable værdier',
  description = 'AFG v3 contract: EUR truth, FX, AFG notu ve calculator blokları burada tutulur.',
  layout = 'full',
}: {
  numbering: EditableWorkspaceNumbering;
  onUpdateNumbering: (field: keyof EditableWorkspaceNumbering, value: string) => void;
  marketRates: PosWorkspaceMarketRates;
  setMarketRates: Dispatch<SetStateAction<PosWorkspaceMarketRates>>;
  afgNote: string;
  setAfgNote: Dispatch<SetStateAction<string>>;
  calculators: PosWorkspaceCalculators;
  setCalculators: Dispatch<SetStateAction<PosWorkspaceCalculators>>;
  onUpdateGoldRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  onUpdateSilverRow: (rowKey: string, field: 'gram' | 'avance_percent', value: string) => void;
  title?: string;
  description?: string;
  layout?: 'full' | 'compactSidebar';
}) {
  const fx = parseDecimalValue(marketRates.eur_dkk_fx) || 1;
  const goldMatrixRows = GOLD_MATRIX_ROWS.map((row) => {
    const eur = normalizeTextInput(marketRates.gold_rates_eur?.[row.key] || '0');
    return {
      ...row,
      eur_per_gram: eur,
      dkk_per_gram: formatDecimalFixed(parseDecimalValue(eur) * fx),
    };
  });
  const silverMatrixRows = SILVER_MATRIX_ROWS.map((row) => {
    const eur = normalizeTextInput(marketRates.silver_rates_eur?.[row.key] || '0');
    return {
      ...row,
      eur_per_gram: eur,
      dkk_per_gram: formatDecimalFixed(parseDecimalValue(eur) * fx),
    };
  });
  const goldCalculatorRows = calculators.gold_rows.map((row) =>
    withCalculatedTotal({
      row_key: row.row_key,
      unit_weight: row.unit_weight,
      count: row.count,
      total_weight: row.total_weight,
      target_row_key: row.target_row_key || '',
    }),
  );
  const silverCalculatorRows = calculators.silver_rows.map((row) =>
    withCalculatedTotal({
      row_key: row.row_key,
      unit_weight: row.unit_weight,
      count: row.count,
      total_weight: row.total_weight,
      target_row_key: row.target_row_key || '',
    }),
  );

  function updateGoldRate(rowKey: string, value: string) {
    setMarketRates((current) =>
      syncMarketRateState(current, {
        gold_rates_eur: {
          ...current.gold_rates_eur,
          [rowKey]: normalizeTextInput(value),
        },
      }),
    );
  }

  function updateSilverRate(rowKey: string, value: string) {
    setMarketRates((current) =>
      syncMarketRateState(current, {
        silver_rates_eur: {
          ...current.silver_rates_eur,
          [rowKey]: normalizeTextInput(value),
        },
      }),
    );
  }

  function updateCalculatorRow(
    kind: 'gold_rows' | 'silver_rows',
    rowKey: string,
    field: 'unit_weight' | 'count' | 'target_row_key',
    value: string,
  ) {
    setCalculators((current) => ({
      ...current,
      [kind]: current[kind].map((row) =>
        row.row_key === rowKey
          ? withCalculatedTotal({
              row_key: row.row_key,
              unit_weight: field === 'unit_weight' ? normalizeTextInput(value) : row.unit_weight,
              count: field === 'count' ? normalizeTextInput(value) : row.count,
              total_weight: row.total_weight,
              target_row_key: field === 'target_row_key' ? value : row.target_row_key || '',
            })
          : withCalculatedTotal({
              row_key: row.row_key,
              unit_weight: row.unit_weight,
              count: row.count,
              total_weight: row.total_weight,
              target_row_key: row.target_row_key || '',
            }),
      ),
    }));
  }

  function applyCalculatorRow(row: EditableCalculatorRow, kind: 'gold' | 'silver') {
    if (!row.target_row_key) return;
    const totalWeight = formatDecimalFixed(parseDecimalValue(row.total_weight));
    if (kind === 'gold') {
      onUpdateGoldRow(row.target_row_key, 'gram', totalWeight);
      return;
    }
    onUpdateSilverRow(row.target_row_key, 'gram', totalWeight);
  }

  if (layout === 'compactSidebar') {
    return (
      <div className="space-y-3">
        <div className="border border-brand-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">{title}</p>
              <p className="mt-1 text-[11px] leading-5 text-brand-600">AFG notu, rate matrix ve helper hesaplar.</p>
            </div>
            <span className="mono inline-flex border border-brand-200 bg-brand-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-brand-700">
              FX {formatDecimalFixed(marketRates.eur_dkk_fx)}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">Afregningsnr.</span>
              <input
                type="text"
                value={numbering.afregnings_number_next}
                onChange={(event) => onUpdateNumbering('afregnings_number_next', event.target.value)}
                className="mono h-8 w-full border border-brand-300 bg-white px-2.5 text-sm text-brand-900 outline-none focus:border-brand-700"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">Fakturanr.</span>
              <input
                type="text"
                value={numbering.invoice_number_next}
                onChange={(event) => onUpdateNumbering('invoice_number_next', event.target.value)}
                className="mono h-8 w-full border border-brand-300 bg-white px-2.5 text-sm text-brand-900 outline-none focus:border-brand-700"
              />
            </label>
            <label className="block sm:col-span-2 xl:col-span-1 2xl:col-span-2">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">EUR / DKK FX</span>
              <input
                type="text"
                value={marketRates.eur_dkk_fx}
                onChange={(event) =>
                  setMarketRates((current) => syncMarketRateState(current, { eur_dkk_fx: normalizeTextInput(event.target.value) }))
                }
                className="mono h-8 w-full border border-brand-300 bg-white px-2.5 text-sm text-brand-900 outline-none focus:border-brand-700"
              />
            </label>
          </div>
        </div>

        <div className="border border-brand-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">AFG Notu</p>
              <p className="mt-1 text-[11px] leading-5 text-brand-600">Sadece bu draft için tutulur.</p>
            </div>
          </div>
          <textarea
            value={afgNote}
            onChange={(event) => setAfgNote(event.target.value)}
            rows={3}
            className="mt-3 w-full border border-brand-300 bg-white px-2.5 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
            placeholder="Bu alışa özel notlar..."
          />
        </div>

        <div className="space-y-3">
          <div className="border border-brand-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Gold Rates</p>
                <p className="mt-1 text-[11px] leading-5 text-brand-600">EUR truth, DKK derived.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {goldMatrixRows.map((row) => (
                <label key={row.key} className="block border border-brand-200 bg-brand-50 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[11px] font-black uppercase tracking-wider text-brand-900">{row.label}</span>
                    <span className="mono text-[10px] text-brand-500">{row.lodighed}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={row.eur_per_gram}
                      onChange={(event) => updateGoldRate(row.key, event.target.value)}
                      className="mono h-8 min-w-0 flex-1 border border-brand-300 bg-white px-2.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                    />
                    <span className="mono shrink-0 text-[10px] font-black uppercase tracking-wider text-brand-500">EUR/g</span>
                  </div>
                  <p className="mono mt-1 text-[10px] font-semibold text-emerald-700">DKK/g {row.dkk_per_gram}</p>
                </label>
              ))}
            </div>
          </div>

          <div className="border border-brand-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Silver Rates</p>
                <p className="mt-1 text-[11px] leading-5 text-brand-600">EUR truth, DKK derived.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {silverMatrixRows.map((row) => (
                <label key={row.key} className="block border border-brand-200 bg-brand-50 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black text-brand-900">{row.label}</span>
                    <span className="mono text-[10px] text-brand-500">{row.lodighed}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={row.eur_per_gram}
                      onChange={(event) => updateSilverRate(row.key, event.target.value)}
                      className="mono h-8 min-w-0 flex-1 border border-brand-300 bg-white px-2.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                    />
                    <span className="mono shrink-0 text-[10px] font-black uppercase tracking-wider text-brand-500">EUR/g</span>
                  </div>
                  <p className="mono mt-1 text-[10px] font-semibold text-emerald-700">DKK/g {row.dkk_per_gram}</p>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="border border-brand-200 bg-white shadow-sm">
            <div className="border-b border-brand-200 bg-brand-50 px-4 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Kniv beregner</p>
            </div>
            <div className="overflow-x-auto px-2 py-2">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-brand-200">
                    <th className="px-2 py-1 text-left font-black uppercase tracking-widest text-brand-500">#</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">V</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">A</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">Top</th>
                    <th className="px-2 py-1 text-left font-black uppercase tracking-widest text-brand-500">Hedef</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">Aktar</th>
                  </tr>
                </thead>
                <tbody>
                  {goldCalculatorRows.map((row, index) => (
                    <tr key={row.row_key} className="border-b border-brand-100 last:border-b-0">
                      <td className="mono px-2 py-1.5 font-black text-brand-700">{index + 1}</td>
                      <td className="px-1 py-1.5">
                        <input
                          type="text"
                          value={row.unit_weight}
                          onChange={(event) => updateCalculatorRow('gold_rows', row.row_key, 'unit_weight', event.target.value)}
                          className="mono h-7 w-full min-w-[3.5rem] border border-brand-300 bg-white px-1.5 text-right text-[11px] text-brand-900 outline-none focus:border-brand-700"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="text"
                          value={row.count}
                          onChange={(event) => updateCalculatorRow('gold_rows', row.row_key, 'count', event.target.value)}
                          className="mono h-7 w-full min-w-[3.5rem] border border-brand-300 bg-white px-1.5 text-right text-[11px] text-brand-900 outline-none focus:border-brand-700"
                        />
                      </td>
                      <td className="mono px-2 py-1.5 text-right font-black text-emerald-700">{formatDecimalFixed(row.total_weight)}</td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.target_row_key}
                          onChange={(event) => updateCalculatorRow('gold_rows', row.row_key, 'target_row_key', event.target.value)}
                          className="h-7 w-full min-w-[5.5rem] border border-brand-300 bg-white px-1.5 text-[11px] text-brand-900 outline-none focus:border-brand-700"
                        >
                          <option value="">Seç</option>
                          {GOLD_CALCULATOR_TARGETS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => applyCalculatorRow(row, 'gold')}
                          disabled={!row.target_row_key}
                          className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Aktar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-brand-200 bg-white shadow-sm">
            <div className="border-b border-brand-200 bg-brand-50 px-4 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Beregner</p>
            </div>
            <div className="overflow-x-auto px-2 py-2">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-brand-200">
                    <th className="px-2 py-1 text-left font-black uppercase tracking-widest text-brand-500">#</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">V</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">A</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">Top</th>
                    <th className="px-2 py-1 text-left font-black uppercase tracking-widest text-brand-500">Hedef</th>
                    <th className="px-2 py-1 text-right font-black uppercase tracking-widest text-brand-500">Aktar</th>
                  </tr>
                </thead>
                <tbody>
                  {silverCalculatorRows.map((row, index) => (
                    <tr key={row.row_key} className="border-b border-brand-100 last:border-b-0">
                      <td className="mono px-2 py-1.5 font-black text-brand-700">{index + 1}</td>
                      <td className="px-1 py-1.5">
                        <input
                          type="text"
                          value={row.unit_weight}
                          onChange={(event) => updateCalculatorRow('silver_rows', row.row_key, 'unit_weight', event.target.value)}
                          className="mono h-7 w-full min-w-[3.5rem] border border-brand-300 bg-white px-1.5 text-right text-[11px] text-brand-900 outline-none focus:border-brand-700"
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <input
                          type="text"
                          value={row.count}
                          onChange={(event) => updateCalculatorRow('silver_rows', row.row_key, 'count', event.target.value)}
                          className="mono h-7 w-full min-w-[3.5rem] border border-brand-300 bg-white px-1.5 text-right text-[11px] text-brand-900 outline-none focus:border-brand-700"
                        />
                      </td>
                      <td className="mono px-2 py-1.5 text-right font-black text-emerald-700">{formatDecimalFixed(row.total_weight)}</td>
                      <td className="px-1 py-1.5">
                        <select
                          value={row.target_row_key}
                          onChange={(event) => updateCalculatorRow('silver_rows', row.row_key, 'target_row_key', event.target.value)}
                          className="h-7 w-full min-w-[5.5rem] border border-brand-300 bg-white px-1.5 text-[11px] text-brand-900 outline-none focus:border-brand-700"
                        >
                          <option value="">Seç</option>
                          {SILVER_CALCULATOR_TARGETS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => applyCalculatorRow(row, 'silver')}
                          disabled={!row.target_row_key}
                          className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Aktar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 bg-white px-6 py-5">
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="border border-brand-200 bg-brand-50 px-4 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Variable værdier</p>
          <h2 className="mt-2 text-lg font-black uppercase tracking-[0.08em] text-brand-950">{title}</h2>
          <p className="mt-2 text-sm text-brand-700">{description}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="border border-brand-200 bg-white px-4 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Draft Numaraları</p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">Afregningsnr.</span>
                <input
                  type="text"
                  value={numbering.afregnings_number_next}
                  onChange={(event) => onUpdateNumbering('afregnings_number_next', event.target.value)}
                  className="mono w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">Fakturanr.</span>
                <input
                  type="text"
                  value={numbering.invoice_number_next}
                  onChange={(event) => onUpdateNumbering('invoice_number_next', event.target.value)}
                  className="mono w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                />
              </label>
            </div>
          </div>

          <div className="border border-brand-200 bg-white px-4 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Piyasa Fiyatları</p>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-brand-500">EUR / DKK FX</span>
                <input
                  type="text"
                  value={marketRates.eur_dkk_fx}
                  onChange={(event) =>
                    setMarketRates((current) => syncMarketRateState(current, { eur_dkk_fx: normalizeTextInput(event.target.value) }))
                  }
                  className="mono w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-emerald-200 bg-emerald-50 px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Au 24K DKK</p>
                  <p className="mono mt-1 text-lg font-black text-emerald-900">{formatDecimalFixed(marketRates.gold_24k_dkk)}</p>
                </div>
                <div className="border border-sky-200 bg-sky-50 px-3 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-sky-700">Ag 999 DKK</p>
                  <p className="mono mt-1 text-lg font-black text-sky-900">{formatDecimalFixed(marketRates.silver_dkk)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-brand-200 bg-white px-4 py-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">AFG Notu</p>
        <p className="mt-1 text-sm text-brand-700">Bu not yalnız AFG draft için tutulur; finalize notes alanına akar.</p>
        <textarea
          value={afgNote}
          onChange={(event) => setAfgNote(event.target.value)}
          rows={4}
          className="mt-3 w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
          placeholder="Bu alışa özel notlar..."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="border border-brand-200 bg-white">
          <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Gold Rates — EUR Truth</p>
            <p className="mt-1 text-sm text-brand-700">Tüm karat fiyatları EUR/g olarak düzenlenir; DKK karşılığı FX ile türetilir ve workbook’la mirror olur.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-brand-300">
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Karat</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Lødighed</th>
                  <th className="border border-amber-200 bg-amber-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-amber-700">EUR / g</th>
                  <th className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-700">DKK / g</th>
                </tr>
              </thead>
              <tbody>
                {goldMatrixRows.map((row) => (
                  <tr key={row.key}>
                    <td className="mono border border-brand-200 px-3 py-2 font-black text-brand-900">{row.label}</td>
                    <td className="mono border border-brand-200 px-3 py-2 text-brand-700">{row.lodighed}</td>
                    <td className="border border-amber-200 bg-amber-50 px-2 py-2">
                      <input
                        type="text"
                        value={row.eur_per_gram}
                        onChange={(event) => updateGoldRate(row.key, event.target.value)}
                        className="mono w-full border border-amber-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="mono border border-emerald-200 bg-emerald-50 px-3 py-2 text-right font-black text-emerald-900">
                      {row.dkk_per_gram}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-brand-200 bg-white">
          <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Silver Rates — EUR Truth</p>
            <p className="mt-1 text-sm text-brand-700">Silver satırları da EUR/g truth ile güncellenir; workbook `Variable værdier` bunu readonly DKK’ye çevirir.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-brand-300">
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Tip</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Lødighed</th>
                  <th className="border border-sky-200 bg-sky-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-sky-700">EUR / g</th>
                  <th className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-emerald-700">DKK / g</th>
                </tr>
              </thead>
              <tbody>
                {silverMatrixRows.map((row) => (
                  <tr key={row.key}>
                    <td className="border border-brand-200 px-3 py-2 font-semibold text-brand-900">{row.label}</td>
                    <td className="mono border border-brand-200 px-3 py-2 text-brand-700">{row.lodighed}</td>
                    <td className="border border-sky-200 bg-sky-50 px-2 py-2">
                      <input
                        type="text"
                        value={row.eur_per_gram}
                        onChange={(event) => updateSilverRate(row.key, event.target.value)}
                        className="mono w-full border border-sky-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="mono border border-emerald-200 bg-emerald-50 px-3 py-2 text-right font-black text-emerald-900">
                      {row.dkk_per_gram}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="border border-brand-200 bg-white">
          <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Kniv beregner</p>
            <p className="mt-1 text-sm text-brand-700">Gold helper blokları workbook’la mirror olur. `Aktar` ile ilgili gram satırına yazılır.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-brand-300">
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Satır</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Vægt</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Antal</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Total</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Hedef</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Aktar</th>
                </tr>
              </thead>
              <tbody>
                {goldCalculatorRows.map((row, index) => (
                  <tr key={row.row_key}>
                    <td className="mono border border-brand-200 px-3 py-2 font-black text-brand-700">{index + 1}</td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.unit_weight}
                        onChange={(event) => updateCalculatorRow('gold_rows', row.row_key, 'unit_weight', event.target.value)}
                        className="mono w-full border border-brand-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                      />
                    </td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.count}
                        onChange={(event) => updateCalculatorRow('gold_rows', row.row_key, 'count', event.target.value)}
                        className="mono w-full border border-brand-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                      />
                    </td>
                    <td className="mono border border-emerald-200 bg-emerald-50 px-3 py-2 text-right font-black text-emerald-900">
                      {formatDecimalFixed(row.total_weight)}
                    </td>
                    <td className="border border-brand-200 px-2 py-2">
                      <select
                        value={row.target_row_key}
                        onChange={(event) => updateCalculatorRow('gold_rows', row.row_key, 'target_row_key', event.target.value)}
                        className="w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700"
                      >
                        <option value="">Seç</option>
                        {GOLD_CALCULATOR_TARGETS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-brand-200 px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => applyCalculatorRow(row, 'gold')}
                        disabled={!row.target_row_key}
                        className="border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Aktar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-brand-200 bg-white">
          <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Beregner</p>
            <p className="mt-1 text-sm text-brand-700">Silver helper blokları da aynı şekilde manual input ve gram aktarımı destekler.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-brand-300">
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Satır</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Vægt</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Antal</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Total</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-brand-500">Hedef</th>
                  <th className="border border-brand-200 bg-brand-100 px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-brand-500">Aktar</th>
                </tr>
              </thead>
              <tbody>
                {silverCalculatorRows.map((row, index) => (
                  <tr key={row.row_key}>
                    <td className="mono border border-brand-200 px-3 py-2 font-black text-brand-700">{index + 1}</td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.unit_weight}
                        onChange={(event) => updateCalculatorRow('silver_rows', row.row_key, 'unit_weight', event.target.value)}
                        className="mono w-full border border-brand-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                      />
                    </td>
                    <td className="border border-brand-200 px-2 py-2">
                      <input
                        type="text"
                        value={row.count}
                        onChange={(event) => updateCalculatorRow('silver_rows', row.row_key, 'count', event.target.value)}
                        className="mono w-full border border-brand-300 bg-white px-3 py-1.5 text-right text-sm text-brand-900 outline-none focus:border-brand-700"
                      />
                    </td>
                    <td className="mono border border-emerald-200 bg-emerald-50 px-3 py-2 text-right font-black text-emerald-900">
                      {formatDecimalFixed(row.total_weight)}
                    </td>
                    <td className="border border-brand-200 px-2 py-2">
                      <select
                        value={row.target_row_key}
                        onChange={(event) => updateCalculatorRow('silver_rows', row.row_key, 'target_row_key', event.target.value)}
                        className="w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700"
                      >
                        <option value="">Seç</option>
                        {SILVER_CALCULATOR_TARGETS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-brand-200 px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => applyCalculatorRow(row, 'silver')}
                        disabled={!row.target_row_key}
                        className="border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Aktar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
