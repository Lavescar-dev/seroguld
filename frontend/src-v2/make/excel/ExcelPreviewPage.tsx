import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileSpreadsheet, Save, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';

import { t, useLocale, type Locale } from '@/lib/locale';
import { useToast } from '@/lib/toast';
import type { DocumentArtifactPreview, DocumentArtifactReconcilePreview } from '@/types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

export interface ExcelPreviewPageProps {
  kind: string;
  artifactKey: string;
  preview: DocumentArtifactPreview | null;
  workbook: ExcelWorkbookPreview | null;
  isLoading: boolean;
  isError: boolean;
  isEditable: boolean;
  dirtyCount: number;
  reconcilePreview: DocumentArtifactReconcilePreview | null;
  isPreviewingChanges: boolean;
  isApplyingChanges: boolean;
  isImporting: boolean;
  pendingImportFileName: string | null;
  useNativeImportDialog: boolean;
  onExport: () => void;
  onImportFromDialog: () => void;
  onImportFile: (file: File) => void;
  onCellChange: (sheetName: string, cellRef: string, value: string) => void;
  onPreviewChanges: () => void;
  onApplyChanges: () => void;
  onCancelPreview: () => void;
}

export interface ExcelWorkbookCellPreview {
  cellRef: string;
  value: string;
  editable?: boolean;
  inputKind?: string;
  label?: string;
  colSpan?: number;
  rowSpan?: number;
}

export interface ExcelWorkbookSheetPreview {
  name: string;
  columns: string[];
  rows: Array<Array<ExcelWorkbookCellPreview | null>>;
}

export interface ExcelWorkbookPreview {
  sheets: ExcelWorkbookSheetPreview[];
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(document.documentElement.lang);
}

function formatVersionKind(value?: string | null, locale?: Locale) {
  if (!value) return t('workbook.version.ready', locale);
  if (value === 'draft') return t('workbook.version.draft', locale);
  if (value === 'final') return t('workbook.version.final', locale);
  if (value === 'live') return t('workbook.version.live', locale);
  if (value === 'snapshot') return t('workbook.version.snapshot', locale);
  return value;
}

function formatKindLabel(kind: string, locale?: Locale) {
  if (kind === 'depolama') return t('workbook.kind.inventory', locale);
  if (kind === 'log') return t('workbook.kind.log', locale);
  if (kind === 'alis-workspace') return t('workbook.kind.draft', locale);
  if (kind === 'alis-document') return t('workbook.kind.document', locale);
  return t('workbook.kind.fallback', locale);
}

function formatModuleLabel(route?: string | null) {
  if (!route) return 'Modül';
  if (route === '/') return 'Alış';
  if (route === '/depolama') return 'Depolama';
  if (route === '/log') return 'Log Sistemi';
  return route;
}

