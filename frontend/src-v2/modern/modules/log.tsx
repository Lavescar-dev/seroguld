import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, History, List, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, useMemo, useRef, useState } from 'react';

import type { ModernLogViewModel } from '@/modern/adapters/log';
import { LegacyMigrationCenter } from '@/components/LegacyMigrationCenter';
import { formatDate, formatMoney, formatNumber, labelAfgClassification } from '@/lib/format';
import { apiRequest } from '@/lib/api';
import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import { buildBucketGroups, resolveLineDraft, sumLines } from '@/make/log/lineHelpers';
import { classificationOptions, type LineDraft, type MeltLotDraft, type SplitGroupKey } from '@/make/log/types';

import { DataPill, EmptyState, LoadingState, ModernDrawer, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';

const LOT_STATUS_LABEL: Record<string, string> = {
  draft: 'Taslak',
  finalized: 'Kesinleşti',
};

const SPLIT_GROUP_LABEL: Record<SplitGroupKey, string> = {
  jewelry_cleaning: 'Kuyum / temizlik',
  white_gold: 'Beyaz altın',
  separate_storage: 'Ayrı depo',
};

const LOT_DRAFT_FIELDS: Array<{ key: keyof MeltLotDraft; label: string; type: 'date' | 'text' }> = [
  { key: 'sent_date', label: 'Gönderim tarihi', type: 'date' },
  { key: 'purchased_from_date', label: 'Alış başlangıcı', type: 'date' },
  { key: 'after_pure_gold_grams', label: 'Eritme sonrası has (g)', type: 'text' },
  { key: 'insurance_dkk', label: 'Sigorta (DKK)', type: 'text' },
  { key: 'shipping_dkk', label: 'Kargo (DKK)', type: 'text' },
  { key: 'refining_dkk', label: 'Rafinasyon (DKK)', type: 'text' },
  { key: 'sale_date', label: 'Satış tarihi', type: 'date' },
  { key: 'quote_eur', label: 'Fiyat teklifi (EUR)', type: 'text' },
  { key: 'exchange_rate_dkk', label: 'Kur (EUR→DKK)', type: 'text' },
  { key: 'payout_total_dkk', label: 'Toplam ödeme (DKK)', type: 'text' },
];

const LOT_HISTORY_ACTION_LABEL: Record<string, string> = {
  created: 'Oluşturuldu',
  updated: 'Güncellendi',
  finalized: 'Kesinleştirildi',
  reopened: 'Yeniden açıldı',
  deleted: 'Silindi',
  line_added: 'Satır eklendi',
  line_removed: 'Satır çıkarıldı',
};

export function ModernLogModule({ viewModel }: { viewModel: ModernLogViewModel }) {
  const { state } = viewModel;
  const [migrationOpen, setMigrationOpen] = useState(false);
  const bucket = state.activeTab === 'silver' ? state.workspace?.silver : state.workspace?.gold;
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const list: number[] = [];
    for (let y = current; y >= current - 5; y--) list.push(y);
    if (!list.includes(state.selectedYear)) list.unshift(state.selectedYear);
    return list;
  }, [state.selectedYear]);
  const splitSummary = useMemo(() => {
    if (!bucket) return null;
    const groups = buildBucketGroups(bucket.documents, state.lineDrafts);
    return (Object.keys(SPLIT_GROUP_LABEL) as SplitGroupKey[]).map((key) => ({
      key,
      label: SPLIT_GROUP_LABEL[key],
      count: groups[key].length,
      totals: sumLines(groups[key]),
    }));
  }, [bucket, state.lineDrafts]);

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
            subtitle="Satırı yönlendirmek için Depo / Kararsız / Erit'e tıklayın — anında uygulanır."
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
                  <div className="mt-3 grid gap-2">
                    {document.lines.map((line) => {
                      const draft = resolveLineDraft(line, state.lineDrafts);
                      const terminal = line.product_status === 'melted' || line.product_status === 'sold';
                      const dest = line.operation_destination;
                      const routeButton = (destination: LineDraft['destination'], label: string, activeClass: string) => (
                        <button
                          type="button"
                          disabled={state.routeBusy || terminal}
                          onClick={() => state.onRoute(line, destination)}
                          className={`rounded-sg-md border px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${dest === destination ? activeClass : 'border-sg-border bg-sg-surface text-sg-text-soft hover:bg-sg-surface-soft'}`}
                        >
                          {label}
                        </button>
                      );
                      return (
                        <div key={line.id} className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-sg-text">
                              L{line.line_no} · {formatNumber(line.weight_grams, ' g')} · {formatNumber(line.pure_gold_grams, ' has')} · {formatMoney(line.line_total_dkk)}
                            </p>
                            {terminal ? (
                              <span className={`rounded-sg-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${line.product_status === 'melted' ? 'border-sg-red/30 bg-sg-red-soft text-sg-red' : 'border-sg-border bg-sg-surface text-sg-text-soft'}`}>
                                {line.product_status === 'melted' ? 'Eritildi' : 'Satıldı'}
                              </span>
                            ) : (
                              <div className="flex gap-1.5">
                                {routeButton('inventory', 'Depo', 'border-sg-green bg-sg-green-soft text-sg-green-strong')}
                                {routeButton('undecided', 'Kararsız', 'border-sg-amber/50 bg-sg-amber-soft text-sg-amber')}
                                {routeButton('melt', 'Erit', 'border-sg-red/40 bg-sg-red-soft text-sg-red')}
                              </div>
                            )}
                          </div>
                          {!terminal && dest === 'inventory' ? (
                            <label className="mt-2 block text-[11px] font-semibold text-sg-text-soft">Depo sınıfı (değiştirince Depo'ya tekrar basın)
                              <select
                                value={draft.classification}
                                onChange={(event) => state.onDraftChange(line.id, { classification: event.target.value as LineDraft['classification'] })}
                                className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text outline-none"
                              >
                                {classificationOptions.map((option) => (
                                  <option key={option} value={option}>{labelAfgClassification(option)}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {line.is_gdpr_locked ? <p className="mt-2 text-[11px] text-sg-amber">GDPR süresi devam ediyor (bilgi).</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ModernSection>

          <div className="grid gap-4">
          {splitSummary ? (
            <ModernSection title="Ayrıştırma Özeti" subtitle="Depo rotalı satırların sınıfa göre dağılımı (Lager / Hvidguld / Ayrı Depo).">
              <div className="grid gap-2">
                {splitSummary.map((group) => (
                  <div key={group.key} className="flex flex-wrap items-center justify-between gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm">
                    <p className="font-semibold text-sg-text">{group.label} <span className="text-xs text-sg-text-soft">× {group.count}</span></p>
                    <p className="text-xs text-sg-text-soft">
                      {group.totals.weight.toFixed(2)} g · {group.totals.amount.toFixed(0)} kr · <span className="font-semibold text-sg-amber">{group.totals.pure.toFixed(3)} has</span>
                    </p>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2 text-sm font-semibold text-sg-text">
                  <p>Toplam ayrılan</p>
                  <p>
                    {splitSummary.reduce((sum, group) => sum + group.totals.weight, 0).toFixed(2)} g · {splitSummary.reduce((sum, group) => sum + group.totals.amount, 0).toFixed(0)} kr · {splitSummary.reduce((sum, group) => sum + group.totals.pure, 0).toFixed(3)} has
                  </p>
                </div>
              </div>
            </ModernSection>
          ) : null}

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
                          {LOT_STATUS_LABEL[lot.status || 'draft'] || lot.status || 'Taslak'}
                        </span>
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm">
                        <MobileRow label="Eritme öncesi saf" value={formatNumber(lot.before_pure_gold_grams, ' g')} />
                        <MobileRow label="Eritme sonrası saf" value={formatNumber(lot.after_pure_gold_grams, ' g')} />
                        <MobileRow label="Ödeme" value={formatMoney(lot.payout_total_dkk)} />
                        <MobileRow label="Bağlı satır" value={String(lot.line_count || 0)} />
                      </dl>
                      {(() => {
                        const draft = state.lotDrafts[lot.id];
                        if (!draft) return null;
                        return (
                          <fieldset disabled={isFinalized} className="mt-3 grid gap-2 rounded-sg-lg border border-sg-border bg-sg-surface p-3 disabled:opacity-60 sm:grid-cols-2">
                            {LOT_DRAFT_FIELDS.map((field) => (
                              <label key={field.key} className="text-[11px] font-semibold text-sg-text-soft">
                                {field.label}
                                <input
                                  type={field.type}
                                  inputMode={field.type === 'text' ? 'decimal' : undefined}
                                  value={draft[field.key]}
                                  onChange={(event) => state.onLotDraftChange(lot.id, { [field.key]: event.target.value })}
                                  className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text outline-none"
                                />
                              </label>
                            ))}
                            <label className="text-[11px] font-semibold text-sg-text-soft sm:col-span-2">
                              Not
                              <input
                                value={draft.notes}
                                onChange={(event) => state.onLotDraftChange(lot.id, { notes: event.target.value })}
                                className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-xs text-sg-text outline-none"
                                placeholder="Lot notu"
                              />
                            </label>
                          </fieldset>
                        );
                      })()}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => state.onSaveLot(lot.id)} disabled={state.meltBusy} className={shellButtonClass('secondary')}>Kaydet</button>
                        <button type="button" onClick={() => state.onFinalizeLot(lot.id, isFinalized)} disabled={state.finalizeBusy} className={shellButtonClass(isFinalized ? 'secondary' : 'primary')}>
                          {isFinalized ? 'Yeniden aç' : 'Kesinleştir'}
                        </button>
                        <button type="button" onClick={() => state.onOpenLotLines(lot.id)} className={shellButtonClass('ghost')}>
                          <List className="h-4 w-4" />
                          Satırlar
                        </button>
                        <button type="button" onClick={() => state.onDownloadLotPdf(lot.id)} className={shellButtonClass('ghost')}>
                          <Download className="h-4 w-4" />
                          PDF
                        </button>
                        <button type="button" onClick={() => state.onOpenLotHistory(lot.id)} className={shellButtonClass('ghost')}>
                          <History className="h-4 w-4" />
                          Geçmiş
                        </button>
                        {!isFinalized && (lot.line_count || 0) === 0 ? (
                          <button type="button" onClick={() => state.onDeleteLot(lot.id)} disabled={state.deleteBusy} className={shellButtonClass('danger')}>
                            <Trash2 className="h-4 w-4" />
                            Sil
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ModernSection>
          </div>
        </div>
      ) : null}

      {state.historyLotId ? (
        <ModernDrawer title="Lot geçmişi" subtitle={`Lot ${state.historyLotId.slice(0, 8)} · son 50 kayıt`} onClose={state.onCloseLotHistory}>
          {state.lotHistoryLoading ? (
            <LoadingState label="Geçmiş yükleniyor" />
          ) : state.lotHistory.length === 0 ? (
            <EmptyState title="Kayıt yok" message="Bu lot için henüz geçmiş kaydı bulunmuyor." />
          ) : (
            <div className="grid gap-3">
              {state.lotHistory.map((entry) => (
                <div key={entry.id} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-sg-text">{LOT_HISTORY_ACTION_LABEL[entry.action] || entry.action}</p>
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
      ) : null}

      {state.linesLotId ? (
        <ModernDrawer title="Lot satırları" subtitle={`Lot ${state.linesLotId.slice(0, 8)} içindeki AFG kalemleri`} onClose={state.onCloseLotLines}>
          {state.lotLinesLoading ? (
            <LoadingState label="Satırlar yükleniyor" />
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
  const [dragActive, setDragActive] = useState(false);

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await processFile(file);
  }

  async function processFile(file: File) {
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
      ) : null}
      <div
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (busy) return;
          const file = Array.from(event.dataTransfer?.files || []).find((f) => /\.(xlsx|xlsm)$/i.test(f.name));
          if (file) void processFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mt-2 cursor-pointer rounded-sg-md border border-dashed px-4 py-5 text-center text-sm transition ${dragActive ? 'border-sg-accent bg-sg-accent-soft text-sg-accent-dark' : 'border-sg-border text-sg-text-soft hover:bg-sg-surface-soft'}`}
      >
        {dragActive ? 'Log Excel dosyasını buraya bırakın (.xlsx / .xlsm)' : 'Excel dosyasını buraya sürükleyin veya tıklayıp seçin. Onay olmadan hiçbir kayıt güncellenmez.'}
      </div>
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
