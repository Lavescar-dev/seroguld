import { AlertCircle, CheckCircle2, FileSpreadsheet, FileText, Loader2, Search, Upload, X } from 'lucide-react';
import { type ChangeEvent, useContext, useMemo, useRef, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

import type { ModernLogViewModel } from '@/modern/adapters/log';
import { LegacyMigrationCenter } from '@/components/LegacyMigrationCenter';
import { HtmlDocumentModal } from '@/components/HtmlDocumentModal';
import { formatDate, formatMoney, formatNumber, labelMetalType, labelProductType } from '@/lib/format';
import { apiRequest, fetchAuthedText } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import { lineHasPendingChange, resolveLineDraft } from '@/make/log/lineHelpers';
import type { LineDraft, RouteDestination } from '@/make/log/types';
import type { AfgWorkspaceLine, DocumentArtifactReconcilePreview } from '@/types';
import { ModernDrawer } from '@/modern/design-system';
import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernReviewBar, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { DocumentPipeline } from './log/DocumentPipeline';
import { MeltLotPanel } from './log/MeltLotPanel';
import { SplitBoard } from './log/SplitBoard';
import { SplitSummary } from './log/SplitSummary';
import { labelLotHistoryAction } from './log/labels';
import {
  LineClassificationSelect,
  LineGdprNote,
  LineNoteInput,
  LinePendingBadge,
  LineStateBadge,
  RouteButtonGroup,
} from './log/LineControls';

export function ModernLogModule({ viewModel }: { viewModel: ModernLogViewModel }) {
  const { state, bucket, pureUnit, selectedDocument, bucketModel } = viewModel;
  const toast = useToast();
  const [migrationOpen, setMigrationOpen] = useState(false);
  // R2-13 — window.open Tauri'de sessizce yutulduğu için belge modalda açılır (LogPage ile aynı desen).
  const [docPreview, setDocPreview] = useState<{ html: string; title: string } | null>(null);
  const openDocumentHtml = async (sessionId: string, documentNumber: string) => {
    try {
      const html = await fetchAuthedText(`/api/pos/sessions/${sessionId}/receipt?audience=admin&format=html`);
      setDocPreview({ html, title: documentNumber });
    } catch (error) {
      toast.error('Belge açılamadı', readApiDetail(error, 'Sunucu hatası'));
    }
  };
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const list: number[] = [];
    for (let y = current; y >= current - 5; y--) list.push(y);
    if (!list.includes(state.selectedYear)) list.unshift(state.selectedYear);
    return list;
  }, [state.selectedYear]);

  return (
    <ModernModuleShell
      eyebrow="Log / AFG Defteri"
      title="AFG → Eritme akışı"
      subtitle="Alım makbuzu (AFG) satırlarını depoya al, eritmeye ayır veya karara bırak; eritme lotlarını oluştur ve kesinleştir."
      blocker={viewModel.blocker}
      unsupportedControls={state.activeView === 'excel' ? [] : viewModel.unsupportedControls}
      badges={
        <>
          <DataPill label="Defter" value={state.activeTab === 'gold' ? 'Altın' : 'Gümüş'} tone={state.activeTab === 'gold' ? 'warning' : 'neutral'} />
          <DataPill label="Görünüm" value={state.activeView === 'excel' ? 'Office' : 'Sistem'} tone={state.activeView === 'excel' ? 'warning' : 'neutral'} />
          {bucket ? <DataPill label="Eritme kuyruğu" value={`${bucket.melt_queue.line_count} satır`} tone={bucket.melt_queue.line_count > 0 ? 'warning' : 'success'} /> : null}
          {state.pendingRouteCount > 0 ? <DataPill label="İnceleme" value={`${state.pendingRouteCount} satır`} tone="warning" /> : null}
        </>
      }
      actions={
        <>
          <label htmlFor="modern-log-year" className="inline-flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-sg-text-soft">Yıl</span>
            <select
              id="modern-log-year"
              value={state.selectedYear}
              onChange={(event) => state.onSelectedYearChange(Number(event.target.value))}
              className="bg-transparent text-sm font-semibold text-sg-text outline-none"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setMigrationOpen(true)} className={shellButtonClass('secondary')}>Eski sistemi taşı</button>
          <button type="button" onClick={() => state.onActiveTabChange('gold')} className={shellButtonClass(state.activeTab === 'gold' ? 'primary' : 'secondary')}>Altın</button>
          <button type="button" onClick={() => state.onActiveTabChange('silver')} className={shellButtonClass(state.activeTab === 'silver' ? 'primary' : 'secondary')}>Gümüş</button>
          <button
            type="button"
            onClick={() => state.onActiveViewChange('excel')}
            // İki katmanlı model: bekleyen sınıf/not varken Office yüzeyine geçiş kilitli (Classic excelLocked paritesi).
            disabled={state.pendingRouteCount > 0}
            title={state.pendingRouteCount > 0 ? 'Önce inceleme barından uygula veya vazgeç' : 'Log workbook görünümü'}
            data-testid="log-office-button"
            className={shellButtonClass('secondary')}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Office
          </button>
        </>
      }
    >
      {state.activeView === 'excel' ? (
        <ModernLogOfficeSurface year={state.selectedYear} onClose={() => state.onActiveViewChange('system')} />
      ) : (
        <>
          <ModernStatGrid items={viewModel.stats} />

          <LegacyMigrationCenter open={migrationOpen} onClose={() => setMigrationOpen(false)} initialPhase="log" />
          <ModernLogWorkbookImport year={state.selectedYear} onImported={state.onRetryWorkspace} />

          {viewModel.phase === 'loading' ? <LoadingState label="Log workspace yükleniyor" /> : null}
          {viewModel.phase === 'error' ? <EmptyState title="Çalışma Alanı Hatası" message="Log çalışma alanı yüklenemedi. Lütfen tekrar deneyin." action={<button type="button" onClick={state.onRetryWorkspace} className={shellButtonClass('primary')}>Tekrar Dene</button>} /> : null}
          {viewModel.phase === 'empty' ? <EmptyState title="Belge Yok" message="Seçili bucket için route edilecek veya melt'e gidecek belge bulunmuyor." /> : null}

          {bucket && bucketModel ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <ModernSection
                title="AFG Belgeleri"
                subtitle="Rota tıklaması anında uygulanır; sınıf ve notlar aşağıdaki inceleme barından toplu uygulanır."
              >
                <div className="grid gap-3">
                  <div className="flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
                    <Search className="h-4 w-4 text-sg-text-soft" />
                    <input value={state.query} onChange={(event) => state.onQueryChange(event.target.value)} className="w-full bg-transparent text-sm text-sg-text outline-none" placeholder="Belge no / müşteri ara" />
                  </div>

                  {bucket.documents.length === 0 ? (
                    <EmptyState title="Belge Yok" message="Seçili bucket için route edilecek veya melt'e gidecek belge bulunmuyor." />
                  ) : (
                    bucket.documents.map((document) => {
                      const expanded = state.expandedDocument === document.sequence_no;
                      return (
                        <div key={document.sequence_no} className={`rounded-sg-lg border bg-sg-surface-soft p-4 ${expanded ? 'border-sg-accent/50' : 'border-sg-border'}`}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-sg-text">{document.document_number}</p>
                              <p className="mt-1 text-xs text-sg-text-soft">{formatDate(document.issued_at)} · {document.customer_name || '—'}</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void openDocumentHtml(document.session_id, document.document_number)}
                                className={shellButtonClass('ghost')}
                              >
                                <FileText className="h-4 w-4" />
                                Belgeyi Aç
                              </button>
                              <button
                                type="button"
                                onClick={() => state.onToggleDocument(document.sequence_no)}
                                aria-expanded={expanded}
                                data-testid={`log-document-toggle-${document.sequence_no}`}
                                className={shellButtonClass(expanded ? 'secondary' : 'primary')}
                              >
                                {expanded ? 'Kapat' : 'Detay'}
                              </button>
                            </div>
                          </div>
                          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                            <MobileRow label="Gram" value={formatNumber(document.total_weight_grams, ' g')} />
                            <MobileRow label={pureUnit === 'saf' ? 'Saf gümüş' : 'Has'} value={formatNumber(document.total_pure_gold_grams, ' g')} />
                            <MobileRow label="DKK" value={formatMoney(document.net_amount_dkk)} />
                          </dl>
                          {expanded ? (
                            <div className="mt-3 grid gap-2">
                              {document.lines.map((line) => (
                                <LogLineCard
                                  key={line.id}
                                  line={line}
                                  lineDrafts={state.lineDrafts}
                                  routeBusy={state.routeBusy}
                                  pureUnit={pureUnit}
                                  onDraftChange={state.onDraftChange}
                                  onRoute={state.onRoute}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-sg-text-soft">
                              <span className="font-semibold text-sg-text">{document.line_count}</span> satır · incelemek için Detay
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </ModernSection>

              <div className="grid content-start gap-4">
                {selectedDocument ? (
                  <DocumentPipeline
                    selected={selectedDocument}
                    lineDrafts={state.lineDrafts}
                    routeBusy={state.routeBusy}
                    pureUnit={pureUnit}
                    onDraftChange={state.onDraftChange}
                    onRoute={state.onRoute}
                    onOpenDocument={(sessionId, documentNumber) => void openDocumentHtml(sessionId, documentNumber)}
                  />
                ) : null}

                <SplitBoard
                  documents={bucket.documents}
                  lineDrafts={state.lineDrafts}
                  routeBusy={state.routeBusy}
                  pureUnit={pureUnit}
                  onDraftChange={state.onDraftChange}
                  onRoute={state.onRoute}
                />

                <SplitSummary bucket={bucket} groupedTotals={bucketModel.totals} groupedCounts={bucketModel.counts} />

                <MeltLotPanel
                  bucket={bucket}
                  lotDrafts={state.lotDrafts}
                  show={state.showMeltSection}
                  meltBusy={state.meltBusy}
                  createMeltBusy={state.createMeltBusy}
                  finalizeBusy={state.finalizeBusy}
                  deleteBusy={state.deleteBusy}
                  pureUnit={pureUnit}
                  onToggleMeltSection={state.onToggleMeltSection}
                  onCreateMeltLot={state.onCreateMeltLot}
                  onLotDraftChange={state.onLotDraftChange}
                  onSaveLot={state.onSaveLot}
                  onFinalizeLot={state.onFinalizeLot}
                  onDeleteLot={state.onDeleteLot}
                  onDownloadLotPdf={state.onDownloadLotPdf}
                  onOpenLotHistory={state.onOpenLotHistory}
                  onOpenLotLines={state.onOpenLotLines}
                />
              </div>
            </div>
          ) : null}

          {state.pendingRouteCount > 0 ? (
            <div className="mt-4">
              <ModernReviewBar
                summary={state.pendingRouteSummary}
                busy={state.routeBusy}
                onApply={state.onApplyRouteReview}
                onDiscard={() => void state.onDiscardRouteReview()}
              />
            </div>
          ) : null}

          <ModernDrawer
            open={Boolean(state.historyLotId)}
            title="Lot geçmişi"
            description={`Lot ${state.historyLotId?.slice(0, 8) ?? ''} · son 50 kayıt`}
            onClose={state.onCloseLotHistory}
          >
            {state.lotHistoryLoading ? (
              <LoadingState label="Geçmiş yükleniyor" />
            ) : state.lotHistoryError ? (
              <EmptyState
                title="Geçmiş yüklenemedi"
                message="Audit kayıtları alınırken bir hata oluştu."
                action={
                  state.onRetryLotHistory ? (
                    <button type="button" onClick={state.onRetryLotHistory} className={shellButtonClass('primary')}>Tekrar Dene</button>
                  ) : undefined
                }
              />
            ) : state.lotHistory.length === 0 ? (
              <EmptyState title="Kayıt yok" message="Bu lot için henüz geçmiş kaydı bulunmuyor." />
            ) : (
              <div className="grid gap-3">
                {state.lotHistory.map((entry) => (
                  <div key={entry.id} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-sg-text">{labelLotHistoryAction(entry.action)}</p>
                      <p className="text-xs text-sg-text-soft">{formatDate(entry.created_at)}</p>
                    </div>
                    {entry.performed_by_email || entry.performed_by ? (
                      <p className="mt-1 text-xs text-sg-text-soft">{entry.performed_by_email || entry.performed_by}</p>
                    ) : null}
                    {entry.notes ? <p className="mt-2 text-sm text-sg-text">{entry.notes}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </ModernDrawer>

          <ModernDrawer
            open={Boolean(state.linesLotId)}
            title="Lot satırları"
            description={`Lot ${state.linesLotId?.slice(0, 8) ?? ''} içindeki AFG kalemleri`}
            onClose={state.onCloseLotLines}
          >
            {state.lotLinesLoading ? (
              <LoadingState label="Satırlar yükleniyor" />
            ) : state.lotLinesError ? (
              <EmptyState
                title="Satırlar yüklenemedi"
                message="Bağlı AFG kalemleri alınırken bir hata oluştu."
                action={
                  state.onRetryLotLines ? (
                    <button type="button" onClick={state.onRetryLotLines} className={shellButtonClass('primary')}>Tekrar Dene</button>
                  ) : undefined
                }
              />
            ) : state.lotLines.length === 0 ? (
              <EmptyState title="Satır yok" message="Bu lota bağlı satır bulunmuyor." />
            ) : (
              <div className="grid gap-3">
                {state.lotLines.map((line) => (
                  <div key={line.line_id} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-sg-text">{line.document_number} · L{line.line_no}</p>
                      <p className="text-xs text-sg-text-soft">{line.customer_name || '—'}</p>
                    </div>
                    <dl className="mt-2 grid gap-1.5 text-sm">
                      <MobileRow label="Gram" value={line.weight_grams ? formatNumber(line.weight_grams, ' g') : '—'} />
                      <MobileRow label="Saf" value={line.pure_gold_grams ? formatNumber(line.pure_gold_grams, ' g') : '—'} />
                      <MobileRow label="DKK" value={line.line_total_dkk ? formatMoney(line.line_total_dkk) : '—'} />
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </ModernDrawer>
        </>
      )}

      <HtmlDocumentModal
        open={Boolean(docPreview?.html)}
        html={docPreview?.html ?? null}
        title="AFG Belgesi"
        subtitle={docPreview?.title}
        onClose={() => setDocPreview(null)}
      />
    </ModernModuleShell>
  );
}

// İki katmanlı modelin satır kartı: rota tıklaması anında uygulanır,
// sınıf + not inceleme barından toplu uygulanır (İnceleme rozeti = bekleyen taslak).
function LogLineCard({
  line,
  lineDrafts,
  routeBusy,
  pureUnit,
  onDraftChange,
  onRoute,
}: {
  line: AfgWorkspaceLine;
  lineDrafts: Record<string, LineDraft>;
  routeBusy: boolean;
  pureUnit: 'has' | 'saf';
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onRoute: (line: AfgWorkspaceLine, destination: RouteDestination) => void;
}) {
  const draft = resolveLineDraft(line, lineDrafts);
  const terminal = line.product_status === 'melted' || line.product_status === 'sold';
  const pendingChange = lineHasPendingChange(line, lineDrafts);

  return (
    <div className={`rounded-sg-lg border bg-sg-surface p-3 ${pendingChange ? 'border-sg-amber/40' : 'border-sg-border'}`} data-testid="log-line-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-sg-text">
          L{line.line_no} · {formatNumber(line.weight_grams, ' g')} · {formatNumber(line.pure_gold_grams, ` ${pureUnit}`)} · {formatMoney(line.line_total_dkk)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {pendingChange ? <LinePendingBadge /> : null}
          <LineStateBadge line={line} />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-sg-text-soft">
        {labelProductType(line.product_type)} · {labelMetalType(line.metal_type)} · {line.product_number || line.reference_number || 'Ref yok'}
      </p>
      {terminal ? null : (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-center">
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Depo sınıfı
            <LineClassificationSelect lineId={line.id} draft={draft} onChange={onDraftChange} />
          </label>
          <label className="block text-[11px] font-semibold text-sg-text-soft">
            Not
            <LineNoteInput lineId={line.id} draft={draft} onChange={onDraftChange} />
          </label>
          <RouteButtonGroup line={line} draft={draft} busy={routeBusy} onRoute={onRoute} />
        </div>
      )}
      {line.is_gdpr_locked ? <div className="mt-2"><LineGdprNote /></div> : null}
    </div>
  );
}

function ModernLogOfficeSurface({
  year,
  onClose,
}: {
  year: number;
  onClose: () => void | Promise<void>;
}) {
  return (
    <div className="flex min-h-0 h-full flex-1 flex-col overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-md">
      <EmbeddedWorkbookPanel kind="log" artifactKey={String(year)} layoutMode="workspace" onClose={onClose} variant="modern" />
    </div>
  );
}

function ModernLogWorkbookImport({
  year,
  onImported,
}: {
  year: number;
  onImported: () => void | Promise<void>;
}) {
  const queryClient = useContext(QueryClientContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // M3 — önizlemesiz window.confirm + doğrudan import, yanlış dosyayı önizleme
  // görmeden uyguluyordu; reconcile-preview → blocking_errors → apply akışına
  // taşındı (Depolama import güvenli akışıyla parite).
  const [preview, setPreview] = useState<DocumentArtifactReconcilePreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await previewFile(file);
  }

  async function previewFile(file: File) {
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'xlsx' && extension !== 'xlsm') {
      setStatus({ tone: 'error', message: 'Yalnızca .xlsx veya .xlsm Log çalışma kitabı içe aktarılabilir.' });
      return;
    }

    setBusy(true);
    setStatus(null);
    setFileName(file.name);
    setPendingFile(file);
    try {
      const formData = new FormData();
      formData.append('workbook', file);
      const result = await apiRequest<DocumentArtifactReconcilePreview>(
        `/api/v2/log/workbook/reconcile-preview?year=${encodeURIComponent(String(year))}`,
        { method: 'POST', body: formData },
      );
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setPendingFile(null);
      setStatus({ tone: 'error', message: readImportError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!preview || !pendingFile || !preview.editable || (preview.blocking_errors || []).length > 0 || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.append('workbook', pendingFile);
      await apiRequest(`/api/v2/log/workbook/import?year=${encodeURIComponent(String(year))}`, {
        method: 'POST',
        body: formData,
      });
      if (queryClient) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['log'] }),
          queryClient.invalidateQueries({ queryKey: ['depolama'] }),
          queryClient.invalidateQueries({ queryKey: ['inventory'] }),
          queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
          queryClient.invalidateQueries({ queryKey: ['office-document-launch', 'log'] }),
          queryClient.invalidateQueries({ queryKey: ['office-document-status', 'log'] }),
        ]);
      }
      await onImported();
      setPreview(null);
      setPendingFile(null);
      setStatus({ tone: 'success', message: `${fileName || 'Çalışma kitabı'} içe aktarıldı. Log çalışma alanı yenilendi.` });
      setFileName(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      setStatus({ tone: 'error', message: readImportError(error) });
    } finally {
      setBusy(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setPendingFile(null);
    setFileName(null);
    setStatus(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const blockingErrors = preview?.blocking_errors || [];

  return (
    <ModernSection
      title="Tarihsel Log Excel içe aktar"
      subtitle="Yalnızca seçili yılın mevcut Log çalışma kitabını kullanın. İçe aktarma yerel rota ve melt verisini değiştirir; Uniconta veya başka bir dış sisteme istek göndermez."
      actions={
        <>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
            onChange={onFileSelected}
            aria-label="Log Excel dosyası seç"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={shellButtonClass('secondary')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? 'Önizleniyor' : 'Excel seç'}
          </button>
        </>
      }
    >
      {status ? (
        <div
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-sg-md border px-3 py-2 text-sm ${
            status.tone === 'error'
              ? 'border-sg-red/30 bg-sg-red-soft text-sg-red'
              : 'border-sg-green/30 bg-sg-green-soft text-sg-green'
          }`}
        >
          {status.tone === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <p>{status.message}</p>
        </div>
      ) : null}
      <div
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (busy) return;
          const file = Array.from(event.dataTransfer?.files || []).find((f) => /\.(xlsx|xlsm)$/i.test(f.name));
          if (file) void previewFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mt-2 cursor-pointer rounded-sg-md border border-dashed px-4 py-5 text-center text-sm transition ${dragActive ? 'border-sg-accent bg-sg-accent-soft text-sg-accent-dark' : 'border-sg-border text-sg-text-soft hover:bg-sg-surface-soft'}`}
      >
        {dragActive ? 'Log Excel dosyasını buraya bırakın (.xlsx / .xlsm)' : 'Excel dosyasını buraya sürükleyin veya tıklayıp seçin. Önizleme onayından önce hiçbir kayıt güncellenmez.'}
      </div>

      {preview ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/45 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="modern-log-import-title">
          <div className="flex max-h-[min(84vh,54rem)] w-full max-w-3xl flex-col overflow-hidden rounded-sg-lg border border-sg-border bg-sg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-sg-border-soft px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Log Excel import — {year}</p>
                <h2 id="modern-log-import-title" className="mt-1 text-lg font-semibold text-sg-text">Değişiklikleri kontrol et</h2>
                <p className="mt-1 text-sm text-sg-text-soft">{fileName || 'Seçilen çalışma kitabı'} henüz uygulanmadı.</p>
              </div>
              <button type="button" onClick={cancelPreview} className="rounded-sg-md border border-sg-border p-2 text-sg-text-soft hover:bg-sg-surface-soft" aria-label="Import önizlemesini kapat"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {blockingErrors.length > 0 ? (
                <div className="rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-4 py-3 text-sm text-sg-red">
                  <p className="font-semibold">Import engellendi</p>
                  {blockingErrors.map((importError) => <p key={importError} className="mt-1">{importError}</p>)}
                </div>
              ) : null}
              {(preview.warnings || []).length > 0 ? (
                <div className="rounded-sg-md border border-sg-amber/40 bg-sg-amber-soft px-4 py-3 text-sm text-sg-amber">
                  <p className="font-semibold">Uyarılar</p>
                  {preview.warnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}
                </div>
              ) : null}
              <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                <p className="text-sm font-semibold text-sg-text">{preview.changes.length} kontrollü değişiklik</p>
                <div className="mt-3 divide-y divide-sg-border-soft">
                  {preview.changes.slice(0, 50).map((change) => (
                    <div key={`${change.sheet}:${change.cell_ref}:${change.label}`} className="grid gap-2 py-3 text-sm sm:grid-cols-[1.2fr_1fr_1fr]">
                      <span className="font-medium text-sg-text">{change.label}</span>
                      <span className="text-sg-text-soft">{change.old_value || '—'}</span>
                      <span className="font-medium text-sg-text">{change.new_value || '—'}</span>
                    </div>
                  ))}
                </div>
                {preview.changes.length > 50 ? <p className="mt-3 text-xs text-sg-text-soft">İlk 50 değişiklik gösteriliyor.</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-sg-border-soft px-5 py-4">
              <button type="button" onClick={cancelPreview} className="inline-flex min-h-9 items-center justify-center rounded-sg-md border border-sg-border px-3.5 text-xs font-medium text-sg-text">Vazgeç</button>
              <button
                type="button"
                onClick={() => void applyImport()}
                disabled={busy || !preview.editable || blockingErrors.length > 0}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-sg-md bg-sg-accent px-3.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {busy ? 'Uygulanıyor' : 'İçe aktar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ModernSection>
  );
}

function readImportError(error: unknown): string {
  return readApiDetail(error, 'Log Excel içe aktarma tamamlanamadı.');
}

function readApiDetail(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback;
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (parsed.detail && typeof parsed.detail === 'object' && 'message' in parsed.detail) {
      return String(parsed.detail.message);
    }
  } catch {
    // apiRequest hata metni zaten kullanıcıya gösterilebilir olabilir.
  }
  return error.message;
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="font-semibold text-sg-text-soft">{label}</dt>
      <dd className="text-right text-sg-text">{value}</dd>
    </div>
  );
}
