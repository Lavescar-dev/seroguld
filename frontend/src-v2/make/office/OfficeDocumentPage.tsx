import { useRef, useState, type RefObject } from 'react';
import { Download, ExternalLink, FileSpreadsheet, RefreshCw, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DesktopRuntimeInfo } from '@/lib/desktop';
import { formatRuntimeDateTime, formatRuntimeLabel, type FrontendRuntimeInfo } from '@/lib/runtimeInfo';
import type {
  DocumentArtifactReconcilePreview,
  OfficeDocumentLaunch,
  OfficeDocumentStatus,
  OfficeRuntimeStatus,
  RuntimeStatus,
} from '@/types';

import { OnlyOfficeEditor } from './OnlyOfficeEditor';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

export interface OfficeDocumentPageProps {
  kind: string;
  artifactKey: string;
  launch: OfficeDocumentLaunch | null;
  status: OfficeDocumentStatus | null;
  runtimeStatus: OfficeRuntimeStatus | null;
  appRuntimeStatus: RuntimeStatus | null;
  desktopRuntime: DesktopRuntimeInfo | null;
  frontendRuntime: FrontendRuntimeInfo;
  runtimeWarnings: string[];
  iframeName: string;
  formRef: RefObject<HTMLFormElement>;
  useNativeImportDialog: boolean;
  isLoading: boolean;
  isError: boolean;
  isImporting: boolean;
  isStatusRefreshing: boolean;
  isSessionRefreshing: boolean;
  isIframeLoading: boolean;
  hasIframeLoadTimedOut: boolean;
  launchRequestMs: number | null;
  iframeLoadMs: number | null;
  sessionRefreshMs: number | null;
  isSessionStale: boolean;
  canReopenWindow: boolean;
  hasExternalUpdate: boolean;
  lastImportError: string | null;
  lastExportNotice: string | null;
  lastExportError: string | null;
  lastEditorError: string | null;
  importReconcilePreview?: DocumentArtifactReconcilePreview | null;
  pendingImportFileName?: string | null;
  isPreviewingImport?: boolean;
  isLivePreviewDirty?: boolean;
  isLivePreviewSyncing?: boolean;
  lastLivePreviewError?: string | null;
  onRetryLivePreviewSync?: () => void;
  onExport: () => void;
  onImportFromDialog: () => void;
  onImportFile: (file: File) => void;
  onApplyImportPreview?: () => void;
  onCancelImportPreview?: () => void;
  onRefreshStatus: () => void;
  onRefreshSession: () => void;
  onReopenWindow: () => void | Promise<void>;
  onIframeLoad: () => void;
  onEditorError: (message: string) => void;
  onEditorDirtyStateChange?: (dirty: boolean) => void;
  layoutMode?: 'page' | 'dock' | 'workspace';
  onClose?: () => void;
}

function formatVersionKind(value?: string | null) {
  if (!value) return 'Hazır';
  if (value === 'draft') return 'Taslak';
  if (value === 'final') return 'Final';
  if (value === 'live') return 'Canlı';
  return value;
}

function formatKindLabel(kind: string) {
  if (kind === 'alis-workspace') return 'AFG Çalışma Dosyası';
  if (kind === 'alis-document') return 'AFG Belgesi';
  if (kind === 'depolama') return 'Depolama Workbook';
  if (kind === 'log') return 'Log Workbook';
  return 'Office Belgesi';
}

function formatSheetMode(mode: string) {
  if (mode === 'editable') return 'Controlled Input';
  if (mode === 'readonly') return 'Salt Okunur';
  if (mode === 'static') return 'Static';
  return 'Derived';
}

function formatBrandingLevel(level?: string | null) {
  if (!level) return 'Unknown';
  if (level === 'vendor-dev-branding') return 'Vendor Dev Branding';
  return level.replace(/[_-]+/g, ' ');
}

function formatDuration(value: number | null) {
  if (value == null) return '—';
  return `${value} ms`;
}

function gateTone(value: number | null, targetMs: number) {
  if (value == null) return 'border-brand-200 bg-white text-brand-700';
  return value <= targetMs
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
    : 'border-amber-300 bg-amber-50 text-amber-800';
}

