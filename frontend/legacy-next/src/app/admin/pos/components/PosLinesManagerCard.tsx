'use client';

import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { labelMetalType, labelProductType } from '@/lib/labels';
import { computeLineOfferDkk, formatMoneyDkk, mapPosSessionLineToExcelView, toLodighed } from '@/lib/pos-mappers';
import type { MetalType, PosMetalRates, PosSession, PosSessionLine, ProductType } from '@/types';
import {
  bulkRowColorClass,
  formatDkk,
  metalOptionPrefix,
  metalOptionStyle,
  metalSelectToneClass,
  purityPresetsForMetal,
} from '../pos-utils';
import type { PosBulkDraftRow, PosMixDraftRow, QuoteFormState } from '../pos-types';

type Option<T> = {
  value: T;
  label: string;
};

type PosLinesManagerCardProps = {
  supportsMultiline: boolean;
  canEditSession: boolean;
  busy: boolean;
  startBulkAddFlow: () => void;
  addBulkRowsAsLines: () => void | Promise<void>;
  bulkDraftRows: PosBulkDraftRow[];
  loadMetalBuyRates: () => void | Promise<void>;
  setShowAdvancedTools: Dispatch<SetStateAction<boolean>>;
  showAdvancedTools: boolean;
  resetBulkRows: (count?: number) => void;
  session: PosSession | null;
  loadPosLines: (sessionId: string, options?: { silent?: boolean }) => void | Promise<void>;
  loadingPosLines: boolean;
  addCurrentQuoteAsLine: () => void | Promise<void>;
  bulkAddOpen: boolean;
  metalTypeOptions: Array<Option<MetalType>>;
  bulkAddMetal: MetalType | '';
  setBulkAddMetal: Dispatch<SetStateAction<MetalType | ''>>;
  metalBuyRates: PosMetalRates | null;
  setBulkAddOpen: Dispatch<SetStateAction<boolean>>;
  confirmBulkAddFlow: () => void;
  mixComposerOpen: boolean;
  openMixComposer: () => void;
  setMixComposerOpen: Dispatch<SetStateAction<boolean>>;
  mixProductType: ProductType | '';
  setMixProductType: Dispatch<SetStateAction<ProductType | ''>>;
  productTypeOptions: Array<Option<ProductType>>;
  addMixRow: (seedMetal?: MetalType | '') => void;
  applyMixRowsToBulkDraft: () => void;
  mixRows: PosMixDraftRow[];
  patchMixRowMetal: (rowId: string, metal: MetalType | '') => void;
  quote: QuoteFormState;
  patchMixRowKarat: (rowId: string, purityKarat: string) => void;
  patchMixRow: (rowId: string, patch: Partial<Omit<PosMixDraftRow, 'id'>>) => void;
  removeMixRow: (rowId: string) => void;
  patchBulkRow: (rowId: string, patch: Partial<Omit<PosBulkDraftRow, 'id'>>) => void;
  patchBulkRowMetal: (rowId: string, metal: MetalType | '') => void;
  patchBulkRowKarat: (rowId: string, purityKarat: string) => void;
  removeBulkRow: (rowId: string) => void;
  posLines: PosSessionLine[];
  selectedLineId: string;
  setSelectedLineId: Dispatch<SetStateAction<string>>;
  selectedLine: PosSessionLine | null;
  posLinesTotalOffer: number;
  deleteSelectedLine: () => void | Promise<void>;
  applyLineToQuote: (line: PosSessionLine) => void;
  updateSelectedLineFromQuote: () => void | Promise<void>;
};

function renderDraftLineTotal(row: PosBulkDraftRow, tradeSide: PosSession['trade_side'] | undefined): string {
  const total = computeLineOfferDkk({
    tradeSide: tradeSide || 'buy_from_customer',
    weightGrams: row.weight_grams,
    purityPercentage: row.purity_percentage,
    rateDkk: row.rate_dkk || row.default_rate_dkk,
    marginPercent: row.margin_percent_internal,
  });
  return total === null ? '-' : `${formatMoneyDkk(total)} DKK`;
}

