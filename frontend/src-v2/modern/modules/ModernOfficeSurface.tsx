import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Download, ExternalLink, FileSpreadsheet, Maximize2, Minimize2, RefreshCw, Upload, X } from 'lucide-react';

import type { OfficeDocumentPageProps } from '@/make/office/OfficeDocumentPage';
import { OnlyOfficeEditor } from '@/make/office/OnlyOfficeEditor';

import { shellButtonClass } from './shared';

type ModernOfficeSurfaceProps = {
  state: OfficeDocumentPageProps;
  mode?: 'page' | 'dock' | 'workspace';
  onClose?: () => void | Promise<void>;
  titleOverride?: string;
};

function kindLabel(kind: string) {
  if (kind === 'alis-workspace') return 'AFG çalışma dosyası';
  if (kind === 'alis-document') return 'Final AFG belgesi';
  if (kind === 'depolama') return 'Depolama workbook';
  if (kind === 'log') return 'Log workbook';
  return 'Office belgesi';
}

function accessLabel(state: OfficeDocumentPageProps) {
  if (state.launch?.can_write) return 'Düzenlenebilir';
  if (state.launch) return 'Salt okunur';
  return 'Bekliyor';
}

function launchMessage(state: OfficeDocumentPageProps) {
  if (state.launchError?.message) {
    if (state.launchError.message.includes('AFG_REFERENCE_TEMPLATE_MISSING')) {
      return 'AFG referans workbook şablonu bulunamadı. Referans dosyası geri yüklenmeden OnlyOffice başlatılamaz.';
    }
    if (state.launchError.message.includes('OFFICE_REFERENCE_TEMPLATE_MISSING')) {
      return 'Bu workbook için referans şablon bulunamadı. Şablon sağlanmadan OnlyOffice başlatılamaz.';
    }
    return state.launchError.message;
  }
  return state.runtimeStatus?.reason || 'Office oturumu başlatılamadı. Manuel olarak tekrar deneyin.';
}

