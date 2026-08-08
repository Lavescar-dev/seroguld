import { FileSpreadsheet, Loader2, Plus, Printer, RefreshCcw, Search, UserPlus } from 'lucide-react';

import { formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import type { ModernAlisViewModel } from '@/modern/adapters/alis';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';

export function ModernAlisModule({ viewModel }: { viewModel: ModernAlisViewModel }) {
  const { state, phase } = viewModel;
  const workspace = state.workspace;
  const hasWorkspace = Boolean(workspace);
  const activeWorkspace = workspace!;

  return (
    <ModernModuleShell
      eyebrow="Alış / AFG"
      title={hasWorkspace ? `Açık Workspace ${activeWorkspace.session.session_code}` : 'AFG Alış Akışı'}
      subtitle="Gerçek DKK, gram ve AFG numbering semantiğini koruyan modern shell. Liste, draft ve finalize akışı mevcut hook callbacks üstünden çalışır."
      blocker={viewModel.blocker}
      unsupportedControls={viewModel.unsupportedControls}
      badges={
        <>
          <DataPill label="Yüzey" value={state.activeWorkspaceView === 'excel' ? 'Excel' : 'System'} tone={state.activeWorkspaceView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Draft" value={state.draftWorkspace ? state.draftWorkspace.session.session_code : 'Yok'} tone={state.draftWorkspace ? 'warning' : 'neutral'} />
          <DataPill label="Finalize" value={state.finalizePending ? 'Çalışıyor' : 'Hazır'} tone={state.finalizePending ? 'warning' : 'success'} />
        </>
      }
      actions={
        <>
          <button type="button" onClick={state.onStartBlankWorkspace} disabled={state.startPending} className={shellButtonClass('primary')}>
            <Plus className="h-4 w-4" />
            {state.startPending ? 'Hazırlanıyor' : 'Yeni Alış'}
          </button>
          {workspace ? (
            <>
              <button type="button" onClick={state.onOpenWorkspaceExcelPreview} className={shellButtonClass('secondary')}>
                <FileSpreadsheet className="h-4 w-4" />
                Office
              </button>
              <button type="button" onClick={state.onPrintWorkspace} className={shellButtonClass('secondary')}>
                <Printer className="h-4 w-4" />
                Print
              </button>
              <button type="button" onClick={() => void state.onFinalizeWorkspace()} disabled={state.finalizePending} className={shellButtonClass('primary')}>
                {state.finalizePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Finalize
              </button>
            </>
          ) : null}
        </>
      }
    >
      <ModernStatGrid items={hasWorkspace ? viewModel.workspaceSummary : viewModel.documentsSummary} />

      {phase === 'loading' ? <LoadingState label="Alış kayıtları yükleniyor" /> : null}
      {phase === 'empty' ? (
        <EmptyState
          title="Henüz Alış Yok"
          message="AFG listesi boş. İsterseniz yeni alış başlatabilir veya açık draft varsa ona dönebilirsiniz."
          action={
            <button type="button" onClick={state.onStartBlankWorkspace} className={shellButtonClass('primary')}>
              <Plus className="h-4 w-4" />
              Yeni Alış Başlat
            </button>
          }
        />
      ) : null}

      {hasWorkspace ? (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <ModernSection
            title="Müşteri ve Satırlar"
            subtitle="CPR, gram ve teklif alanları mevcut hook state'i ile bağlıdır."
            actions={
              <>
                <button
                  type="button"
                  onClick={() => state.setCustomerMode(state.customerMode === 'new' ? null : 'new')}
                  className={shellButtonClass('secondary')}
                >
                  <UserPlus className="h-4 w-4" />
                  {state.customerMode === 'new' ? 'Yeni Müşteri Gizle' : 'Yeni Müşteri'}
                </button>
                <button type="button" onClick={state.onCancelWorkspace} disabled={state.cancelPending} className={shellButtonClass('danger')}>
                  İptal
                </button>
              </>
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri</p>
                <dl className="mt-3 grid gap-2 text-sm text-sg-text-soft">
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">Ad</dt><dd className="text-right">{activeWorkspace.customer.name || 'Seçilmedi'}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">Telefon</dt><dd className="text-right">{activeWorkspace.customer.phone || '—'}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">CPR</dt><dd className="text-right">{activeWorkspace.customer.cpr_number ? 'Kayıtlı · gizli' : '—'}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">Ödeme</dt><dd className="text-right uppercase">{state.paymentMethod}</dd></div>
                </dl>
              </div>
              <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Numbering ve Banka</p>
                <dl className="mt-3 grid gap-2 text-sm text-sg-text-soft">
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">AFG No</dt><dd className="text-right">{state.numbering.afregnings_number_next || '—'}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">Invoice No</dt><dd className="text-right">{state.numbering.invoice_number_next || '—'}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">Reg</dt><dd className="text-right">{state.bankInfo.reg_number || '—'}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="font-semibold">Konto</dt><dd className="text-right">{state.bankInfo.account_number || '—'}</dd></div>
                </dl>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <EditableRowsCard
                title="Gold Rows"
                rows={state.goldRows.map((row) => ({ key: row.row_key, name: row.label || row.karat || 'Gold', purity: row.purity_percentage, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }))}
                onGramChange={(key, value) => state.onUpdateGoldRow(key, 'gram', value)}
                onAvanceChange={(key, value) => state.onUpdateGoldRow(key, 'avance_percent', value)}
              />
              <EditableRowsCard
                title="Silver Rows"
                rows={state.silverRows.map((row) => ({ key: row.row_key, name: row.label || row.type_code || 'Silver', purity: row.purity_percentage, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }))}
                onGramChange={(key, value) => state.onUpdateSilverRow(key, 'gram', value)}
                onAvanceChange={(key, value) => state.onUpdateSilverRow(key, 'avance_percent', value)}
              />
            </div>
          </ModernSection>

          <ModernSection title="Kayıtlar ve Yardımcı Durumlar" subtitle="Liste, draft resume ve Uniconta durumları gerçek callback'lerle bağlıdır.">
            {state.draftWorkspace ? (
              <div className="rounded-sg-xl border border-sg-amber/20 bg-sg-amber-soft p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-amber">Açık Draft</p>
                    <p className="mt-1 text-sm text-sg-amber">{state.draftWorkspace.session.session_code}</p>
                  </div>
                  <button type="button" onClick={state.onResumeDraft} className={shellButtonClass('secondary')}>
                    Devam Et
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
              <Search className="h-4 w-4 text-sg-text-soft" />
              <input
                value={state.purchaseSearchTerm}
                onChange={(event) => state.setPurchaseSearchTerm(event.target.value)}
                placeholder="Belge no / müşteri ara"
                className="w-full bg-transparent text-sm text-sg-text outline-none"
              />
            </div>

            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-sg-border text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
                    <th className="px-3 py-2">Belge</th>
                    <th className="px-3 py-2">Müşteri</th>
                    <th className="px-3 py-2">Gram</th>
                    <th className="px-3 py-2">DKK</th>
                    <th className="px-3 py-2">Zaman</th>
                    <th className="px-3 py-2">Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {state.documents.slice(0, 8).map((document) => (
                    <tr key={document.sequence_no} className="border-b border-sg-border-soft">
                      <td className="px-3 py-3 font-medium text-sg-text">{document.document_number}</td>
                      <td className="px-3 py-3 text-sg-text-soft">{document.customer_name || '—'}</td>
                      <td className="px-3 py-3 text-sg-text-soft">{formatNumber(document.total_weight_grams, ' g')}</td>
                      <td className="px-3 py-3 text-sg-text-soft">{formatMoney(document.gross_amount_dkk)}</td>
                      <td className="px-3 py-3 text-sg-text-soft">{formatRelativeTime(document.issued_at)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => state.onViewDocument(document)} className={shellButtonClass('ghost')}>Detay</button>
                          <button type="button" onClick={() => state.onOpenDocumentExcelPreview(document)} className={shellButtonClass('ghost')}>Office</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 md:hidden">
              {state.documents.slice(0, 8).map((document) => (
                <div key={document.sequence_no} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Belge</p>
                      <p className="mt-1 text-sm font-semibold text-sg-text">{document.document_number}</p>
                    </div>
                    <span className="text-xs text-sg-text-soft">{formatRelativeTime(document.issued_at)}</span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <MobileRow label="Müşteri" value={document.customer_name || '—'} />
                    <MobileRow label="Gram" value={formatNumber(document.total_weight_grams, ' g')} />
                    <MobileRow label="DKK" value={formatMoney(document.gross_amount_dkk)} />
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => state.onViewDocument(document)} className={shellButtonClass('secondary')}>Detay</button>
                    <button type="button" onClick={() => state.onOpenDocumentExcelPreview(document)} className={shellButtonClass('secondary')}>Office</button>
                  </div>
                </div>
              ))}
            </div>
          </ModernSection>
        </div>
      ) : null}

      {!hasWorkspace && phase === 'ready' ? (
        <ModernSection title="Son Alışlar" subtitle="Responsive belge listesi. Mobilde satırlar etiketli kartlara döner.">
          <div className="mb-4 flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
            <Search className="h-4 w-4 text-sg-text-soft" />
            <input
              value={state.purchaseSearchTerm}
              onChange={(event) => state.setPurchaseSearchTerm(event.target.value)}
              placeholder="Belge no / müşteri ara"
              className="w-full bg-transparent text-sm text-sg-text outline-none"
            />
          </div>
          <div className="grid gap-3 md:hidden">
            {state.documents.map((document) => (
              <div key={document.sequence_no} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
                <p className="text-sm font-semibold text-sg-text">{document.document_number}</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <MobileRow label="Müşteri" value={document.customer_name || '—'} />
                  <MobileRow label="Gram" value={formatNumber(document.total_weight_grams, ' g')} />
                  <MobileRow label="DKK" value={formatMoney(document.gross_amount_dkk)} />
                  <MobileRow label="Zaman" value={formatRelativeTime(document.issued_at)} />
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-sg-border text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
                  <th className="px-3 py-2">Belge</th>
                  <th className="px-3 py-2">Müşteri</th>
                  <th className="px-3 py-2">Gram</th>
                  <th className="px-3 py-2">DKK</th>
                  <th className="px-3 py-2">Zaman</th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((document) => (
                  <tr key={document.sequence_no} className="border-b border-sg-border-soft">
                    <td className="px-3 py-3 font-medium text-sg-text">{document.document_number}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{document.customer_name || '—'}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatNumber(document.total_weight_grams, ' g')}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatMoney(document.gross_amount_dkk)}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{formatRelativeTime(document.issued_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ModernSection>
      ) : null}
    </ModernModuleShell>
  );
}

function EditableRowsCard({
  title,
  rows,
  onGramChange,
  onAvanceChange,
}: {
  title: string;
  rows: Array<{ key: string; name: string; purity: string; gram: string; avance: string; total: string }>;
  onGramChange: (key: string, value: string) => void;
  onAvanceChange: (key: string, value: string) => void;
}) {
  return (
    <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{title}</p>
      <div className="mt-3 grid gap-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-sg-text">{row.name}</p>
                <p className="text-xs text-sg-text-soft">{row.purity || '—'}%</p>
              </div>
              <p className="text-sm font-semibold text-sg-text-soft">{formatMoney(row.total)}</p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-sg-text-soft">
                Gram
                <input value={row.gram} onChange={(event) => onGramChange(row.key, event.target.value)} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none" />
              </label>
              <label className="text-xs font-semibold text-sg-text-soft">
                Avance %
                <input value={row.avance} onChange={(event) => onAvanceChange(row.key, event.target.value)} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none" />
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
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
