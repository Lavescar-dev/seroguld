import { useMemo, useState } from 'react';
import { Download, ExternalLink, FileSpreadsheet, RefreshCw, X } from 'lucide-react';

import { t, useLocale } from '@/lib/locale';
import type { DocumentArtifactPreview } from '@/types';

import type { EmbeddedCellError, EmbeddedSaveState, EmbeddedWorkbookSheet } from './types';

export type EmbeddedWorkbookSurfaceProps = {
  kind: string;
  artifactKey: string;
  preview: DocumentArtifactPreview | null;
  sheets: EmbeddedWorkbookSheet[];
  isLoading: boolean;
  isError: boolean;
  isReadOnly: boolean;
  managedExcelOpen: boolean;
  revision: number;
  dirtyCount: number;
  saveState: EmbeddedSaveState;
  cellErrors: Record<string, EmbeddedCellError>;
  excelAvailable: boolean | null;
  onRetryExcelProbe?: () => void | Promise<void>;
  excelMessage: string | null;
  excelConflict: boolean;
  isOpeningExcel: boolean;
  onCellChange: (sheet: string, cellRef: string, value: string) => void;
  onExport: () => void | Promise<void>;
  onOpenExcel: () => void | Promise<void>;
  onFocusExistingExcel: () => void | Promise<void>;
  onCloseExistingExcel: () => void | Promise<void>;
  onCancelExcelConflict: () => void;
  onReload: () => void | Promise<void>;
  onClose?: () => void | Promise<void>;
  layoutMode?: 'page' | 'dock' | 'workspace';
  variant?: 'modern' | 'classic';
};

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

function inputType(inputKind?: string): 'text' | 'date' {
  if (inputKind === 'date') return 'date';
  // HTML number inputs reject the comma decimal notation used by the Danish
  // and Turkish workbook contracts (for example `12,4`).  Keep the input as
  // text and let the backend normalize/validate the value.
  return 'text';
}

function cellKey(sheet: string, cellRef: string) {
  return `${sheet}:${cellRef}`;
}

function versionLabel(version: string | null | undefined, locale: ReturnType<typeof useLocale>) {
  if (version === 'draft') return t('workbook.version.draft', locale);
  if (version === 'final') return t('workbook.version.final', locale);
  if (version === 'snapshot') return t('workbook.version.snapshot', locale);
  if (version === 'live') return t('workbook.version.live', locale);
  return version || t('workbook.version.ready', locale);
}

function kindLabel(kind: string, locale: ReturnType<typeof useLocale>) {
  if (kind === 'alis-workspace') return t('workbook.kind.draft', locale);
  if (kind === 'alis-document') return t('workbook.kind.document', locale);
  if (kind === 'depolama') return t('workbook.kind.inventory', locale);
  if (kind === 'log') return t('workbook.kind.log', locale);
  return t('workbook.kind.fallback', locale);
}