export function MakeExcelPreviewPage({
  kind,
  artifactKey,
  preview,
  workbook,
  isLoading,
  isError,
  isEditable,
  dirtyCount,
  reconcilePreview,
  isPreviewingChanges,
  isApplyingChanges,
  isImporting,
  pendingImportFileName,
  useNativeImportDialog,
  onExport,
  onImportFromDialog,
  onImportFile,
  onCellChange,
  onPreviewChanges,
  onApplyChanges,
  onCancelPreview,
}: ExcelPreviewPageProps) {
  const locale = useLocale();
  const toast = useToast();
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sheets = workbook?.sheets || [];

  const activeSheet = useMemo(
    () => sheets[Math.min(activeSheetIndex, Math.max(sheets.length - 1, 0))] || null,
    [activeSheetIndex, sheets],
  );
  const rowCount = activeSheet?.rows.length || 0;
  const moduleLabel = formatModuleLabel(preview?.module_route);
  const versionLabel = formatVersionKind(preview?.artifact?.version_kind, locale);
  const kindLabel = formatKindLabel(kind, locale);
  const previewBlocked = Boolean(
    reconcilePreview
      && (reconcilePreview.editable === false || (reconcilePreview.blocking_errors?.length ?? 0) > 0),
  );

  // Kirli hücreler yalnız React state'inde yaşar; tüm çıkış yollarında
  // (modül linki, tarayıcı yenileme/kapanma) uyarısız kayıp olmasın.
  useEffect(() => {
    if (dirtyCount === 0) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirtyCount]);

  const confirmLeaveWithDirtyEdits = () => {
    if (dirtyCount === 0) return true;
    return window.confirm(
      'Kaydedilmemiş hücre düzenlemeleri var; sayfadan ayrılırsanız bu düzenlemeler silinir. Ayrılmak istiyor musunuz?',
    );
  };

  return (
    <div
      className={`min-h-screen bg-stone-100 text-brand-950 ${dragActive && isEditable ? 'ring-4 ring-inset ring-brand-400' : ''}`}
      style={sansStyle}
      onDragOver={(event) => {
        // Salt-okunur sayfada bile varsayılan davranış engellenir: WebView
        // bırakılan .xlsx dosyasına navigate olup SPA durumunu kaybedemez.
        event.preventDefault();
        if (!isEditable) return;
        setDragActive(true);
      }}
      onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (!isEditable) return;
        const dropped = Array.from(event.dataTransfer?.files || []);
        const file = dropped.find((f) => /\.(xlsx|xlsm)$/i.test(f.name));
        if (file) {
          onImportFile(file);
          return;
        }
        if (dropped.length > 0) {
          // Uzantı uyarısız yutma yerine görünür geri bildirim.
          toast.warning('Yalnız .xlsx ve .xlsm dosyaları içe aktarılabilir.');
        }
      }}
    >
      <div className="border-b border-brand-300 bg-white px-6 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-emerald-700">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {kindLabel}
              </span>
              <span className="inline-flex items-center border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-brand-700">
                {versionLabel}
              </span>
              <span
                className={`inline-flex items-center border px-2 py-1 text-[11px] font-black uppercase tracking-widest ${
                  isEditable ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-brand-300 bg-white text-brand-600'
                }`}
              >
                {isEditable ? t('workbook.editable', locale) : t('workbook.readonly', locale)}
              </span>
              <span className="mono text-xs uppercase tracking-widest text-brand-400" style={monoStyle}>
                {kind} / {artifactKey}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-[0.08em] text-brand-950">{preview?.title || 'Excel Önizleme'}</h1>
            <p className="mt-1 text-sm text-brand-600">{preview?.subtitle || 'Workbook önizlemesi hazırlanıyor.'}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {preview?.module_route ? (
              <Link
                to={preview.module_route}
                onClick={(event) => {
                  if (!confirmLeaveWithDirtyEdits()) event.preventDefault();
                }}
                className="inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {moduleLabel} Ekranına Dön
              </Link>
            ) : null}
            {isEditable ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (useNativeImportDialog) {
                      onImportFromDialog();
                      return;
                    }
                    importInputRef.current?.click();
                  }}
                  disabled={isImporting || isPreviewingChanges || isApplyingChanges}
                  className="inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {isImporting ? 'İçe aktarılıyor…' : 'İçe Aktar'}
                </button>
                <button
                  type="button"
                  onClick={onPreviewChanges}
                  disabled={dirtyCount === 0 || isPreviewingChanges || isApplyingChanges}
                  className="inline-flex items-center gap-2 border border-amber-400 bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Değişiklikleri Önizle
                </button>
                <button
                  type="button"
                  onClick={onApplyChanges}
                  disabled={!reconcilePreview?.changes.length || isApplyingChanges || previewBlocked}
                  title={previewBlocked ? 'Bu önizleme uygulanabilir durumda değil (yetki veya engelleyici hata).' : undefined}
                  className="inline-flex items-center gap-2 border border-emerald-800 bg-emerald-800 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Uygula
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={onExport}
              disabled={!preview}
              className="inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {t('workbook.export', locale)}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImportFile(file);
                }
                event.currentTarget.value = '';
              }}
            />
          </div>
        </div>

        {preview?.artifact ? (
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div className="border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Dosya</p>
              <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{preview.artifact.file_name}</p>
            </div>
            <div className="border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Versiyon</p>
              <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{versionLabel}</p>
            </div>
            <div className="border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Template</p>
              <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{preview.artifact.template_name || '—'}</p>
            </div>
            <div className="border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Güncellendi</p>
              <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{formatDateTime(preview.artifact.updated_at)}</p>
            </div>
            <div className="border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Modül</p>
              <p className="mt-1 text-sm font-bold text-brand-900">{moduleLabel}</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="px-6 py-5">
        {isLoading ? (
          <div className="border border-brand-200 bg-white px-6 py-12 text-center text-sm font-medium text-brand-600">
            {t('workbook.loading', locale)}
          </div>
        ) : isError || !preview ? (
          <div className="border border-rose-200 bg-rose-50 px-6 py-12 text-center text-sm font-medium text-rose-700">
            {t('workbook.error', locale)}
          </div>
        ) : (
          <div className="space-y-4">
            {isEditable ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Draft Workbook Düzenleme</p>
                  <p className="mt-1 text-sm text-amber-900">Sadece iş alanları düzenlenir. Formül ve sabit referans hücreleri korunur.</p>
                </div>
                <span className="border border-amber-300 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-widest text-amber-800">
                  {dirtyCount} {t('workbook.dirty', locale)}
                </span>
              </div>
            ) : null}

            {reconcilePreview ? (
              <div className="border border-brand-300 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-200 bg-brand-50 px-4 py-3">
                  <h2 className="text-sm font-black uppercase tracking-widest text-brand-800">Diff Önizleme</h2>
                  <div className="flex items-center gap-2">
                    <span className="border border-brand-200 bg-white px-2 py-1 text-[11px] font-bold text-brand-600">
                      {pendingImportFileName
                        ? `İçe aktarılan dosya: ${pendingImportFileName}`
                        : 'Kaynak: hücre düzenlemeleri'}
                    </span>
                    <button
                      type="button"
                      onClick={onCancelPreview}
                      className="border border-brand-300 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
                    >
                      {t('workbook.cancel', locale)}
                    </button>
                  </div>
                </div>
                {previewBlocked ? (
                  <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                    Bu değişiklik seti şu anda uygulanamıyor
                    {(reconcilePreview.blocking_errors?.length ?? 0) > 0
                      ? `: ${reconcilePreview.blocking_errors!.join(' ')}`
                      : ' (belge düzenlenebilir durumda değil).'}
                  </div>
                ) : null}
                <div className="space-y-3 px-4 py-4">
                  {reconcilePreview.warnings.map((warning) => (
                    <div key={warning} className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {warning}
                    </div>
                  ))}
                  {reconcilePreview.changes.length > 0 ? (
                    <div className="space-y-2">
                      {reconcilePreview.changes.map((change) => (
                        <div key={`${change.sheet}-${change.cell_ref}`} className="grid gap-2 border border-brand-200 bg-stone-50 px-3 py-3 md:grid-cols-[180px,1fr,1fr]">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">{change.cell_ref}</p>
                            <p className="mt-1 text-sm font-bold text-brand-900">{change.label}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-400">Eski</p>
                            <p className="mono mt-1 text-sm text-brand-700" style={monoStyle}>{change.old_value || '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-400">Yeni</p>
                            <p className="mono mt-1 text-sm font-bold text-emerald-800" style={monoStyle}>{change.new_value || '—'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border border-brand-200 bg-brand-50 px-4 py-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Aktif Sheet</p>
                <p className="mt-1 text-sm font-bold text-brand-900">{activeSheet?.name || 'Sheet yok'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="border border-brand-300 bg-white px-2 py-1 text-[11px] font-black uppercase tracking-widest text-brand-600">
                  {sheets.length} {t('workbook.sheet', locale)}
                </span>
                <span className="border border-brand-300 bg-white px-2 py-1 text-[11px] font-black uppercase tracking-widest text-brand-600">
                  {rowCount} {t('workbook.rows', locale)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {sheets.map((sheet, index) => (
                <button
                  key={sheet.name}
                  type="button"
                  onClick={() => setActiveSheetIndex(index)}
                  className={`border px-4 py-2 text-xs font-black uppercase tracking-widest transition ${
                    index === activeSheetIndex
                      ? 'border-brand-900 bg-brand-900 text-white'
                      : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50'
                  }`}
                >
                  {sheet.name}
                </button>
              ))}
            </div>

            {activeSheet ? (
              <div className="overflow-hidden border border-brand-300 bg-white shadow-sm">
                <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                  <h2 className="text-sm font-black uppercase tracking-widest text-brand-800">{activeSheet.name}</h2>
                  <p className="mt-1 text-sm text-brand-600">Gerçek workbook aralığı popup içinde okunuyor.</p>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="sticky left-0 top-0 z-header border-b border-r border-brand-300 bg-stone-200 px-3 py-2 text-center text-[11px] font-black uppercase tracking-widest text-brand-700">
                          #
                        </th>
                        {activeSheet.columns.map((column) => (
                          <th
                            key={column}
                            className="sticky top-0 z-sticky border-b border-r border-brand-300 bg-stone-200 px-3 py-2 text-center text-[11px] font-black uppercase tracking-widest text-brand-700 last:border-r-0"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeSheet.rows.map((row, rowIndex) => (
                        <tr key={`${activeSheet.name}-${rowIndex}`} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                          <th className="sticky left-0 z-sticky border-b border-r border-brand-300 bg-stone-100 px-3 py-2 text-center text-[11px] font-black text-brand-600">
                            {rowIndex + 1}
                          </th>
                          {row.map((cell, columnIndex) => {
                            if (!cell) {
                              return null;
                            }

                            return (
                              <td
                                key={`${rowIndex}-${columnIndex}`}
                                colSpan={cell.colSpan}
                                rowSpan={cell.rowSpan}
                                className={`border-r border-b border-brand-200 px-2 py-1.5 text-sm text-brand-900 last:border-r-0 ${
                                  cell.editable ? 'bg-amber-50' : ''
                                }`}
                                style={monoStyle}
                                title={cell.label || cell.cellRef}
                              >
                                {cell.editable && isEditable ? (
                                  cell.inputKind === 'payment_method' ? (
                                    <select
                                      aria-label={cell.label || cell.cellRef}
                                      value={cell.value}
                                      onChange={(event) => onCellChange(activeSheet.name, cell.cellRef, event.target.value)}
                                      className="w-full border-0 bg-transparent px-1 py-0.5 text-sm font-bold text-brand-900 outline-none"
                                    >
                                      <option value="Kontant">{t('workbook.payment.cash', locale)}</option>
                                      <option value="Overførsel">{t('workbook.payment.bank', locale)}</option>
                                    </select>
                                  ) : (
                                    <input
                                      aria-label={cell.label || cell.cellRef}
                                      value={cell.value}
                                      onChange={(event) => onCellChange(activeSheet.name, cell.cellRef, event.target.value)}
                                      className="w-full border-0 bg-transparent px-1 py-0.5 text-sm font-bold text-brand-900 outline-none"
                                    />
                                  )
                                ) : (
                                  cell.value || ' '
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="border border-brand-200 bg-white px-6 py-12 text-center text-sm font-medium text-brand-600">
                {t('workbook.noSheets', locale)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