export function PosLinesManagerCard({
  supportsMultiline,
  canEditSession,
  busy,
  startBulkAddFlow,
  addBulkRowsAsLines,
  bulkDraftRows,
  loadMetalBuyRates,
  setShowAdvancedTools,
  showAdvancedTools,
  resetBulkRows,
  session,
  loadPosLines,
  loadingPosLines,
  addCurrentQuoteAsLine,
  bulkAddOpen,
  metalTypeOptions,
  bulkAddMetal,
  setBulkAddMetal,
  metalBuyRates,
  setBulkAddOpen,
  confirmBulkAddFlow,
  mixComposerOpen,
  openMixComposer,
  setMixComposerOpen,
  mixProductType,
  setMixProductType,
  productTypeOptions,
  addMixRow,
  applyMixRowsToBulkDraft,
  mixRows,
  patchMixRowMetal,
  quote,
  patchMixRowKarat,
  patchMixRow,
  removeMixRow,
  patchBulkRow,
  patchBulkRowMetal,
  patchBulkRowKarat,
  removeBulkRow,
  posLines,
  selectedLineId,
  setSelectedLineId,
  selectedLine,
  posLinesTotalOffer,
  deleteSelectedLine,
  applyLineToQuote,
  updateSelectedLineFromQuote,
}: PosLinesManagerCardProps) {
  const sortedPosLines = [...posLines].sort((a, b) => a.line_no - b.line_no);
  const selectedLineLabel = selectedLine ? `#${selectedLine.line_no}` : '-';

  return (
    <div className="mt-4 rounded-3xl border border-[#dcccae] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f0e2_100%)] p-4 shadow-[0_14px_34px_rgba(92,62,24,0.08)] md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#8b6b38]">
            {supportsMultiline ? 'Kalem Tablosu (Excel Uyumlu)' : 'Kalemler'}
          </p>
          <h4 className="mt-1 text-lg font-semibold text-[#3d2b10]">
            {supportsMultiline ? 'Afregningsbilag satirlari' : 'Tek kalem ve satis satirlari'}
          </h4>
          <p className="mt-1 text-sm text-brand-800">
            {supportsMultiline
              ? 'Kolonlar: Type, Karat / % Finhed, Lodighed, Vaegt i g, Enhedspris / g, I alt'
              : 'Satista tek urun akisinda da kalem listesi ayni kontratla gorulur.'}
          </p>
          <p className="mt-1 text-xs text-brand-700">Eklenen, guncellenen ve silinen satirlar musteri ekranina anlik yansir.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {supportsMultiline ? (
            <>
              <Button onClick={startBulkAddFlow} disabled={!canEditSession || busy}>
                + Satir Ac
              </Button>
              <Button onClick={addBulkRowsAsLines} disabled={!canEditSession || busy || !bulkDraftRows.length}>
                Satirlari Ekle
              </Button>
              <Button variant="ghost" onClick={() => void loadMetalBuyRates()} disabled={!canEditSession || busy}>
                Fiyatlari Yenile
              </Button>
              <Button variant="ghost" onClick={() => setShowAdvancedTools((prev) => !prev)} disabled={!canEditSession || busy}>
                {showAdvancedTools ? 'Ileri Araclari Gizle' : 'Ileri Araclar'}
              </Button>
              <Button variant="ghost" onClick={() => resetBulkRows(0)} disabled={!canEditSession || busy || !bulkDraftRows.length}>
                Temizle
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => session && void loadPosLines(session.id)}
                disabled={!session || loadingPosLines || busy}
              >
                {loadingPosLines ? 'Yukleniyor...' : 'Kalemleri Yenile'}
              </Button>
              <Button onClick={addCurrentQuoteAsLine} disabled={!canEditSession || busy}>
                Kalem Ekle
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#e8d8bb] bg-white/85 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Taslak Satir</p>
          <p className="mt-1 text-2xl font-semibold text-[#3d2b10]">{bulkDraftRows.length}</p>
        </div>
        <div className="rounded-2xl border border-[#e8d8bb] bg-white/85 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Canli Kalem</p>
          <p className="mt-1 text-2xl font-semibold text-[#3d2b10]">{sortedPosLines.length}</p>
        </div>
        <div className="rounded-2xl border border-[#e8d8bb] bg-white/85 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Secili Satir</p>
          <p className="mt-1 text-2xl font-semibold text-[#3d2b10]">{selectedLineLabel}</p>
        </div>
        <div className="rounded-2xl border border-[#d7c193] bg-[linear-gradient(135deg,#352615_0%,#21170f_100%)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#d9bd81]">Kalem Toplami</p>
          <p className="mt-1 text-2xl font-semibold text-[#f4d99b]">{formatDkk(posLinesTotalOffer)} DKK</p>
        </div>
      </div>

      {supportsMultiline && (
        <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50/80 p-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full border border-brand-300 bg-white px-2 py-1 font-semibold text-brand-800">
              Acik Satir: {bulkDraftRows.length}
            </span>
          </div>

          {showAdvancedTools ? (
            <div className="mt-3 rounded-lg border border-brand-300 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-brand-900">Karisim Olusturucu</p>
                  <p className="text-xs text-brand-700">Bir urunde birden fazla metal/ayar varsa parcalayip satira cevirin.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={openMixComposer} disabled={!canEditSession || busy}>
                    Karisim Ac
                  </Button>
                  {mixComposerOpen && (
                    <Button variant="ghost" onClick={() => setMixComposerOpen(false)} disabled={!canEditSession || busy}>
                      Kapat
                    </Button>
                  )}
                </div>
              </div>

              {mixComposerOpen && (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 md:grid-cols-[240px_auto_auto] md:items-end">
                    <div>
                      <p className="mb-1 text-xs font-semibold text-brand-700">Type</p>
                      <Select
                        value={mixProductType}
                        onChange={(event) => setMixProductType(event.target.value as ProductType | '')}
                        disabled={!canEditSession || busy}
                      >
                        <option value="">Urun tipi secin</option>
                        {productTypeOptions.map((option) => (
                          <option key={`mix-product-type-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => addMixRow((quote.metal_type || session?.metal_type || '') as MetalType | '')}
                      disabled={!canEditSession || busy}
                    >
                      + Karisim Satiri
                    </Button>
                    <Button onClick={applyMixRowsToBulkDraft} disabled={!canEditSession || busy || !mixRows.length}>
                      Karisimi Taslaga Aktar
                    </Button>
                  </div>

                  {mixRows.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-brand-200">
                      <table className="min-w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-brand-100">
                            <th className="border border-brand-200 px-2 py-1 text-left">#</th>
                            <th className="border border-brand-200 px-2 py-1 text-left">Metal</th>
                            <th className="border border-brand-200 px-2 py-1 text-left">Karat / % Finhed</th>
                            <th className="border border-brand-200 px-2 py-1 text-left">Lodighed</th>
                            <th className="border border-brand-200 px-2 py-1 text-left">Vaegt i g</th>
                            <th className="border border-brand-200 px-2 py-1 text-left">Not</th>
                            <th className="border border-brand-200 px-2 py-1 text-left">Sil</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mixRows.map((row, index) => (
                            <tr key={row.id} className={bulkRowColorClass(row.metal_type)}>
                              <td className="border border-brand-200 px-2 py-1 font-semibold">{index + 1}</td>
                              <td className="border border-brand-200 px-2 py-1">
                                <select
                                  value={row.metal_type}
                                  onChange={(event) => patchMixRowMetal(row.id, event.target.value as MetalType | '')}
                                  disabled={!canEditSession || busy}
                                  className={`w-28 rounded border border-brand-200 bg-white px-1 py-1 text-xs ${metalSelectToneClass(row.metal_type)}`}
                                >
                                  <option value="">Metal</option>
                                  {metalTypeOptions.map((option) => (
                                    <option key={`mix-metal-${row.id}-${option.value}`} value={option.value} style={metalOptionStyle(option.value)}>
                                      {metalOptionPrefix(option.value)} {option.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="border border-brand-200 px-2 py-1">
                                <input
                                  list={`mix-purity-presets-${row.id}`}
                                  value={row.purity_karat}
                                  onChange={(event) => patchMixRowKarat(row.id, event.target.value)}
                                  disabled={!canEditSession || busy}
                                  className="w-28 rounded border border-brand-200 px-1 py-1 text-xs"
                                  placeholder="18K / 925"
                                />
                                <datalist id={`mix-purity-presets-${row.id}`}>
                                  {purityPresetsForMetal(row.metal_type || quote.metal_type || '').map((preset) => (
                                    <option key={`mix-karat-${row.id}-${preset.value}-${preset.purity}`} value={preset.value}>
                                      {preset.value} ({preset.purity}%)
                                    </option>
                                  ))}
                                </datalist>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  value={row.purity_percentage}
                                  onChange={(event) => patchMixRow(row.id, { purity_percentage: event.target.value })}
                                  disabled={!canEditSession || busy}
                                  className="mt-1 w-24 rounded border border-brand-200 px-1 py-1 text-xs"
                                  placeholder="%"
                                />
                              </td>
                              <td className="border border-brand-200 px-2 py-1">{toLodighed(row.purity_karat, row.purity_percentage)}</td>
                              <td className="border border-brand-200 px-2 py-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={row.weight_grams}
                                  onChange={(event) => patchMixRow(row.id, { weight_grams: event.target.value })}
                                  disabled={!canEditSession || busy}
                                  className="w-20 rounded border border-brand-200 px-1 py-1 text-xs"
                                  placeholder="g"
                                />
                              </td>
                              <td className="border border-brand-200 px-2 py-1">
                                <input
                                  value={row.notes}
                                  onChange={(event) => patchMixRow(row.id, { notes: event.target.value })}
                                  disabled={!canEditSession || busy}
                                  className="w-36 rounded border border-brand-200 px-1 py-1 text-xs"
                                  placeholder="Parca notu"
                                />
                              </td>
                              <td className="border border-brand-200 px-2 py-1">
                                <Button variant="ghost" onClick={() => removeMixRow(row.id)} disabled={!canEditSession || busy}>
                                  Sil
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-brand-700">Karisim satiri yok.</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-brand-700">
              Ileri araclar kapali. Gerekirse karisim olusturucuyu acabilirsiniz.
            </p>
          )}

          {bulkAddOpen && (
            <div className="mt-3 rounded-lg border border-brand-300 bg-white p-3">
              <p className="text-sm font-semibold text-brand-900">Satir Ac</p>
              <div className="mt-2 grid gap-3 lg:grid-cols-[320px_auto] lg:items-center">
                <div>
                  <p className="mb-1 text-xs font-semibold text-brand-700">Metal</p>
                  <Select
                    value={bulkAddMetal}
                    onChange={(event) => setBulkAddMetal(event.target.value as MetalType | '')}
                    className={metalSelectToneClass(bulkAddMetal)}
                    disabled={!canEditSession || busy}
                  >
                    <option value="">Metal secin</option>
                    {metalTypeOptions.map((option) => (
                      <option key={`bulk-add-metal-${option.value}`} value={option.value} style={metalOptionStyle(option.value)}>
                        {metalOptionPrefix(option.value)} {option.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-brand-700">
                    Varsayilan alis kuru:{' '}
                    <strong>
                      {bulkAddMetal && metalBuyRates?.[bulkAddMetal]
                        ? `${formatDkk(metalBuyRates[bulkAddMetal])} DKK/g`
                        : '—'}
                    </strong>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setBulkAddOpen(false)} disabled={!canEditSession || busy}>
                    Iptal
                  </Button>
                  <Button onClick={confirmBulkAddFlow} disabled={!canEditSession || busy}>
                    Onayla ve Satir Ac
                  </Button>
                </div>
              </div>
            </div>
          )}

          {bulkDraftRows.length > 0 ? (
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-brand-900">Belge Taslak Satirlari</p>
                  <p className="text-xs text-brand-700">Bu satirlar once taslakta hazirlanir, sonra oturuma yazilir ve customer display ekranina yansir.</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-brand-200 bg-white">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-brand-100">
                    <th className="border border-brand-200 px-2 py-1 text-left">#</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Type</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Metal</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Karat / % Finhed</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Lodighed</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Vaegt i g</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Enhedspris / g</th>
                    {showAdvancedTools && <th className="border border-brand-200 px-2 py-1 text-left">Avance %</th>}
                    <th className="border border-brand-200 px-2 py-1 text-left">I alt</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Not</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Sil</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkDraftRows.map((row, index) => (
                    <tr key={row.id} className={bulkRowColorClass(row.metal_type)}>
                      <td className="border border-brand-200 px-2 py-1 font-semibold">{index + 1}</td>
                      <td className="border border-brand-200 px-2 py-1">
                        <select
                          value={row.product_type}
                          onChange={(event) => patchBulkRow(row.id, { product_type: event.target.value as ProductType | '' })}
                          disabled={!canEditSession || busy}
                          className="w-28 rounded border border-brand-200 bg-white px-1 py-1 text-xs"
                        >
                          <option value="">Type</option>
                          {productTypeOptions.map((option) => (
                            <option key={`bulk-product-${row.id}-${option.value}`} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        <select
                          value={row.metal_type}
                          onChange={(event) => patchBulkRowMetal(row.id, event.target.value as MetalType | '')}
                          disabled={!canEditSession || busy}
                          className={`w-32 rounded border border-brand-200 bg-white px-1 py-1 text-xs ${metalSelectToneClass(row.metal_type)}`}
                        >
                          <option value="">Metal</option>
                          {metalTypeOptions.map((option) => (
                            <option key={`bulk-metal-${row.id}-${option.value}`} value={option.value} style={metalOptionStyle(option.value)}>
                              {metalOptionPrefix(option.value)} {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        <input
                          list={`bulk-purity-presets-${row.id}`}
                          value={row.purity_karat}
                          onChange={(event) => patchBulkRowKarat(row.id, event.target.value)}
                          disabled={!canEditSession || busy}
                          className="w-24 rounded border border-brand-200 px-1 py-1 text-xs"
                          placeholder="18K"
                        />
                        <datalist id={`bulk-purity-presets-${row.id}`}>
                          {purityPresetsForMetal(row.metal_type || quote.metal_type || '').map((preset) => (
                            <option key={`bulk-karat-${row.id}-${preset.value}-${preset.purity}`} value={preset.value}>
                              {preset.value} ({preset.purity}%)
                            </option>
                          ))}
                        </datalist>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={row.purity_percentage}
                          onChange={(event) => patchBulkRow(row.id, { purity_percentage: event.target.value })}
                          disabled={!canEditSession || busy}
                          className="mt-1 w-20 rounded border border-brand-200 px-1 py-1 text-xs"
                          placeholder="%"
                        />
                      </td>
                      <td className="border border-brand-200 px-2 py-1">{toLodighed(row.purity_karat, row.purity_percentage)}</td>
                      <td className="border border-brand-200 px-2 py-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.weight_grams}
                          onChange={(event) => patchBulkRow(row.id, { weight_grams: event.target.value })}
                          disabled={!canEditSession || busy}
                          className="w-20 rounded border border-brand-200 px-1 py-1 text-xs"
                          placeholder="g"
                        />
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.rate_dkk}
                          onChange={(event) => patchBulkRow(row.id, { rate_dkk: event.target.value })}
                          disabled={!canEditSession || busy}
                          className="w-24 rounded border border-brand-200 px-1 py-1 text-xs"
                          placeholder={row.default_rate_dkk ? `${formatDkk(row.default_rate_dkk)} DKK/g` : 'DKK/g'}
                        />
                      </td>
                      {showAdvancedTools && (
                        <td className="border border-brand-200 px-2 py-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={row.margin_percent_internal}
                            onChange={(event) => patchBulkRow(row.id, { margin_percent_internal: event.target.value })}
                            disabled={!canEditSession || busy}
                            className="w-20 rounded border border-brand-200 px-1 py-1 text-xs"
                            placeholder="%"
                          />
                        </td>
                      )}
                      <td className="border border-brand-200 px-2 py-1 font-semibold text-brand-900">
                        {renderDraftLineTotal(row, session?.trade_side)}
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(event) => patchBulkRow(row.id, { notes: event.target.value })}
                          disabled={!canEditSession || busy}
                          className="w-44 rounded border border-brand-200 px-1 py-1 text-xs"
                          placeholder="Satir notu"
                        />
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        <Button variant="ghost" onClick={() => removeBulkRow(row.id)} disabled={!canEditSession || busy}>
                          Sil
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-brand-700">Satir yok. + Satir Ac ile baslayin.</p>
          )}

          <p className="mt-2 text-xs text-brand-700">Kur bossa, metal alis kuru otomatik kullanilir.</p>
        </div>
      )}

      {sortedPosLines.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#3d2b10]">Canli Oturum Kalemleri</p>
              <p className="text-xs text-[#6d5531]">Bu tablo oturuma yazilmis, customer display ekranina giden gercek satirlari gosterir.</p>
            </div>
            <div className="rounded-full border border-[#d8c39a] bg-[#fbf4e6] px-3 py-1.5 text-xs font-semibold text-[#684f24]">
              Deterministik sira: line_no
            </div>
          </div>
        <div className="overflow-x-auto rounded-xl border border-[#decfae] bg-white">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#f8f1e2]">
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">#</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Type</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Metal</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Karat / % Finhed</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Lødighed</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Vægt i g</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Enhedspris / g</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">I alt</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Not</th>
                <th className="border border-[#eadcc3] px-2 py-1.5 text-left font-semibold text-[#5a431b]">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {sortedPosLines.map((line) => {
                const active = selectedLineId === line.id;
                const excel = mapPosSessionLineToExcelView(line);
                return (
                  <tr
                    key={line.id}
                    className={`${active ? 'bg-amber-50' : 'bg-white'} cursor-pointer transition hover:bg-amber-50/70`}
                    onClick={() => setSelectedLineId(line.id)}
                  >
                    <td className="border border-[#f0e5d1] px-2 py-1.5 font-semibold text-[#513b17]">#{excel.lineNo}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.typeLabel}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.metalLabel}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.karatFinhed}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.lodighed}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.weightText}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.unitRateText}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 font-semibold text-[#5a431b]">{excel.totalText}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5 text-brand-900">{excel.notes}</td>
                    <td className="border border-[#f0e5d1] px-2 py-1.5">
                      <Button
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (supportsMultiline) {
                            setSelectedLineId(line.id);
                          } else {
                            applyLineToQuote(line);
                          }
                        }}
                        disabled={!canEditSession || busy}
                      >
                        {supportsMultiline ? 'Seç' : 'Teklife Aktar'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-brand-700">Henuz kalem yok.</p>
      )}

      {sortedPosLines.length > 0 && (
        <div className="mt-4 grid gap-2 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-xs text-brand-800 md:grid-cols-3">
          <p>
            Secili Kalem: <strong>{selectedLine ? `#${selectedLine.line_no}` : '-'}</strong>
          </p>
          <p>
            Kalem Toplam Teklifi: <strong>{formatDkk(posLinesTotalOffer)} DKK</strong>
          </p>
          <p>
            Son Satir Notu: <strong>{selectedLine?.notes?.trim() || '-'}</strong>
          </p>
        </div>
      )}

      {supportsMultiline ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" onClick={deleteSelectedLine} disabled={!selectedLineId || !canEditSession || busy}>
            Secili Kalemi Sil
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => selectedLine && applyLineToQuote(selectedLine)}
            disabled={!selectedLine || !canEditSession || busy}
          >
            Secili Kalemi Teklife Aktar
          </Button>
          <Button variant="ghost" onClick={updateSelectedLineFromQuote} disabled={!selectedLineId || !canEditSession || busy}>
            Secili Kalemi Guncelle
          </Button>
          <Button variant="danger" onClick={deleteSelectedLine} disabled={!selectedLineId || !canEditSession || busy}>
            Secili Kalemi Sil
          </Button>
        </div>
      )}
    </div>
  );
}