export function EmbeddedWorkbookSurface({
  kind,
  artifactKey,
  preview,
  sheets,
  isLoading,
  isError,
  isReadOnly,
  managedExcelOpen,
  revision,
  dirtyCount,
  saveState,
  cellErrors,
  excelAvailable,
  onRetryExcelProbe,
  excelMessage,
  excelConflict,
  isOpeningExcel,
  onCellChange,
  onExport,
  onOpenExcel,
  onFocusExistingExcel,
  onCloseExistingExcel,
  onCancelExcelConflict,
  onReload,
  onClose,
  layoutMode = 'page',
  variant = 'classic',
}: EmbeddedWorkbookSurfaceProps) {
  const locale = useLocale();
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const activeSheet = useMemo(
    () => sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))] || null,
    [activeSheetIndex, sheets],
  );
  const effectiveReadOnly = isReadOnly || managedExcelOpen;
  const compact = layoutMode !== 'page';
  const modern = variant === 'modern';
  const labelClass = modern
    ? 'text-[11px] font-semibold tracking-[0.08em]'
    : 'text-[11px] font-black uppercase tracking-widest';
  const buttonClass = modern
    ? 'inline-flex items-center gap-1.5 rounded-sg-md border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50';
  const statusLabel = managedExcelOpen
    ? t('workbook.excelEditing', locale)
    : saveState === 'saving'
      ? t('workbook.saving', locale)
      : saveState === 'saved'
        ? t('workbook.saved', locale)
        : saveState === 'conflict'
          ? t('workbook.conflict', locale)
          : saveState === 'error'
            ? t('workbook.saveError', locale)
            : effectiveReadOnly
              ? t('workbook.readonly', locale)
              : t('workbook.embedded', locale);

  return (
    <section
      className={modern
        ? (compact ? 'flex h-full min-h-0 flex-col bg-sg-surface-soft text-sg-text' : 'min-h-screen bg-sg-surface-soft text-sg-text')
        : (compact ? 'flex h-full min-h-0 flex-col bg-stone-100 text-brand-950' : 'min-h-screen bg-stone-100 text-brand-950')}
      style={sansStyle}
    >
      <header className={`${modern ? 'border-b border-sg-border bg-sg-surface shadow-sg-sm' : 'border-b border-brand-300 bg-white shadow-sm'} ${compact ? 'px-3 py-3' : 'px-6 py-4'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-2 ${modern ? 'rounded-full border border-sg-accent/25 bg-sg-accent-soft px-3 py-1 text-sg-accent' : 'border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-700'} ${labelClass}`}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {kindLabel(kind, locale)} · {t('workbook.embedded', locale)}
              </span>
              <span className={`${modern ? 'rounded-full border border-sg-border bg-sg-surface-soft px-2 py-1 text-sg-text-soft' : 'border border-brand-300 bg-brand-50 px-2 py-1 text-brand-700'} ${labelClass}`}>
                {versionLabel(preview?.artifact?.version_kind, locale)}
              </span>
              <span className={`${modern ? 'rounded-full' : ''} border px-2 py-1 ${labelClass} ${effectiveReadOnly ? (modern ? 'border-sg-border bg-sg-surface-soft text-sg-text-soft' : 'border-brand-300 bg-white text-brand-600') : (modern ? 'border-sg-amber/30 bg-sg-amber-soft text-sg-amber' : 'border-amber-300 bg-amber-50 text-amber-800')}`}>
                {effectiveReadOnly ? t('workbook.readonly', locale) : t('workbook.editable', locale)}
              </span>
            </div>
            <h1 className={`${compact ? 'mt-1 text-base' : 'mt-3 text-2xl'} ${modern ? 'font-semibold tracking-tight text-sg-text' : 'font-black tracking-[0.05em] text-brand-950'}`}>
              {preview?.title || t('workbook.embedded', locale)}
            </h1>
            <p className={`mt-1 text-xs ${modern ? 'text-sg-text-soft' : 'text-brand-500'}`}>
              {preview?.subtitle || `${kind} / ${artifactKey}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onOpenExcel()}
                disabled={isOpeningExcel || managedExcelOpen || excelAvailable === false}
                title={excelAvailable === false ? t('workbook.excelMissing', locale) : t('workbook.openExcel', locale)}
              className={`${buttonClass} ${modern ? 'border-sg-accent/25 bg-sg-accent-soft text-sg-accent hover:bg-sg-accent/15' : 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100'}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {isOpeningExcel ? t('workbook.excelOpening', locale) : t('workbook.openExcel', locale)}
            </button>
            <button
              type="button"
              onClick={() => void onExport()}
              disabled={!preview}
              className={`${buttonClass} ${modern ? 'border-sg-accent bg-sg-accent text-white hover:bg-sg-accent/90' : 'border-brand-900 bg-brand-900 text-white hover:bg-black'}`}
            >
              <Download className="h-3.5 w-3.5" />
              {t('workbook.export', locale)}
            </button>
            <button
              type="button"
              onClick={() => void onReload()}
              className={`${buttonClass} ${modern ? 'border-sg-border bg-sg-surface text-sg-text-soft hover:bg-sg-surface-soft' : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50'}`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('workbook.reload', locale)}
            </button>
            {onClose ? (
              <button
                type="button"
                onClick={() => void onClose()}
                className={`${buttonClass} border-sg-border bg-sg-surface text-sg-text-soft hover:bg-sg-surface-soft`}
              >
                <X className="h-3.5 w-3.5" />
                {t('workbook.closePanel', locale)}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]" style={monoStyle}>
          <span className={`${modern ? 'rounded-full' : ''} border px-2 py-1 ${labelClass} ${saveState === 'error' || saveState === 'conflict' ? 'border-rose-300 bg-rose-50 text-rose-800' : (modern ? 'border-sg-border bg-sg-surface-soft text-sg-text-soft' : 'border-brand-200 bg-brand-50 text-brand-700')}`}>
            {statusLabel}
          </span>
          <span className={`${modern ? 'rounded-full border-sg-border bg-sg-surface' : 'border-brand-200 bg-white'} border px-2 py-1 ${modern ? 'text-sg-text-soft' : 'text-brand-600'}`}>
            {t('workbook.revision', locale)} {revision}
          </span>
          {dirtyCount > 0 ? (
            <span className={`${modern ? 'rounded-full border-sg-amber/30 bg-sg-amber-soft text-sg-amber' : 'border-amber-300 bg-amber-50 text-amber-800'} border px-2 py-1`}>
              {dirtyCount} {t('workbook.dirty', locale)}
            </span>
          ) : null}
              {excelMessage || excelAvailable === false ? (
                <span className="text-sky-800">
                  {excelMessage || t('workbook.excelMissing', locale)}
                  {excelAvailable === false && onRetryExcelProbe ? (
                    <button
                      type="button"
                      onClick={() => void onRetryExcelProbe()}
                      className="ml-2 underline decoration-dotted underline-offset-2 hover:opacity-80"
                    >
                      Yeniden dene
                    </button>
                  ) : null}
                </span>
              ) : null}
        </div>
        {excelConflict ? (
          <div className={`${modern ? 'rounded-sg-md border-sg-amber/30 bg-sg-amber-soft text-sg-amber' : 'border-amber-300 bg-amber-50 text-amber-900'} mt-3 flex flex-wrap items-center gap-2 border px-3 py-2 text-xs`}>
            <span className="font-semibold">{t('workbook.excelConflict', locale)}</span>
            <button
              type="button"
              onClick={() => void onFocusExistingExcel()}
              className={modern ? 'rounded-sg-md border border-sg-amber/30 bg-sg-surface px-2 py-1 font-semibold hover:bg-sg-surface-soft' : 'border border-amber-400 bg-white px-2 py-1 font-bold hover:bg-amber-100'}
            >
              {t('workbook.showExcel', locale)}
            </button>
            <button
              type="button"
              onClick={() => void onCloseExistingExcel()}
              className={modern ? 'rounded-sg-md border border-sg-amber bg-sg-amber px-2 py-1 font-semibold text-white hover:bg-sg-amber/90' : 'border border-amber-600 bg-amber-600 px-2 py-1 font-bold text-white hover:bg-amber-700'}
            >
              {t('workbook.closeExcel', locale)}
            </button>
            <button
              type="button"
              onClick={onCancelExcelConflict}
              className={modern ? 'rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1 font-semibold text-sg-text-soft hover:bg-sg-surface-soft' : 'border border-brand-300 bg-white px-2 py-1 font-bold text-brand-700 hover:bg-brand-50'}
            >
              {t('workbook.cancel', locale)}
            </button>
          </div>
        ) : null}
      </header>

      <div className={`${compact ? 'min-h-0 flex-1 overflow-hidden px-3 py-3' : 'px-6 py-5'} ${modern ? 'bg-sg-surface-soft' : ''}`}>
        {isLoading ? (
          <div className={modern ? 'rounded-sg-lg border border-sg-border bg-sg-surface px-6 py-12 text-center text-sm text-sg-text-soft' : 'border border-brand-200 bg-white px-6 py-12 text-center text-sm text-brand-600'}>
            {t('workbook.loading', locale)}
          </div>
        ) : isError || !preview ? (
          <div className={modern ? 'rounded-sg-lg border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm text-rose-700' : 'border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm text-rose-700'}>
            {t('workbook.error', locale)}
          </div>
        ) : sheets.length === 0 ? (
          <div className={modern ? 'rounded-sg-lg border border-sg-border bg-sg-surface px-6 py-12 text-center text-sm text-sg-text-soft' : 'border border-brand-200 bg-white px-6 py-12 text-center text-sm text-brand-600'}>
            {t('workbook.noSheets', locale)}
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {sheets.map((sheet, index) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheetIndex(index)}
                  className={`${modern ? 'rounded-sg-md text-xs font-semibold' : 'text-[10px] font-black uppercase tracking-widest'} border px-3 py-2 transition ${index === activeSheetIndex ? (modern ? 'border-sg-accent bg-sg-accent text-white' : 'border-brand-900 bg-brand-900 text-white') : (modern ? 'border-sg-border bg-sg-surface text-sg-text-soft hover:bg-sg-surface-soft' : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50')}`}
                >
                  {t('workbook.sheet', locale)}: {sheet.name}
                </button>
              ))}
            </div>

            {activeSheet ? (
              <div className={`${modern ? 'rounded-sg-lg border-sg-border shadow-sg-sm' : 'border-brand-300 shadow-sm'} flex min-h-0 flex-1 flex-col overflow-hidden border bg-white`}>
                <div className={`${modern ? 'border-sg-border bg-sg-surface-soft' : 'border-brand-200 bg-brand-50'} flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2`}>
                  <div>
                    <h2 className={modern ? 'text-sm font-semibold text-sg-text' : 'text-xs font-black uppercase tracking-widest text-brand-800'}>{activeSheet.name}</h2>
                    {activeSheet.note ? <p className={`mt-1 text-[11px] ${modern ? 'text-sg-text-soft' : 'text-brand-500'}`}>{activeSheet.note}</p> : null}
                  </div>
                  <span className={modern ? 'text-xs font-medium text-sg-text-soft' : 'text-[10px] font-black uppercase tracking-widest text-brand-500'} style={monoStyle}>
                    {activeSheet.rows.length} {t('workbook.rows', locale)}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={modern ? 'sticky left-0 top-0 z-header border-b border-r border-sg-border bg-sg-surface-soft px-3 py-2 text-center text-xs font-semibold text-sg-text-soft' : 'sticky left-0 top-0 z-header border-b border-r border-brand-300 bg-stone-200 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-brand-700'}>#</th>
                        {activeSheet.columns.map((column) => (
                          <th key={column} className={modern ? 'sticky top-0 z-sticky border-b border-r border-sg-border bg-sg-surface-soft px-3 py-2 text-center text-xs font-semibold text-sg-text-soft' : 'sticky top-0 z-sticky border-b border-r border-brand-300 bg-stone-200 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-brand-700'}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeSheet.rows.map((row, rowIndex) => (
                        <tr key={`${activeSheet.name}-${rowIndex}`} className={modern ? (rowIndex % 2 === 0 ? 'bg-sg-surface' : 'bg-sg-surface-soft/60') : (rowIndex % 2 === 0 ? 'bg-white' : 'bg-stone-50')}>
                          <th className={modern ? 'sticky left-0 z-sticky border-b border-r border-sg-border bg-sg-surface-soft px-3 py-2 text-center text-xs font-medium text-sg-text-soft' : 'sticky left-0 z-sticky border-b border-r border-brand-300 bg-stone-100 px-3 py-2 text-center text-[10px] font-black text-brand-600'}>{row[0]?.rowNumber ?? rowIndex + 1}</th>
                          {row.map((cell, columnIndex) => {
                            if (!cell) return null;
                            const key = cellKey(activeSheet.name, cell.cellRef);
                            const error = cellErrors[key];
                            const editable = cell.editable && !effectiveReadOnly && !cell.formula;
                            const selected = selectedCell === key;
                            return (
                              <td
                                key={`${rowIndex}-${columnIndex}`}
                                colSpan={cell.colSpan}
                                rowSpan={cell.rowSpan}
                                onClick={() => setSelectedCell(key)}
                                className={`${modern ? 'border-sg-border text-sg-text' : 'border-brand-200 text-brand-900'} min-w-[8rem] border-b border-r px-2 py-1.5 align-top text-sm ${editable ? (modern ? 'bg-sg-amber-soft/60' : 'bg-amber-50') : ''} ${selected ? (modern ? 'ring-2 ring-inset ring-sg-accent' : 'ring-2 ring-inset ring-sky-500') : ''} ${error ? 'bg-rose-50 ring-2 ring-inset ring-rose-500' : ''}`}
                                title={error?.message || cell.label || cell.cellRef}
                                style={monoStyle}
                              >
                                {editable ? (
                                  cell.inputKind === 'payment_method' ? (
                                    <select
                                      aria-label={cell.label || cell.cellRef}
                                      value={cell.value}
                                      onChange={(event) => onCellChange(activeSheet.name, cell.cellRef, event.target.value)}
                                      className={modern ? 'w-full rounded-sg-sm border border-sg-amber/30 bg-sg-surface px-1 py-1 text-xs font-medium text-sg-text outline-none focus:border-sg-accent' : 'w-full border border-amber-300 bg-white px-1 py-1 text-xs font-bold text-brand-900 outline-none focus:border-sky-500'}
                                    >
                                      <option value="Kontant">{t('workbook.payment.cash', locale)}</option>
                                      <option value="Overførsel">{t('workbook.payment.bank', locale)}</option>
                                    </select>
                                  ) : cell.inputKind === 'boolean' ? (
                                    <select
                                      aria-label={cell.label || cell.cellRef}
                                      value={cell.value === '1' ? '1' : '0'}
                                      onChange={(event) => onCellChange(activeSheet.name, cell.cellRef, event.target.value)}
                                      className={modern ? 'w-full rounded-sg-sm border border-sg-amber/30 bg-sg-surface px-1 py-1 text-xs font-medium text-sg-text outline-none focus:border-sg-accent' : 'w-full border border-amber-300 bg-white px-1 py-1 text-xs font-bold text-brand-900 outline-none focus:border-sky-500'}
                                    >
                                      <option value="1">Evet · %25</option>
                                      <option value="0">Hayır · %0</option>
                                    </select>
                                  ) : cell.inputKind === 'status' ? (
                                    <select
                                      aria-label={cell.label || cell.cellRef}
                                      value={cell.value}
                                      onChange={(event) => onCellChange(activeSheet.name, cell.cellRef, event.target.value)}
                                      className={modern ? 'w-full rounded-sg-sm border border-sg-amber/30 bg-sg-surface px-1 py-1 text-xs font-medium text-sg-text outline-none focus:border-sg-accent' : 'w-full border border-amber-300 bg-white px-1 py-1 text-xs font-bold text-brand-900 outline-none focus:border-sky-500'}
                                    >
                                      <option value="active">{t('workbook.status.active', locale)}</option>
                                      <option value="inactive">{t('workbook.status.inactive', locale)}</option>
                                    </select>
                                  ) : (
                                    <input
                                      aria-label={cell.label || cell.cellRef}
                                      type={inputType(cell.inputKind)}
                                      inputMode={cell.inputKind === 'decimal' || cell.inputKind === 'percent' ? 'decimal' : undefined}
                                      step={cell.inputKind === 'percent' ? '0.01' : 'any'}
                                      value={cell.value}
                                      onChange={(event) => onCellChange(activeSheet.name, cell.cellRef, event.target.value)}
                                      className={modern ? 'w-full rounded-sg-sm border border-sg-amber/30 bg-sg-surface px-1 py-1 text-xs font-medium text-sg-text outline-none focus:border-sg-accent' : 'w-full border border-amber-300 bg-white px-1 py-1 text-xs font-bold text-brand-900 outline-none focus:border-sky-500'}
                                    />
                                  )
                                ) : (
                                  <span className={cell.formula ? (modern ? 'text-sg-text-soft' : 'text-brand-500') : ''}>{cell.value || ' '}</span>
                                )}
                                {error ? <span className="mt-1 block font-sans text-[10px] font-semibold leading-4 text-rose-700">{error.message}</span> : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
