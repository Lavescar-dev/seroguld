import { CheckCircle2, FileSpreadsheet, History, Loader2, Search } from 'lucide-react';

import type { ModernLogViewModel } from '@/modern/adapters/log';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';

export function ModernLogModule({ viewModel }: { viewModel: ModernLogViewModel }) {
  const { state } = viewModel;
  const bucket = state.activeTab === 'silver' ? state.workspace?.silver : state.workspace?.gold;

  return (
    <ModernModuleShell
      eyebrow="Log / AFG Defteri"
      title="Route ve Melt Yönetimi"
      subtitle="Altın ve gümüş bucket'ları, draft route review ve melt lot lifecycle akışlarını mevcut hook sonucu ile kullanan modern shell."
      blocker={viewModel.blocker}
      unsupportedControls={viewModel.unsupportedControls}
      badges={
        <>
          <DataPill label="Bucket" value={state.activeTab.toUpperCase()} tone={state.activeTab === 'gold' ? 'warning' : 'neutral'} />
          <DataPill label="View" value={state.activeView === 'excel' ? 'Office' : 'System'} tone={state.activeView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Review" value={state.pendingRouteCount > 0 ? `${state.pendingRouteCount} bekliyor` : 'Temiz'} tone={state.pendingRouteCount > 0 ? 'warning' : 'success'} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => state.onActiveTabChange('gold')} className={shellButtonClass(state.activeTab === 'gold' ? 'primary' : 'secondary')}>Gold</button>
          <button type="button" onClick={() => state.onActiveTabChange('silver')} className={shellButtonClass(state.activeTab === 'silver' ? 'primary' : 'secondary')}>Silver</button>
          <button type="button" onClick={() => state.onActiveViewChange('excel')} className={shellButtonClass('secondary')}>
            <FileSpreadsheet className="h-4 w-4" />
            Office
          </button>
        </>
      }
    >
      <ModernStatGrid items={viewModel.stats} />

      {viewModel.phase === 'loading' ? <LoadingState label="Log workspace yükleniyor" /> : null}
      {viewModel.phase === 'error' ? <EmptyState title="Workspace Hatası" message="Log workspace alınamadı. Mevcut retry callback route wrapper tarafından tekrar çağrılmalı." action={<button type="button" onClick={state.onRetryWorkspace} className={shellButtonClass('primary')}>Tekrar Dene</button>} /> : null}
      {viewModel.phase === 'empty' ? <EmptyState title="Belge Yok" message="Seçili bucket için route edilecek veya melt'e gidecek belge bulunmuyor." /> : null}

      {bucket ? (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <ModernSection
            title="AFG Belgeleri"
            subtitle="Responsive belge listesi ve hızlı rota aksiyonları."
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
                    {document.lines.slice(0, 3).map((line) => (
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
            subtitle="Finalize, history ve line inceleme callback'leri korunur."
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
                          {isFinalized ? 'Reopen' : 'Finalize'}
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
    </ModernModuleShell>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="font-semibold text-sg-text-soft">{label}</dt>
      <dd className="text-right text-sg-text">{value}</dd>
    </div>
  );
}