export function MakeOfficeDocumentPage({
  kind,
  artifactKey,
  launch,
  status,
  runtimeStatus,
  appRuntimeStatus,
  desktopRuntime,
  frontendRuntime,
  runtimeWarnings,
  iframeName,
  formRef,
  useNativeImportDialog,
  isLoading,
  isError,
  isImporting,
  isStatusRefreshing,
  isSessionRefreshing,
  isIframeLoading,
  hasIframeLoadTimedOut,
  launchRequestMs,
  iframeLoadMs,
  sessionRefreshMs,
  isSessionStale,
  canReopenWindow,
  hasExternalUpdate,
  lastImportError,
  lastExportNotice,
  lastExportError,
  lastEditorError,
  importReconcilePreview = null,
  pendingImportFileName = null,
  isPreviewingImport = false,
  isLivePreviewDirty = false,
  isLivePreviewSyncing = false,
  lastLivePreviewError = null,
  onRetryLivePreviewSync,
  onExport,
  onImportFromDialog,
  onImportFile,
  onApplyImportPreview,
  onCancelImportPreview,
  onRefreshStatus,
  onRefreshSession,
  onReopenWindow,
  onIframeLoad,
  onEditorError,
  onEditorDirtyStateChange,
  layoutMode = 'page',
  onClose,
}: OfficeDocumentPageProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isDocked = layoutMode === 'dock';
  const isWorkspaceEmbedded = layoutMode === 'workspace';
  const isCompactLayout = isDocked || isWorkspaceEmbedded;
  const iconSizeClass = isWorkspaceEmbedded ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const headerPaddingClass = isWorkspaceEmbedded ? 'px-3 py-3' : isCompactLayout ? 'px-4 py-4' : 'px-6 py-4';
  const bodyPaddingClass = isWorkspaceEmbedded
    ? 'min-h-0 flex-1 overflow-hidden px-3 py-3'
    : isCompactLayout
      ? 'min-h-0 flex-1 overflow-hidden px-4 py-4'
      : 'px-6 py-5';
  const secondaryButtonClass = isWorkspaceEmbedded
    ? 'inline-flex items-center gap-1.5 border border-brand-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50'
    : 'inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50';
  const amberButtonClass = isWorkspaceEmbedded
    ? 'inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-100'
    : 'inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-100';
  const exportButtonClass = isWorkspaceEmbedded
    ? 'inline-flex items-center gap-1.5 border border-brand-900 bg-brand-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50'
    : 'inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50';
  const compactBadgeClass = isWorkspaceEmbedded
    ? 'border border-brand-200 bg-white px-2 py-0.5 font-black uppercase tracking-widest text-brand-700'
    : 'border border-brand-200 bg-white px-2 py-1 font-black uppercase tracking-widest text-brand-700';
  const compactStatusClass = isWorkspaceEmbedded ? 'mt-2 flex flex-wrap items-center gap-1.5 text-[10px]' : 'mt-4 flex flex-wrap items-center gap-2 text-[11px]';
  const editorHeaderPaddingClass = isWorkspaceEmbedded ? 'px-3 py-2' : 'px-4 py-3';
  const artifact = status?.artifact || launch?.artifact || null;
  const versionLabel = formatVersionKind(artifact?.version_kind);
  const kindLabel = formatKindLabel(kind);
  const contractVersion = status?.contract_version || launch?.contract_version || '1';
  const provider = runtimeStatus?.provider || status?.provider || launch?.provider || 'unknown';
  const providerLabel = runtimeStatus?.provider_label || status?.provider_label || launch?.provider_label || 'Unknown Provider';
  const providerBrandingLevel =
    runtimeStatus?.provider_branding_level || status?.provider_branding_level || launch?.provider_branding_level || 'unknown';
  const officeRuntimeAvailable = status?.office_available ?? launch?.office_available ?? false;
  const effectiveCanWrite = launch?.can_write ?? status?.can_write ?? false;
  const displayTitle = launch?.title || artifact?.file_name || 'Office Belgesi';
  const editorStatusText = hasIframeLoadTimedOut
    ? 'Office editor beklenenden uzun sürdü. Oturumu yenilemek veya pencereyi yeniden açmak daha güvenli olabilir.'
    : isIframeLoading
      ? 'Office document session yukleniyor. Ilk acilis sirasinda birkac saniye surebilir.'
      : isDocked
        ? 'Gercek workbook ayni ekran icindeki office dock alaninda aciliyor.'
        : isWorkspaceEmbedded
          ? 'Gercek workbook bu aktif calisma alani icinde aciliyor.'
        : 'Gercek workbook office popup icinde aciliyor.';
  const contractDescription =
    kind === 'alis-workspace' || kind === 'alis-document'
      ? 'AFG runtime 5 sheet’i birlikte taşır; yalnız controlled input sheet’ler domain’e işlenir.'
      : kind === 'depolama'
        ? 'Depolama workbook save/import akışı yalnız kontrollü market price ve mevcut stok satırı alanlarını sisteme yazar.'
        : kind === 'log'
          ? 'Log workbook’ta Ark1 üstündeki route ve melt alanları sisteme yazılır; derived rapor blokları mirror olarak korunur.'
          : 'Office popup backend contract sheet’lerini ve modlarını görünür tutar.';
  const editorSurfaceClass = isCompactLayout ? 'h-full min-h-0 w-full bg-white' : 'h-[calc(100vh-18rem)] min-h-[640px] w-full bg-white';
  const shouldUseSessionRefresh = hasIframeLoadTimedOut || isSessionStale || hasExternalUpdate || Boolean(lastEditorError);
  const shouldTrackLivePreview =
    isWorkspaceEmbedded && kind === 'alis-workspace' && launch?.provider === 'onlyoffice' && Boolean(launch?.can_write);
  const livePreviewBadge = !shouldTrackLivePreview
    ? null
    : lastLivePreviewError
      ? 'Canlı önizleme hatası'
      : isLivePreviewSyncing
        ? 'Canlı önizleme senkronlanıyor'
        : isLivePreviewDirty
          ? 'Canlı önizleme bekliyor'
          : null;
  const handlePrimaryRefresh = () => {
    if (shouldUseSessionRefresh) {
      onRefreshSession();
      return;
    }
    onRefreshStatus();
  };
  const isPrimaryRefreshBusy = shouldUseSessionRefresh ? isSessionRefreshing : isStatusRefreshing;
  const primaryRefreshLabel = 'Yenile';
  const compactStatusBadges = [
    isIframeLoading ? 'Yükleniyor' : null,
    hasIframeLoadTimedOut ? 'Yükleme gecikti' : null,
    hasExternalUpdate ? 'Dış güncelleme' : null,
    isSessionStale ? 'Oturum eski' : null,
  ].filter(Boolean) as string[];
  const importBlockingErrors = importReconcilePreview?.blocking_errors || [];
  const canApplyImportPreview =
    Boolean(importReconcilePreview?.editable) &&
    importBlockingErrors.length === 0 &&
    !isImporting &&
    !isPreviewingImport &&
    Boolean(onApplyImportPreview);

  return (
    <div
      className={isCompactLayout ? 'flex h-full min-h-0 flex-col bg-stone-100 text-brand-950' : 'min-h-screen bg-stone-100 text-brand-950'}
      style={sansStyle}
    >
      <div className={`relative border-b border-brand-300 bg-white shadow-sm ${headerPaddingClass}`}>
        {isDocked && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center border border-rose-300 bg-rose-50 text-rose-700 transition hover:border-rose-400 hover:bg-rose-100 hover:text-rose-800"
            title="Dock'u kapat"
            aria-label="Dock'u kapat"
          >
            <X className={isWorkspaceEmbedded ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </button>
        ) : null}
        <div className={`flex flex-wrap items-start justify-between ${isWorkspaceEmbedded ? 'gap-3' : 'gap-4'}`}>
          <div className={`min-w-0 ${isDocked ? 'pr-12' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-emerald-700">
                <FileSpreadsheet className={iconSizeClass} />
                {kindLabel}
              </span>
              <span className="inline-flex items-center border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-brand-700">
                {versionLabel}
              </span>
              <span
                className={`inline-flex items-center border px-2 py-1 text-[11px] font-black uppercase tracking-widest ${
                  effectiveCanWrite ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-brand-300 bg-white text-brand-600'
                }`}
              >
                {effectiveCanWrite ? 'Editable Office' : 'Salt okunur'}
              </span>
              {!isCompactLayout ? (
                <>
                  <span className="inline-flex items-center border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-sky-800">
                    Ayrı Pencere
                  </span>
                  <span className="mono text-xs uppercase tracking-widest text-brand-400" style={monoStyle}>
                    {kind} / {artifactKey}
                  </span>
                </>
              ) : null}
            </div>
            <h1
              className={`font-black text-brand-950 ${
                isWorkspaceEmbedded
                  ? 'mt-1 text-base tracking-[0.04em]'
                  : isCompactLayout
                    ? 'mt-2 text-lg tracking-[0.05em]'
                    : 'mt-3 text-2xl tracking-[0.08em]'
              }`}
            >
              {displayTitle}
            </h1>
            {isCompactLayout ? (
              <div className={`mt-1 flex flex-wrap items-center text-brand-500 ${isWorkspaceEmbedded ? 'gap-1.5 text-[10px]' : 'gap-2 text-xs'}`}>
                {artifact?.file_name ? (
                  <span
                    className={`mono border border-brand-200 bg-brand-50 text-brand-700 ${isWorkspaceEmbedded ? 'max-w-[11rem] truncate px-2 py-0.5 text-[10px]' : 'px-2 py-1 text-[10px]'}`}
                    style={monoStyle}
                  >
                    {artifact.file_name}
                  </span>
                ) : null}
                {launch?.subtitle ? <span>{launch.subtitle}</span> : null}
              </div>
            ) : (
              <p className="mt-1 text-sm text-brand-600">
                {launch?.subtitle || 'Gerçek workbook office popup içinde açılıyor.'}
              </p>
            )}
          </div>

          <div className={`flex flex-wrap items-center ${isWorkspaceEmbedded ? 'gap-1.5' : 'gap-2'} ${isDocked ? 'max-w-[calc(100%-3.5rem)] pr-12' : ''}`}>
            {!isCompactLayout && launch?.module_route ? (
              <Link
                to={launch.module_route}
                className={secondaryButtonClass}
              >
                <ExternalLink className={iconSizeClass} />
                İlgili Modüle Dön
              </Link>
            ) : null}
            {launch?.import_supported ? (
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
                  className={secondaryButtonClass}
                >
                  <Upload className={iconSizeClass} />
                  İçe Aktar
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
              </>
            ) : null}
            <button
              type="button"
              onClick={isCompactLayout ? handlePrimaryRefresh : onRefreshStatus}
              className={secondaryButtonClass}
            >
              <RefreshCw className={`${iconSizeClass} ${(isCompactLayout ? isPrimaryRefreshBusy : isStatusRefreshing) ? 'animate-spin' : ''}`} />
              {isCompactLayout ? primaryRefreshLabel : 'Veriyi Tazele'}
            </button>
            {!isCompactLayout ? (
              <button
                type="button"
                onClick={onRefreshSession}
                className={amberButtonClass}
              >
                <RefreshCw className={`${iconSizeClass} ${isSessionRefreshing ? 'animate-spin' : ''}`} />
                Office Oturumunu Yenile
              </button>
            ) : null}
            {!isCompactLayout && canReopenWindow ? (
              <button
                type="button"
                onClick={onReopenWindow}
                className={
                  isWorkspaceEmbedded
                    ? 'inline-flex items-center gap-1.5 border border-sky-300 bg-sky-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-sky-800 transition hover:bg-sky-100'
                    : 'inline-flex items-center gap-2 border border-sky-300 bg-sky-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-sky-800 transition hover:bg-sky-100'
                }
              >
                <RefreshCw className={iconSizeClass} />
                Pencereyi Yeniden Aç
              </button>
            ) : null}
            {isCompactLayout ? (
              <button
                type="button"
                onClick={() => setShowAdvanced((current) => !current)}
                className={secondaryButtonClass}
              >
                {showAdvanced ? 'Gelişmişi Gizle' : 'Gelişmiş'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onExport}
              disabled={!launch}
              className={exportButtonClass}
            >
              <Download className={iconSizeClass} />
              Dışa Aktar
            </button>
            {!isCompactLayout && launch?.fallback_route ? (
              <Link
                to={launch.fallback_route}
                className={secondaryButtonClass}
              >
                Yapısal Önizleme
              </Link>
            ) : null}
          </div>
        </div>

        {isCompactLayout ? (
          <div className={compactStatusClass}>
            {compactStatusBadges.map((badge) => (
              <span key={badge} className={compactBadgeClass}>
                {badge}
              </span>
            ))}
            {isImporting ? (
              <span className={isWorkspaceEmbedded ? 'border border-amber-300 bg-amber-50 px-2 py-0.5 font-black uppercase tracking-widest text-amber-800' : 'border border-amber-300 bg-amber-50 px-2 py-1 font-black uppercase tracking-widest text-amber-800'}>
                İçe aktarılıyor
              </span>
            ) : null}
            {isPreviewingImport ? (
              <span className={isWorkspaceEmbedded ? 'border border-sky-300 bg-sky-50 px-2 py-0.5 font-black uppercase tracking-widest text-sky-800' : 'border border-sky-300 bg-sky-50 px-2 py-1 font-black uppercase tracking-widest text-sky-800'}>
                Önizleme hazırlanıyor
              </span>
            ) : null}
            {lastEditorError ? (
              <span className={isWorkspaceEmbedded ? 'border border-rose-300 bg-rose-50 px-2 py-0.5 font-black uppercase tracking-widest text-rose-700' : 'border border-rose-300 bg-rose-50 px-2 py-1 font-black uppercase tracking-widest text-rose-700'}>
                Editör hatası
              </span>
            ) : null}
            {livePreviewBadge ? (
              <span
                title={lastLivePreviewError || undefined}
                className={
                  lastLivePreviewError
                    ? isWorkspaceEmbedded
                      ? 'border border-rose-300 bg-rose-50 px-2 py-0.5 font-black uppercase tracking-widest text-rose-700'
                      : 'border border-rose-300 bg-rose-50 px-2 py-1 font-black uppercase tracking-widest text-rose-700'
                    : isLivePreviewSyncing
                      ? isWorkspaceEmbedded
                        ? 'border border-sky-300 bg-sky-50 px-2 py-0.5 font-black uppercase tracking-widest text-sky-800'
                        : 'border border-sky-300 bg-sky-50 px-2 py-1 font-black uppercase tracking-widest text-sky-800'
                      : isWorkspaceEmbedded
                        ? 'border border-amber-300 bg-amber-50 px-2 py-0.5 font-black uppercase tracking-widest text-amber-800'
                        : 'border border-amber-300 bg-amber-50 px-2 py-1 font-black uppercase tracking-widest text-amber-800'
                }
              >
                {livePreviewBadge}
              </span>
            ) : null}
            {lastLivePreviewError && onRetryLivePreviewSync ? (
              <button
                type="button"
                onClick={onRetryLivePreviewSync}
                className={
                  isWorkspaceEmbedded
                    ? 'inline-flex items-center gap-1 border border-rose-300 bg-white px-2 py-0.5 font-black uppercase tracking-widest text-rose-700 transition hover:bg-rose-50'
                    : 'inline-flex items-center gap-1.5 border border-rose-300 bg-white px-2 py-1 font-black uppercase tracking-widest text-rose-700 transition hover:bg-rose-50'
                }
              >
                Tekrar senkronla
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {artifact ? (
              <div className="mt-4 grid gap-3 md:grid-cols-5">
                <div className="border border-brand-200 bg-brand-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Dosya</p>
                  <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{artifact.file_name}</p>
                </div>
                <div className="border border-brand-200 bg-brand-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Versiyon</p>
                  <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{versionLabel}</p>
                </div>
                <div className="border border-brand-200 bg-brand-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Template</p>
                  <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{artifact.template_name || '—'}</p>
                </div>
                <div className="border border-brand-200 bg-brand-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Güncellendi</p>
                  <p className="mono mt-1 text-sm font-bold text-brand-900" style={monoStyle}>{formatRuntimeDateTime(artifact.updated_at)}</p>
                </div>
                <div className="border border-brand-200 bg-brand-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Office Runtime</p>
                  <p className="mt-1 text-sm font-bold text-brand-900">
                    {status?.office_available ?? launch?.office_available ? providerLabel : 'Fallback'}
                  </p>
                  <p className="mono mt-1 text-[10px] text-brand-500" style={monoStyle}>{provider}</p>
                </div>
              </div>
            ) : null}

            {runtimeStatus ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                    runtimeStatus.runtime_available
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-rose-300 bg-rose-50 text-rose-700'
                  }`}
                >
                  {runtimeStatus.runtime_available ? 'Runtime Hazır' : 'Runtime Ulaşılamıyor'}
                </span>
                <span className="border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-600">
                  Discovery {runtimeStatus.discovery_cached ? 'Warm Cache' : 'Cold Start'}
                </span>
                <span className="border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-600">
                  {providerLabel}
                </span>
                <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                  {formatBrandingLevel(providerBrandingLevel)}
                </span>
                <span className="mono border border-brand-200 bg-white px-2 py-1 text-[10px] text-brand-500" style={monoStyle}>
                  {runtimeStatus.runtime_url}
                </span>
                {runtimeStatus.last_discovery_checked_at ? (
                  <span className="mono text-[10px] text-brand-400" style={monoStyle}>
                    Son kontrol: {formatRuntimeDateTime(runtimeStatus.last_discovery_checked_at)}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className={`border px-3 py-2 ${gateTone(launchRequestMs, 4000)}`}>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Cold Open</p>
                <p className="mt-1 text-sm font-bold">{formatDuration(launchRequestMs)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest opacity-70">Hedef ≤ 4000 ms</p>
              </div>
              <div className={`border px-3 py-2 ${gateTone(iframeLoadMs, 4000)}`}>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Iframe First Load</p>
                <p className="mt-1 text-sm font-bold">{formatDuration(iframeLoadMs)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest opacity-70">Hedef ≤ 4000 ms</p>
              </div>
              <div className={`border px-3 py-2 ${gateTone(sessionRefreshMs, 2000)}`}>
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Session Refresh</p>
                <p className="mt-1 text-sm font-bold">{formatDuration(sessionRefreshMs)}</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest opacity-70">Hedef ≤ 2000 ms</p>
              </div>
              <div className="border border-brand-200 bg-white px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Provider Kararı</p>
                <p className="mt-1 text-sm font-bold text-brand-900">{providerLabel}</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-brand-500">
                  Branding: {formatBrandingLevel(providerBrandingLevel)}
                </p>
              </div>
            </div>

            {providerBrandingLevel === 'vendor-dev-branding' ? (
              <div className="mt-3 border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Provider Branding</p>
                <p className="mt-1 text-sm text-amber-900">
                  Bu embedded office engine vendor development branding taşıyor. Performans ve UX hedeflerini geçemezse bir sonraki aday
                  ONLYOFFICE Community olacak.
                </p>
              </div>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="border border-brand-200 bg-white px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Frontend</p>
                <p className="mt-1 text-sm font-bold text-brand-900">{formatRuntimeLabel(frontendRuntime.frontend_mode)}</p>
                <p className="mono mt-1 text-[10px] text-brand-500" style={monoStyle}>
                  {formatRuntimeDateTime(frontendRuntime.frontend_built_at)}
                </p>
              </div>
              <div className="border border-brand-200 bg-white px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Desktop</p>
                <p className="mt-1 text-sm font-bold text-brand-900">
                  {desktopRuntime ? formatRuntimeLabel(desktopRuntime.runtime_mode) : 'Web / Yok'}
                </p>
                <p className="mono mt-1 text-[10px] text-brand-500" style={monoStyle}>
                  {desktopRuntime?.binary_mtime_unix_ms ? formatRuntimeDateTime(desktopRuntime.binary_mtime_unix_ms) : 'Binary zamanı yok'}
                </p>
              </div>
              <div className="border border-brand-200 bg-white px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Backend</p>
                <p className="mt-1 text-sm font-bold text-brand-900">
                  {appRuntimeStatus ? formatRuntimeDateTime(appRuntimeStatus.backend_started_at) : 'Yok'}
                </p>
                <p className="mono mt-1 text-[10px] text-brand-500" style={monoStyle}>
                  {appRuntimeStatus?.backend_url || 'Bağlantı yok'}
                </p>
              </div>
              <div className="border border-brand-200 bg-white px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Session</p>
                <p className="mt-1 text-sm font-bold text-brand-900">
                  {appRuntimeStatus?.desktop_session ? formatRuntimeLabel(appRuntimeStatus.desktop_session.mode) : 'Kayıt yok'}
                </p>
                <p className="mono mt-1 text-[10px] text-brand-500" style={monoStyle}>
                  {appRuntimeStatus?.desktop_session
                    ? formatRuntimeDateTime(appRuntimeStatus.desktop_session.started_at)
                    : 'desktop-dev session yok'}
                </p>
              </div>
            </div>

            {runtimeWarnings.length > 0 ? (
              <div className="mt-3 space-y-2 border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Runtime Uyarısı</p>
                {runtimeWarnings.map((warning) => (
                  <p key={warning} className="text-sm text-amber-900">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className={bodyPaddingClass}>
        {isLoading ? (
          <div className="border border-brand-200 bg-white px-6 py-12 text-center text-sm font-medium text-brand-600">
            Office oturumu hazırlanıyor...
          </div>
        ) : isError || !launch ? (
          <div className="space-y-4 border border-rose-200 bg-rose-50 px-6 py-8 text-center text-sm font-medium text-rose-700">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Office Launch Hatası</p>
              <p className="mt-2 text-sm font-medium text-rose-700">Office oturumu başlatılamadı.</p>
              <p className="mt-2 text-xs text-rose-600">
                Runtime kısa süreli düşmüş ya da launch oturumu eski hata durumunda kalmış olabilir.
              </p>
              {runtimeStatus?.reason ? <p className="mt-2 text-xs text-rose-600">{runtimeStatus.reason}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={onRefreshSession}
                className="inline-flex items-center gap-2 border border-amber-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSessionRefreshing ? 'animate-spin' : ''}`} />
                Office Oturumunu Yenile
              </button>
              <button
                type="button"
                onClick={onRefreshStatus}
                className="inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isStatusRefreshing ? 'animate-spin' : ''}`} />
                Veriyi Tazele
              </button>
              {isDocked && onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Dock'u Kapat
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={isCompactLayout ? `flex h-full min-h-0 flex-col ${isWorkspaceEmbedded ? 'gap-3' : 'gap-4'}` : 'space-y-4'}>
            {!isCompactLayout && launch.import_supported ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Office Düzenleme</p>
                  <p className="mt-1 text-sm text-amber-900">
                    Office içindeki save akışı ve içe aktarılan workbook, backend reconcile hattından geçirilir.
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    {kind === 'alis-workspace'
                      ? (
                        <>
                          Sisteme yazılan companion input sheet’ler: <span className="font-black">Afregningsbilag</span>,{' '}
                          <span className="font-black">Faktura guld og sølv</span>, <span className="font-black">Faktura diverse</span> ve{' '}
                          <span className="font-black">Variable værdier</span>. <span className="font-black">Brugsanvisning</span> read-only kalır.
                        </>
                      )
                      : kind === 'depolama'
                        ? 'Yalnız market prices ve mevcut stok satırlarının kontrollü alanları sisteme uygulanır.'
                        : kind === 'log'
                          ? 'Yalnız Log control alanları sisteme uygulanır; rapor sheet derived/read-only kalır.'
                          : 'Yalnız contract tarafından izin verilen alanlar sisteme uygulanır.'}
                  </p>
                </div>
                <span className="border border-amber-300 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-widest text-amber-800">
                  {isImporting ? 'İçe aktarılıyor' : 'Import açık'}
                </span>
              </div>
            ) : null}

            {lastImportError ? (
              <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {lastImportError}
              </div>
            ) : null}

            {lastExportNotice ? (
              <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {lastExportNotice}
              </div>
            ) : null}

            {lastExportError ? (
              <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {lastExportError}
              </div>
            ) : null}

            {lastEditorError ? (
              <div className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {lastEditorError}
              </div>
            ) : null}

            {!isCompactLayout && hasExternalUpdate ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-sky-200 bg-sky-50 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-sky-700">Dış Güncelleme Algılandı</p>
                  <p className="mt-1 text-sm text-sky-900">
                    Bu workbook başka bir yüzeyden güncellendi. Canonical artifact’i görmek için popup’ı yenile.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onRefreshStatus}
                    className="inline-flex items-center gap-2 border border-sky-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-sky-800 transition hover:bg-sky-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Veriyi Tazele
                  </button>
                  <button
                    type="button"
                    onClick={onRefreshSession}
                    className="inline-flex items-center gap-2 border border-amber-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Oturumu Yenile
                  </button>
                </div>
              </div>
            ) : null}

            {isSessionStale && !isWorkspaceEmbedded ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Office Oturumu Eski</p>
                  <p className="mt-1 text-sm text-amber-900">
                    Popup içindeki office session eski artifact sürümüne bakıyor. Bu durumda oturumu yenilemek en güvenli yol.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRefreshSession}
                  className="inline-flex items-center gap-2 border border-amber-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Office Oturumunu Yenile
                </button>
              </div>
            ) : null}

            {isCompactLayout && showAdvanced ? (
              <div className={`border border-brand-200 bg-white ${isWorkspaceEmbedded ? 'space-y-3 px-3 py-3' : 'space-y-4 px-4 py-4'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Gelişmiş</p>
                    <p className="mt-1 text-sm text-brand-700">
                      Contract, runtime ve tanı detayları burada tutulur.
                    </p>
                  </div>
                  {launch?.fallback_route ? (
                    <Link
                      to={launch.fallback_route}
                      className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
                    >
                      Yapısal Önizleme
                    </Link>
                  ) : null}
                </div>

                {launch.import_supported ? (
                  <div className="border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Office Düzenleme</p>
                    <p className="mt-1 text-sm text-amber-900">
                      Office içindeki save akışı ve içe aktarılan workbook, backend reconcile hattından geçirilir.
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      {kind === 'alis-workspace'
                        ? (
                          <>
                            Sisteme yazılan companion input sheet’ler: <span className="font-black">Afregningsbilag</span>,{' '}
                            <span className="font-black">Faktura guld og sølv</span>, <span className="font-black">Faktura diverse</span> ve{' '}
                            <span className="font-black">Variable værdier</span>. <span className="font-black">Brugsanvisning</span> read-only kalır.
                          </>
                        )
                        : kind === 'depolama'
                          ? 'Yalnız market prices ve mevcut stok satırlarının kontrollü alanları sisteme uygulanır.'
                          : kind === 'log'
                            ? 'Yalnız Log control alanları sisteme uygulanır; rapor sheet derived/read-only kalır.'
                            : 'Yalnız contract tarafından izin verilen alanlar sisteme uygulanır.'}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-600">
                    {providerLabel}
                  </span>
                  {runtimeStatus ? (
                    <span
                      className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                        runtimeStatus.runtime_available
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-rose-300 bg-rose-50 text-rose-700'
                      }`}
                    >
                      {runtimeStatus.runtime_available ? 'Runtime Hazır' : 'Runtime Ulaşılamıyor'}
                    </span>
                  ) : null}
                  <span className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${gateTone(launchRequestMs, 4000)}`}>
                    Cold Open {formatDuration(launchRequestMs)}
                  </span>
                  <span className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${gateTone(iframeLoadMs, 4000)}`}>
                    First Load {formatDuration(iframeLoadMs)}
                  </span>
                  <span className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${gateTone(sessionRefreshMs, 2000)}`}>
                    Session {formatDuration(sessionRefreshMs)}
                  </span>
                </div>

                {runtimeWarnings.length > 0 ? (
                  <div className="space-y-2 border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Runtime Uyarısı</p>
                    {runtimeWarnings.map((warning) => (
                      <p key={warning} className="text-sm text-amber-900">
                        {warning}
                      </p>
                    ))}
                  </div>
                ) : null}

                {launch.sheets.length > 0 ? (
                  <div className="border border-brand-200 bg-white">
                    <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Workbook Contract</p>
                      <p className="mt-1 text-sm text-brand-700">{contractDescription}</p>
                    </div>
                    <div className="space-y-3 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-700">
                          Contract {contractVersion}
                        </span>
                        <span className="border border-brand-200 bg-brand-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-500">
                          {launch.sheets.length} Sheet
                        </span>
                      </div>
                      <div className="grid gap-px bg-brand-200 md:grid-cols-5">
                        {launch.sheets.map((sheet) => (
                          <div key={sheet.name} className="bg-white px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-black uppercase tracking-widest text-brand-900">{sheet.name}</h3>
                              <span
                                className={`border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                                  sheet.mode === 'editable'
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                    : sheet.mode === 'readonly'
                                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                                      : sheet.mode === 'static'
                                        ? 'border-stone-300 bg-stone-50 text-stone-700'
                                        : 'border-amber-300 bg-amber-50 text-amber-700'
                                }`}
                              >
                                {formatSheetMode(sheet.mode)}
                              </span>
                              {sheet.system_sync ? (
                                <span className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-sky-700">
                                  System Sync
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-xs leading-5 text-brand-600">{sheet.note || '—'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isCompactLayout && launch.sheets.length > 0 ? (
              <div className="border border-brand-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-200 bg-brand-50 px-4 py-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Workbook Contract</p>
                    <p className="mt-1 text-sm text-brand-700">{contractDescription}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((current) => !current)}
                    className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
                  >
                    {showAdvanced ? 'Contract Gizle' : `Contract Göster · ${launch.sheets.length} Sheet`}
                  </button>
                </div>
                {showAdvanced ? (
                  <div className="space-y-3 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-700">
                        Contract {contractVersion}
                      </span>
                      <span className="border border-brand-200 bg-brand-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-500">
                        {launch.sheets.length} Sheet
                      </span>
                    </div>
                    <div className="grid gap-px bg-brand-200 md:grid-cols-5">
                      {launch.sheets.map((sheet) => (
                        <div key={sheet.name} className="bg-white px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-black uppercase tracking-widest text-brand-900">{sheet.name}</h3>
                            <span
                              className={`border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                                sheet.mode === 'editable'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : sheet.mode === 'readonly'
                                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                                    : sheet.mode === 'static'
                                      ? 'border-stone-300 bg-stone-50 text-stone-700'
                                      : 'border-amber-300 bg-amber-50 text-amber-700'
                              }`}
                            >
                              {formatSheetMode(sheet.mode)}
                            </span>
                            {sheet.system_sync ? (
                              <span className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-sky-700">
                                System Sync
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-brand-600">{sheet.note || '—'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!launch.office_available ||
            (launch.launch_mode === 'onlyoffice-docs-api'
              ? !launch.onlyoffice_api_js_url || !launch.onlyoffice_config
              : !launch.editor_url || !launch.access_token) ? (
              <div className="space-y-4">
                <div className="border border-amber-200 bg-amber-50 px-6 py-5 text-sm text-amber-900">
                  <p className="font-black uppercase tracking-widest text-amber-700">Office Runtime Ulaşılamadı</p>
                  <p className="mt-2">{launch.office_reason || runtimeStatus?.reason || 'Office runtime bulunamadı.'}</p>
                </div>
                <div className="border border-brand-200 bg-white px-6 py-12 text-center text-sm font-medium text-brand-600">
                  Bu makinede office runtime ayağa kalkmadığı için grid fallback’e dönülebilir.
                </div>
              </div>
            ) : (
              <div className={`overflow-hidden border border-brand-300 bg-white shadow-sm ${isCompactLayout ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
                <div className={`border-b border-brand-200 bg-brand-50 ${editorHeaderPaddingClass}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-black uppercase tracking-widest text-brand-800">{launch.artifact?.file_name || launch.title}</h2>
                      {!isCompactLayout ? <p className="mt-1 text-sm text-brand-600">{editorStatusText}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!isCompactLayout ? (
                        <span
                          className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                            officeRuntimeAvailable
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-rose-300 bg-rose-50 text-rose-700'
                          }`}
                        >
                          {officeRuntimeAvailable ? 'Runtime Hazir' : 'Runtime Yok'}
                        </span>
                      ) : null}
                      {isIframeLoading ? (
                        <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-800">
                          Belge Yukleniyor
                        </span>
                      ) : null}
                      {hasExternalUpdate ? (
                        <span className="border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-800">
                          Dis Guncelleme Var
                        </span>
                      ) : null}
                      {isSessionStale ? (
                        <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-800">
                          Oturum Eski
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                {hasIframeLoadTimedOut && !isWorkspaceEmbedded ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Yukleme Beklenenden Uzun Surdu</p>
                      <p className="mt-1 text-sm text-amber-900">
                        Office editor ilk baglantiyi kurarken takilmis olabilir. Oturumu yenilemek genelde yeterli olur.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onRefreshSession}
                        className="inline-flex items-center gap-2 border border-amber-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-800 transition hover:bg-amber-100"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Office Oturumunu Yenile
                      </button>
                      {canReopenWindow ? (
                        <button
                          type="button"
                          onClick={onReopenWindow}
                          className="inline-flex items-center gap-2 border border-sky-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-sky-800 transition hover:bg-sky-100"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Pencereyi Yeniden Ac
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {launch.launch_mode === 'onlyoffice-docs-api' ? (
                  <div className={isCompactLayout ? 'min-h-0 flex-1' : ''}>
                    <OnlyOfficeEditor
                      launch={launch}
                      onReady={onIframeLoad}
                      onError={onEditorError}
                      onDirtyStateChange={shouldTrackLivePreview ? onEditorDirtyStateChange : undefined}
                      className={editorSurfaceClass}
                    />
                  </div>
                ) : (
                  <>
                    <form ref={formRef} action={launch.editor_url || undefined} method="POST" target={iframeName} className="hidden">
                      <input type="hidden" name="access_token" value={launch.access_token || undefined} />
                      <input type="hidden" name="access_token_ttl" value={String(launch.access_token_ttl || '')} />
                    </form>
                    <div className={isCompactLayout ? 'min-h-0 flex-1' : ''}>
                      <iframe title={launch.title} name={iframeName} onLoad={onIframeLoad} className={editorSurfaceClass} />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {importReconcilePreview ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-brand-950/50 px-4 py-6">
          <div className="flex max-h-[min(82vh,52rem)] w-full max-w-4xl flex-col overflow-hidden border-2 border-brand-300 bg-white shadow-2xl">
            <div className="border-b border-brand-200 bg-brand-50 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Reconcile Preview</p>
                  <h2 className="mt-1 text-lg font-black uppercase tracking-[0.06em] text-brand-950">Depolama içe aktarma önizlemesi</h2>
                  <p className="mt-1 text-sm text-brand-600">
                    {pendingImportFileName || 'Seçilen workbook'} için yalnız kontrollü alan değişiklikleri uygulanacak.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCancelImportPreview}
                  className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Kapat
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {importBlockingErrors.length > 0 ? (
                <div className="mb-4 border border-rose-300 bg-rose-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Bloklayıcı Hatalar</p>
                  <div className="mt-2 space-y-2 text-sm text-rose-900">
                    {importBlockingErrors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                  </div>
                </div>
              ) : null}

              {importReconcilePreview.warnings.length > 0 ? (
                <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Uyarılar</p>
                  <div className="mt-2 space-y-2 text-sm text-amber-900">
                    {importReconcilePreview.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="border border-brand-200 bg-white">
                <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Değişiklikler</p>
                  <p className="mt-1 text-sm text-brand-700">
                    {importReconcilePreview.changes.length > 0
                      ? `${importReconcilePreview.changes.length} controlled değişiklik uygulanacak.`
                      : 'Uygulanacak controlled değişiklik bulunmadı.'}
                  </p>
                </div>
                {importReconcilePreview.changes.length > 0 ? (
                  <div className="divide-y divide-brand-100">
                    {importReconcilePreview.changes.map((change) => (
                      <div key={`${change.sheet}:${change.cell_ref}:${change.label}`} className="grid gap-3 px-4 py-3 md:grid-cols-[1.5fr_1fr_1fr]">
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-brand-800">{change.label}</p>
                          <p className="mono mt-1 text-[11px] text-brand-500" style={monoStyle}>
                            {change.sheet} · {change.cell_ref}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Eski</p>
                          <p className="mt-1 text-sm text-brand-900">{change.old_value || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Yeni</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-800">{change.new_value || '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-brand-200 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelImportPreview}
                  className="inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={onApplyImportPreview}
                  disabled={!canApplyImportPreview}
                  className="inline-flex items-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Uygula
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