export function ModernOfficeSurface({ state, mode = 'workspace', onClose, titleOverride }: ModernOfficeSurfaceProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const launch = state.launch;
  const onlyOfficeLaunch = launch?.launch_mode === 'onlyoffice-docs-api';
  const editorReady = Boolean(
    launch?.office_available &&
      (onlyOfficeLaunch ? launch.onlyoffice_api_js_url && launch.onlyoffice_config : launch?.editor_url && launch?.access_token),
  );
  const title = titleOverride || launch?.artifact?.file_name || launch?.title || kindLabel(state.kind);
  const statusLabel = state.lastEditorError
    ? 'Editör hatası'
    : state.lastLivePreviewError
      ? 'Sync reddedildi'
    : state.isIframeLoading
      ? 'Editör açılıyor'
      : state.isLivePreviewSyncing
        ? 'Senkronize ediliyor'
        : editorReady
          ? 'Bağlantı hazır'
          : 'Hazırlanıyor';
  const canImport = Boolean(launch?.import_supported);

  const closeOfficeSurface = async () => {
    if (state.onBeforeClose && !(await state.onBeforeClose())) return;
    await onClose?.();
  };

  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const normalHeightClass = mode === 'page'
    ? 'h-[calc(100dvh-1.5rem)] min-h-[min(640px,calc(100dvh-1.5rem))]'
    : 'h-[calc(100dvh-7rem)] min-h-[min(640px,calc(100dvh-1.5rem))]';
  const canvasClass = expanded
    ? 'fixed inset-3 z-[90] h-[calc(100dvh-1.5rem)] min-h-0'
    : normalHeightClass;

  return (
    <section className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-md ${canvasClass}`}>
      <header className="shrink-0 border-b border-sg-border bg-sg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sg-md bg-sg-accent-soft text-sg-accent">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sg-accent">Embedded Office</p>
              <h2 className="truncate text-base font-bold text-sg-text">{title}</h2>
              <p className="mt-0.5 text-xs text-sg-text-soft">{kindLabel(state.kind)} · {accessLabel(state)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${editorReady ? 'border-sg-green/25 bg-sg-green-soft text-sg-green' : 'border-sg-amber/30 bg-sg-amber-soft text-sg-amber'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${editorReady ? 'bg-sg-green' : 'bg-sg-amber'}`} />
              {statusLabel}
            </span>
            {state.isLivePreviewDirty ? <span className="rounded-full border border-sg-amber/30 bg-sg-amber-soft px-2.5 py-1 text-[10px] font-semibold text-sg-amber">Kaydedilmemiş değişiklik</span> : null}
            <button type="button" onClick={state.onRefreshSession} className={shellButtonClass('ghost')} title="Office oturumunu yenile">
              <RefreshCw className={`h-3.5 w-3.5 ${state.isSessionRefreshing ? 'animate-spin' : ''}`} />
              Yenile
            </button>
            <button type="button" onClick={() => setShowAdvanced((value) => !value)} className={shellButtonClass('ghost')}>
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Tanılama
            </button>
            {mode !== 'page' ? (
              <button type="button" onClick={() => setExpanded((value) => !value)} className={shellButtonClass('ghost')}>
                {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {expanded ? 'Daralt' : 'Genişlet'}
              </button>
            ) : null}
            {state.canReopenWindow ? (
              <button type="button" onClick={state.onReopenWindow} className={shellButtonClass('ghost')}>
                <ExternalLink className="h-3.5 w-3.5" />
                Ayrı pencere
              </button>
            ) : null}
            {onClose ? <button type="button" onClick={() => { void closeOfficeSurface(); }} className={shellButtonClass('ghost')} title="Office görünümünü kapat"><X className="h-3.5 w-3.5" /> Kapat</button> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-sg-text-soft">
          <span>CRM canonical state · workbook controlled view · {state.launch?.provider_label || 'Provider bekleniyor'}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={state.onExport} disabled={!launch} className={shellButtonClass('ghost')}><Download className="h-3.5 w-3.5" />Dışa aktar</button>
            {canImport ? (
              <>
                <input ref={importInputRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) state.onImportFile(file); event.target.value = ''; }} />
                <button type="button" onClick={() => (state.useNativeImportDialog ? void state.onImportFromDialog() : importInputRef.current?.click())} disabled={state.isImporting} className={shellButtonClass('ghost')}><Upload className="h-3.5 w-3.5" />İçe aktar</button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {showAdvanced ? (
        <div className="shrink-0 border-b border-sg-border bg-sg-surface-soft px-4 py-3">
          <div className="grid gap-2 text-xs text-sg-text-soft sm:grid-cols-2 xl:grid-cols-4">
            <p><span className="font-semibold text-sg-text">Kind:</span> {state.kind || '—'}</p>
            <p><span className="font-semibold text-sg-text">Key:</span> {state.artifactKey || '—'}</p>
            <p><span className="font-semibold text-sg-text">Launch:</span> {state.launch?.launch_mode || '—'}</p>
            <p><span className="font-semibold text-sg-text">Revision:</span> {state.status?.artifact?.workbook_revision || state.launch?.artifact?.workbook_revision || state.status?.artifact?.base_revision || '—'}</p>
            <p><span className="font-semibold text-sg-text">Runtime:</span> {state.runtimeStatus?.runtime_available === false ? 'Unavailable' : 'Available'}</p>
            <p><span className="font-semibold text-sg-text">Launch süresi:</span> {state.launchRequestMs == null ? '—' : `${state.launchRequestMs} ms`}</p>
            <p><span className="font-semibold text-sg-text">Callback:</span> {state.status?.last_callback_at || 'Yok'}</p>
            <p><span className="font-semibold text-sg-text">Conflict:</span> {state.hasExternalUpdate ? 'Var' : 'Yok'}</p>
            {state.lastLivePreviewError ? <p className="sm:col-span-2 text-sg-red"><span className="font-semibold text-sg-text">Sync hatası:</span> {state.lastLivePreviewError}</p> : null}
          </div>
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sg-surface-soft p-3">
        {state.isLoading ? (
          <div className="flex h-full min-h-[420px] items-center justify-center rounded-sg-lg border border-sg-border bg-sg-surface text-sm text-sg-text-soft">Office oturumu hazırlanıyor...</div>
        ) : state.isError || !launch ? (
          <div className="flex h-full min-h-[420px] items-center justify-center rounded-sg-lg border border-sg-red/20 bg-sg-red-soft p-6 text-center">
            <div className="max-w-xl">
              <AlertTriangle className="mx-auto h-7 w-7 text-sg-red" />
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sg-red">Office launch dependency</p>
              <p className="mt-2 text-base font-semibold text-sg-text">OnlyOffice oturumu başlatılamadı</p>
              <p className="mt-2 text-sm leading-6 text-sg-text-soft">{launchMessage(state)}</p>
              <button type="button" onClick={state.onRefreshSession} className={`${shellButtonClass('primary')} mt-5`}><RefreshCw className="h-3.5 w-3.5" />Tekrar dene</button>
            </div>
          </div>
        ) : !editorReady ? (
          <div className="flex h-full min-h-[420px] items-center justify-center rounded-sg-lg border border-sg-amber/25 bg-sg-amber-soft p-6 text-center">
            <div className="max-w-xl">
              <AlertTriangle className="mx-auto h-7 w-7 text-sg-amber" />
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sg-amber">Office runtime unavailable</p>
              <p className="mt-2 text-base font-semibold text-sg-text">Editör provider’a ulaşamıyor</p>
              <p className="mt-2 text-sm leading-6 text-sg-text-soft">{launch.office_reason || state.runtimeStatus?.reason || 'Office runtime hazır değil.'}</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sg-lg border border-sg-border bg-white shadow-sg-sm">
            {onlyOfficeLaunch ? (
              <OnlyOfficeEditor
                launch={launch}
                onReady={state.onIframeLoad}
                onError={state.onEditorError}
                onDirtyStateChange={state.onEditorDirtyStateChange}
                className="min-h-0 flex-1"
              />
            ) : (
              <>
                <form ref={state.formRef} action={launch.editor_url || undefined} method="POST" target={state.iframeName} className="hidden">
                  <input type="hidden" name="access_token" value={launch.access_token || undefined} />
                  <input type="hidden" name="access_token_ttl" value={String(launch.access_token_ttl || '')} />
                </form>
                <iframe title={launch.title} name={state.iframeName} onLoad={state.onIframeLoad} className="min-h-0 flex-1 border-0" />
              </>
            )}
          </div>
        )}
        {state.lastEditorError ? <p className="mt-2 rounded-sg-md border border-sg-red/20 bg-sg-red-soft px-3 py-2 text-xs text-sg-red">{state.lastEditorError}</p> : null}
        {state.lastLivePreviewError ? <p className="mt-2 rounded-sg-md border border-sg-amber/25 bg-sg-amber-soft px-3 py-2 text-xs text-sg-amber">{state.lastLivePreviewError}</p> : null}
      </main>
    </section>
  );
}
