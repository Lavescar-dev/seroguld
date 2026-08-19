import { AlertCircle, CheckCircle2, FileSpreadsheet, History, Loader2, Search, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';

import type { ModernLogViewModel } from '@/modern/adapters/log';
import { LegacyMigrationCenter } from '@/components/LegacyMigrationCenter';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { apiRequest } from '@/lib/api';
import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';

export function ModernLogModule({ viewModel }: { viewModel: ModernLogViewModel }) {
  const { state } = viewModel;
  const [migrationOpen, setMigrationOpen] = useState(false);
  const bucket = state.activeTab === 'silver' ? state.workspace?.silver : state.workspace?.gold;

  return (
    <ModernModuleShell
      eyebrow="Log / AFG Defteri"
      title="Route ve Melt Yönetimi"
      subtitle="Altın ve gümüş havuzları, taslak yönlendirme inceleme ve eritme lotu yaşam döngüsü akışlarını mevcut işlem sonucu ile kullanan modern arayüz."
      blocker={viewModel.blocker}
      unsupportedControls={state.activeView === 'excel' ? [] : viewModel.unsupportedControls}
      badges={
        <>
          <DataPill label="Bucket" value={state.activeTab.toUpperCase()} tone={state.activeTab === 'gold' ? 'warning' : 'neutral'} />
          <DataPill label="Görünüm" value={state.activeView === 'excel' ? 'Office' : 'Sistem'} tone={state.activeView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Review" value={state.pendingRouteCount > 0 ? `${state.pendingRouteCount} bekliyor` : 'Temiz'} tone={state.pendingRouteCount > 0 ? 'warning' : 'success'} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => setMigrationOpen(true)} className={shellButtonClass('secondary')}>Eski sistemi taşı</button>
          <button type="button" onClick={() => state.onActiveTabChange('gold')} className={shellButtonClass(state.activeTab === 'gold' ? 'primary' : 'secondary')}>Altın</button>
          <button type="button" onClick={() => state.onActiveTabChange('silver')} className={shellButtonClass(state.activeTab === 'silver' ? 'primary' : 'secondary')}>Gümüş</button>
          <button type="button" onClick={() => state.onActiveViewChange('excel')} className={shellButtonClass('secondary')}>
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

      {bucket ? (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <ModernSection
            title="AFG Belgeleri"
            subtitle="Belgeleri arayın ve satırları hızla yönlendirin."
            actions={
              state.pendingRouteCount > 0 ? (
                <>
                  <button type="button" onClick={state.onDiscardRouteReview} className={shellButtonClass('danger')}>Vazgeç</button>
                  <button type="button" onClick={state.onApplyRouteReview} disabled={state.routeBusy} className={shellButtonClass('primary')}>
                    {state.routeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Apply Review
                  </button>
                </>
              ) : null
            }
          >
            <div className="flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
              <Search className="h-4 w-4 text-sg-text-soft" />
              <input value={state.query} onChange={(event) => state.onQueryChange(event.target.value)} className="w-full bg-transparent text-sm text-sg-text outline-none" placeholder="Belge no / müşteri ara" />
            </div>

            <div className="mt-4 grid gap-3">
              {bucket.documents.map((document) => (
                <div key={document.sequence_no} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-sg-text">{document.document_number}</p>
                      <p className="mt-1 text-xs text-sg-text-soft">{formatDate(document.issued_at)} · {document.customer_name || '—'}</p>
                    </div>
                    <button type="button" onClick={() => state.onToggleDocument(document.sequence_no)} className={shellButtonClass('secondary')}>
                      {state.expandedDocument === document.sequence_no ? 'Kapat' : 'Detay'}
                    </button>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <MobileRow label="Gram" value={formatNumber(document.total_weight_grams, ' g')} />
                    <MobileRow label="Pure" value={formatNumber(document.total_pure_gold_grams, ' g')} />
                    <MobileRow label="DKK" value={formatMoney(document.net_amount_dkk)} />
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {document.lines.map((line) => (
                      <div key={line.id} className="flex flex-wrap gap-2 rounded-full border border-sg-border bg-sg-surface px-3 py-1.5 text-[11px] font-semibold text-sg-text-soft">
                        <span>L{line.line_no}</span>
                        <button type="button" onClick={() => state.onRoute(line, 'inventory')} className="text-sg-green">Depo</button>
                        <button type="button" onClick={() => state.onRoute(line, 'undecided')} className="text-sg-amber">Kararsız</button>
                        <button type="button" onClick={() => state.onRoute(line, 'melt')} className="text-sg-red">Melt</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ModernSection>

          <ModernSection
            title="Melt Lotları"
            subtitle="Kesinleştirme, geçmiş ve satır inceleme işlemleri korunur."
            actions={<button type="button" onClick={state.onCreateMeltLot} disabled={state.createMeltBusy} className={shellButtonClass('primary')}>Yeni Lot</button>}
          >
            <div className="grid gap-3">
              {bucket.melt_lots.length === 0 ? (
                <EmptyState title="Lot Yok" message="Seçili bucket için henüz melt lot oluşturulmadı." />
              ) : (
                bucket.melt_lots.map((lot) => {
                  const isFinalized = lot.status === 'finalized';
                  return (
                    <div key={lot.id} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sg-text">Lot {lot.id.slice(0, 8)}</p>
                          <p className="mt-1 text-xs text-sg-text-soft">{lot.sent_date ? formatDate(lot.sent_date) : 'Gönderim tarihi yok'}</p>
                        </div>
                        <span className="rounded-full border border-sg-border bg-sg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
                          {lot.status || 'draft'}
                        </span>
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm">
                        <MobileRow label="Before Pure" value={formatNumber(lot.before_pure_gold_grams, ' g')} />
                        <MobileRow label="After Pure" value={formatNumber(lot.after_pure_gold_grams, ' g')} />
                        <MobileRow label="Payout" value={formatMoney(lot.payout_total_dkk)} />
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => state.onSaveLot(lot.id)} disabled={state.meltBusy} className={shellButtonClass('secondary')}>Kaydet</button>
                        <button type="button" onClick={() => state.onFinalizeLot(lot.id, isFinalized)} disabled={state.finalizeBusy} className={shellButtonClass(isFinalized ? 'secondary' : 'primary')}>
                          {isFinalized ? 'Yeniden aç' : 'Kesinleştir'}
                        </button>
                        <button type="button" onClick={() => state.onOpenLotHistory(lot.id)} className={shellButtonClass('ghost')}>
                          <History className="h-4 w-4" />
                          History
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ModernSection>
        </div>
      ) : null}
        </>
      )}
    </ModernModuleShell>
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'xlsx' && extension !== 'xlsm') {
      setStatus({ tone: 'error', message: 'Yalnızca .xlsx veya .xlsm Log çalışma kitabı içe aktarılabilir.' });
      return;
    }

    const accepted = window.confirm(
      `${file.name} dosyası ${year} Log çalışma alanına uygulanacak. Bu işlem rota ve lot kayıtlarını değiştirebilir. Devam edilsin mi?`,
    );
    if (!accepted) return;

    setBusy(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.append('workbook', file);
      await apiRequest(`/api/v2/log/workbook/import?year=${encodeURIComponent(String(year))}`, {
        method: 'POST',
        body: formData,
      });
      await onImported();
      setStatus({ tone: 'success', message: `${file.name} içe aktarıldı. Log çalışma alanı yenilendi.` });
    } catch (error) {
      setStatus({ tone: 'error', message: readImportError(error) });
    } finally {
      setBusy(false);
    }
  }

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
            {busy ? 'İçe aktarılıyor' : 'Excel seç ve içe aktar'}
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
      ) : (
        <p className="text-sm text-sg-text-soft">Dosya seçildiğinde önce açık onay istenir; onay olmadan hiçbir kayıt güncellenmez.</p>
      )}
    </ModernSection>
  );
}

function readImportError(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return 'Log Excel içe aktarma tamamlanamadı.';
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
