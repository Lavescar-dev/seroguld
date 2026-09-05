import { useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, Loader2, Pencil, Plus, RotateCcw, Search, ShoppingBag, Trash2, X } from 'lucide-react';

import type { ModernCustomersViewModel } from '@/modern/adapters/customers';
import { formatDate, formatMoney, formatNumber, formatRelativeTime, labelMetalType } from '@/lib/format';
import { deriveCustomersPhase } from '@/make/customers/useCustomersMakeState';
import type { CustomerDraft, CustomerStatusFilter } from '@/make/customers/types';
import type { PosDocumentDetail } from '@/types';
import { CustomerWorkspacePanel } from '@/components/CustomerWorkspacePanel';

import { EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { ModernDrawer } from '@/modern/design-system';

const customerInputClass = 'mt-1 w-full rounded-sg-md border border-sg-amber/20 bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/15';
const customerIconActionClass = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sg-md border border-sg-border bg-sg-surface text-sg-text-soft transition hover:border-sg-accent/35 hover:bg-sg-surface-accent hover:text-sg-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent/30';

function CustomerDraftForm({
  idPrefix,
  title,
  draft,
  onChange,
  onSave,
  onCancel,
  isPending,
}: {
  idPrefix: string;
  title: string;
  draft: CustomerDraft;
  onChange: (field: keyof CustomerDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  // A6-6: isPending hem tıkı hem form submit'ini (Enter) keser; zorunlu alan
  // (ad, en az 2 karakter) dolmadan kaydet kapalıdır.
  const pending = Boolean(isPending);
  const canSave = draft.name.trim().length >= 2;
  const field = (key: keyof CustomerDraft, label: string, type = 'text') => {
    const id = `${idPrefix}-${key}`;
    return (
      <label htmlFor={id} className="text-xs font-semibold text-sg-amber">
        {label}
        <input id={id} name={key} type={type} value={draft[key]} onChange={(event) => onChange(key, event.target.value)} className={customerInputClass} />
      </label>
    );
  };
  return (
    <form
      className="mt-4 grid gap-3 rounded-sg-xl border border-sg-amber/20 bg-sg-amber-soft p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && canSave) onSave();
      }}
    >
      <div className="sm:col-span-2"><p className="text-sm font-semibold text-sg-text">{title}</p></div>
      {field('name', 'Ad soyad')}
      {field('phone', 'Telefon', 'tel')}
      {field('email', 'E-posta', 'email')}
      {field('address', 'Adres')}
      {field('postal_code', 'Posta kodu')}
      {field('cpr_number', 'CPR')}
      <label htmlFor={`${idPrefix}-identity_doc_type`} className="text-xs font-semibold text-sg-amber">
        Kimlik belge türü
        <select id={`${idPrefix}-identity_doc_type`} name="identity_doc_type" value={draft.identity_doc_type} onChange={(event) => onChange('identity_doc_type', event.target.value)} className={customerInputClass}>
          <option value="">Seçilmedi</option>
          <option value="driver_license">Sürücü belgesi</option>
          <option value="passport">Pasaport</option>
          <option value="id_card">Kimlik kartı</option>
        </select>
      </label>
      {field('identity_doc_number', 'Belge numarası')}
      <div className="flex items-end justify-between gap-2 sm:col-span-2">
        {!canSave ? <p className="text-xs text-sg-text-soft">Ad soyad zorunludur.</p> : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className={shellButtonClass('secondary')}><X className="h-4 w-4" />Vazgeç</button>
          <button type="submit" disabled={pending || !canSave} className={shellButtonClass('primary')}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {pending ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </form>
  );
}

export function ModernCustomersModule({ viewModel }: { viewModel: ModernCustomersViewModel }) {
  const { state } = viewModel;
  const selected = state.selectedCustomer;
  const selectedPanelRef = useRef<HTMLDivElement | null>(null);
  const selectedId = state.selectedId ?? null;
  // A6-5: loading / empty / no-results / ready — "veri yok" ile "veri alınamadı" ayrışır.
  const phase = deriveCustomersPhase(state);
  useEffect(() => {
    // "Seç" panele odak: seçim küçük ekranlarda görünmeden değişebiliyordu.
    if (selectedId) selectedPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedId]);

  return (
    <ModernModuleShell
      eyebrow="Müşteriler"
      title="Müşteri Yönetimi"
      subtitle="Müşteri kayıtlarını arayın, seçin ve geçmiş belgeleriyle birlikte yönetin."
      actions={
        <button type="button" onClick={state.onToggleNewRow} className={shellButtonClass('primary')}>
          <Plus className="h-4 w-4" />
          {state.showNewRow ? 'Formu Gizle' : 'Yeni Müşteri'}
        </button>
      }
    >
      <ModernStatGrid items={viewModel.stats} />

      {state.customersError ? (
        <div className="rounded-sg-lg border border-sg-red/30 bg-sg-red-soft px-4 py-3">
          <p className="text-sm font-semibold text-sg-red">Müşteriler yüklenemedi</p>
          <p className="mt-1 text-xs text-sg-text-soft">Bağlantı sorunu olabilir; listeyi tekrar çekmeyi deneyin.</p>
          <button type="button" onClick={state.onRetryCustomers} disabled={state.customersLoading} className={`${shellButtonClass('secondary')} mt-2`}>
            Tekrar dene
          </button>
        </div>
      ) : null}

      {phase === 'loading' ? <LoadingState label="Müşteriler yükleniyor" /> : null}
      {phase === 'empty' ? (
        <EmptyState title="Müşteri Yok" message="Henüz müşteri kaydı bulunmuyor. Yeni müşteri formunu açıp ilk kaydı ekleyebilirsiniz." />
      ) : null}
      {phase === 'no-results' ? (
        <EmptyState title="Sonuç Bulunamadı" message={`"${state.search.trim()}" aramasıyla eşleşen müşteri yok.`} />
      ) : null}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <ModernSection title="Müşteri listesi" subtitle="Kayıtları arayın, seçin veya müşteri bilgilerini yönetin.">
          <div className="flex min-h-11 items-center gap-3 rounded-sg-md border border-sg-border bg-sg-surface px-3.5 shadow-sm transition focus-within:border-sg-accent focus-within:ring-2 focus-within:ring-sg-accent/10">
            <Search className="h-4 w-4 text-sg-text-soft" />
            <input
              value={state.search}
              onChange={(event) => state.onSearchChange(event.target.value)}
              placeholder="Ad, CPR veya telefon ara"
              className="w-full bg-transparent text-sm text-sg-text outline-none"
            />
          </div>

          {/* A6-3: pasif müşteriler filtresi — pasif kayıtlar listede soluk görünür. */}
          <div className="mt-3 flex items-center gap-1" role="group" aria-label="Müşteri durum filtresi">
            {([['active', 'Aktif'], ['inactive', 'Pasif'], ['all', 'Tümü']] as Array<[CustomerStatusFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={state.customerStatus === value}
                onClick={() => state.onCustomerStatusChange(value)}
                className={state.customerStatus === value ? 'rounded-full bg-sg-accent px-3 py-1.5 text-xs font-semibold text-white' : 'rounded-full border border-sg-border px-3 py-1.5 text-xs text-sg-text-soft transition hover:bg-sg-surface-soft'}
              >
                {label}
              </button>
            ))}
          </div>

          {state.showNewRow ? <CustomerDraftForm idPrefix="new-customer" title="Yeni müşteri" draft={state.newDraft} onChange={state.onNewDraftChange} onSave={state.onSaveNew} onCancel={state.onToggleNewRow} isPending={state.isSavingNew} /> : null}
          {state.editingId ? <CustomerDraftForm idPrefix={`edit-customer-${state.editingId}`} title="Müşteriyi düzenle" draft={state.editDraft} onChange={state.onEditDraftChange} onSave={() => state.onSaveEdit(state.editingId!)} onCancel={state.onCancelEdit} isPending={state.isUpdatingCustomer} /> : null}

          <div className="mt-4 hidden overflow-hidden rounded-sg-lg border border-sg-border lg:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[17%]" />
                <col className="w-[19%]" />
                <col className="w-[26%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-sg-border bg-sg-surface-soft text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-sg-text-soft">
                  <th className="px-4 py-3">Müşteri</th>
                  <th className="px-3 py-3">CPR</th>
                  <th className="px-3 py-3">Telefon</th>
                  <th className="px-3 py-3">E-posta</th>
                  <th className="px-3 py-3 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {state.customers.map((customer) => {
                  const isSelected = customer.id === state.selectedId;
                  const isRowDeleting = state.deletingId === customer.id;
                  const isRowReactivating = state.reactivatingId === customer.id;
                  return (
                    <tr key={customer.id} className={`border-b border-sg-border-soft transition last:border-b-0 hover:bg-sg-surface-soft ${isSelected ? 'bg-sg-surface-accent shadow-[inset_3px_0_0_var(--sg-accent)]' : ''} ${!customer.is_active && !isSelected ? 'opacity-60 saturate-50' : ''}`}>
                      <td className="px-4 py-3.5 font-semibold text-sg-text"><span className="block truncate" title={customer.name || undefined}>{customer.name || '—'}{!customer.is_active ? <span className="ml-2 rounded-full border border-sg-border bg-sg-surface px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-text-soft">Pasif</span> : null}</span></td>
                      <td className="px-3 py-3.5 font-mono text-xs tabular-nums text-sg-text">{customer.cpr_number || customer.cpr_number_masked || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-sg-text-soft">{customer.phone || '—'}</td>
                      <td className="px-3 py-3.5 text-sg-text-soft"><span className="block truncate" title={customer.email || undefined}>{customer.email || '—'}</span></td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button type="button" onClick={() => state.onSelectCustomer(customer.id)} className={shellButtonClass(isSelected ? 'secondary' : 'ghost')}>{isSelected ? 'Seçili' : 'Seç'}</button>
                          <button type="button" title="Düzenle" aria-label={`${customer.name || 'Müşteri'} düzenle`} onClick={() => state.onStartEdit(customer)} className={customerIconActionClass}><Pencil className="h-3.5 w-3.5" /></button>
                          {!customer.is_active ? (
                            <button type="button" title="Yeniden aktifleştir" aria-label={`${customer.name || 'Müşteri'} yeniden aktifleştir`} onClick={() => state.onReactivate(customer)} disabled={isRowReactivating} className={customerIconActionClass}>
                              <RotateCcw className={`h-3.5 w-3.5 ${isRowReactivating ? 'animate-spin' : ''}`} />
                            </button>
                          ) : (
                            <button type="button" title="Pasife al" aria-label={`${customer.name || 'Müşteri'} pasife al`} disabled={isRowDeleting} onClick={() => { if (window.confirm(`${customer.name || 'Bu müşteri'} pasife alınsın mı?`)) state.onDelete(customer); }} className={customerIconActionClass}>
                              <Trash2 className={`h-3.5 w-3.5 ${isRowDeleting ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 lg:hidden">
            {state.customers.map((customer) => {
              const isSelected = customer.id === state.selectedId;
              const isRowDeleting = state.deletingId === customer.id;
              const isRowReactivating = state.reactivatingId === customer.id;
              return (
                <article key={customer.id} className={`rounded-sg-lg border bg-sg-surface p-4 shadow-sm ${isSelected ? 'border-sg-accent/45 ring-2 ring-sg-accent/10' : 'border-sg-border'} ${!customer.is_active && !isSelected ? 'opacity-60 saturate-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-sg-text">{customer.name || '—'}</p>
                      <p className="mt-1 font-mono text-xs tabular-nums text-sg-text-soft">{customer.cpr_number || customer.cpr_number_masked || 'CPR yok'}</p>
                    </div>
                    {isSelected ? <span className="rounded-full bg-sg-surface-accent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-accent-dark">Seçili</span> : null}
                    {!customer.is_active ? <span className="rounded-full border border-sg-border bg-sg-surface-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-text-soft">Pasif</span> : null}
                  </div>
                  <dl className="mt-4 grid gap-2 border-t border-sg-border-soft pt-3 text-sm sm:grid-cols-2">
                    <MobileRow label="Telefon" value={customer.phone || '—'} />
                    <MobileRow label="E-posta" value={customer.email || '—'} />
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-sg-border-soft pt-3">
                    <button type="button" onClick={() => state.onSelectCustomer(customer.id)} className={shellButtonClass(isSelected ? 'secondary' : 'primary')}>{isSelected ? 'Seçili müşteri' : 'Müşteriyi seç'}</button>
                    <button type="button" aria-label={`${customer.name || 'Müşteri'} düzenle`} onClick={() => state.onStartEdit(customer)} className={customerIconActionClass}><Pencil className="h-3.5 w-3.5" /></button>
                    {!customer.is_active ? (
                      <button type="button" aria-label={`${customer.name || 'Müşteri'} yeniden aktifleştir`} onClick={() => state.onReactivate(customer)} disabled={isRowReactivating} className={customerIconActionClass}>
                        <RotateCcw className={`h-3.5 w-3.5 ${isRowReactivating ? 'animate-spin' : ''}`} />
                      </button>
                    ) : (
                      <button type="button" aria-label={`${customer.name || 'Müşteri'} pasife al`} disabled={isRowDeleting} onClick={() => { if (window.confirm(`${customer.name || 'Bu müşteri'} pasife alınsın mı?`)) state.onDelete(customer); }} className={customerIconActionClass}>
                        <Trash2 className={`h-3.5 w-3.5 ${isRowDeleting ? 'animate-pulse' : ''}`} />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {!state.search && state.customerTotalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-sg-border pt-3">
              <p className="text-xs text-sg-text-soft">
                {(state.customerPage - 1) * state.customerPageSize + 1}–{Math.min(state.customerPage * state.customerPageSize, state.totalCustomers)} / {state.totalCustomers}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => state.onCustomerPageChange(state.customerPage - 1)}
                  disabled={state.customerPage <= 1}
                  className={shellButtonClass('secondary')}
                >
                  Önceki
                </button>
                <span className="text-xs font-semibold text-sg-text-soft">{state.customerPage} / {state.customerTotalPages}</span>
                <button
                  type="button"
                  onClick={() => state.onCustomerPageChange(state.customerPage + 1)}
                  disabled={state.customerPage >= state.customerTotalPages}
                  className={shellButtonClass('secondary')}
                >
                  Sonraki
                </button>
              </div>
            </div>
          ) : null}
        </ModernSection>

        <ModernSection title="Seçili Müşteri" subtitle="AFG geçmişi ve önizleme işlemleri bu panelde tutulur.">
          <div ref={selectedPanelRef} />
          {!selected ? (
            <EmptyState title="Müşteri Seçilmedi" message="Listeden bir müşteri seçildiğinde geçmiş belgeler ve detay özetleri burada görünür." />
          ) : (
            <>
              <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Kimlik</p>
                    <p className="mt-1 text-lg font-semibold text-sg-text">{selected.name || '—'}</p>
                    <p className="mt-1 text-sm text-sg-text-soft">{selected.phone || '—'} · {selected.email || '—'}</p>
                  </div>
                  <span className="rounded-full border border-sg-border bg-sg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
                    {formatDate(selected.created_at)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">CPR / Belge</p>
                    <p className="mt-1 font-mono text-sm tabular-nums text-sg-text">{selected.cpr_number || selected.cpr_number_masked || '—'}</p>
                    <p className="mt-1 text-xs text-sg-text-soft">{selected.identity_doc_number_masked || (selected.identity_doc_number ? 'Kayıtlı · gizli' : '—')}</p>
                  </div>
                  <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Geçmiş Özeti</p>
                    <p className="mt-1 text-sm text-sg-text">{state.historySummary.count} belge</p>
                    <p className="mt-1 text-xs text-sg-text-soft">{formatMoney(state.historySummary.total)}</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => { window.location.hash = `/?customer=${encodeURIComponent(selected.id)}`; }}
                    className={shellButtonClass('primary')}
                  >
                    <ShoppingBag className="h-4 w-4" />Alış başlat
                  </button>
                </div>
              </div>

              <CustomerWorkspacePanel customerId={selected.id} customerName={selected.name || 'Müşteri'} />

              <div className="mt-4 grid gap-3">
                {/* A6-5: geçmiş sorgusu hata + ortak retry; "kayıt yok" ile karışmaz. */}
                {state.isHistoryError ? (
                  <div className="rounded-sg-lg border border-sg-red/30 bg-sg-red-soft px-4 py-3 text-center">
                    <p className="text-sm font-semibold text-sg-red">Alış geçmişi yüklenemedi</p>
                    <button type="button" onClick={() => state.onRetryDocumentQuery('history')} disabled={state.isHistoryLoading} className={`${shellButtonClass('secondary')} mt-2`}>
                      Tekrar dene
                    </button>
                  </div>
                ) : null}
                {!state.isHistoryError && state.isHistoryLoading && !state.historyItems.length ? (
                  <LoadingState label="Alış geçmişi yükleniyor" />
                ) : null}
                {state.historyItems.map((item) => {
                  const isExpanded = state.expandedSequenceNo === item.sequence_no;
                  const isPreviewPending = state.previewLoading && state.previewSequenceNo === item.sequence_no;
                  return (
                    <div key={item.sequence_no} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-sg-text">{item.document_number}</p>
                          <p className="mt-1 text-xs text-sg-text-soft">{formatRelativeTime(item.issued_at)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => state.onToggleHistory(item.sequence_no)} className={shellButtonClass('ghost')}>
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            Detay
                          </button>
                          <button type="button" onClick={() => state.onPreviewOpen(item.sequence_no)} disabled={isPreviewPending} className={shellButtonClass('secondary')}>
                            {isPreviewPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                            Önizleme
                          </button>
                        </div>
                      </div>
                      <dl className="mt-3 grid gap-2 text-sm">
                        <MobileRow label="DKK" value={formatMoney(item.gross_amount_dkk)} />
                        <MobileRow label="Gram" value={item.total_weight_grams || '—'} />
                        <MobileRow label="Log" value={state.historyLogMeta[item.sequence_no]?.inLog ? 'Var' : 'Yok'} />
                      </dl>
                      {isExpanded ? (
                        <div className="mt-3 border-t border-sg-border pt-3">
                          {state.expandedDetailError ? (
                            <div>
                              <p className="text-sm font-semibold text-sg-red">Belge detayı yüklenemedi.</p>
                              <button type="button" onClick={() => state.onRetryDocumentQuery('expanded-detail')} disabled={state.expandedDetailLoading} className={`${shellButtonClass('secondary')} mt-2`}>
                                Tekrar dene
                              </button>
                            </div>
                          ) : !state.expandedDetail ? (
                            <p className="text-sm text-sg-text-soft">Belge detayı yükleniyor…</p>
                          ) : state.expandedDetail.lines.length === 0 ? (
                            <p className="text-sm text-sg-text-soft">Bu belgede ürün satırı yok.</p>
                          ) : (
                            <div className="grid gap-2">
                              {state.expandedDetail.lines.map((line) => (
                                <div key={line.id} className="rounded-sg-md border border-sg-border bg-sg-surface p-3 text-sm">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="font-semibold text-sg-text">
                                      L{line.line_no} · {line.product_number || line.reference_number || line.product_type || 'Kalem'}
                                    </p>
                                    <p className="font-semibold text-sg-text">{formatMoney(line.line_total_dkk)}</p>
                                  </div>
                                  <p className="mt-1 text-xs text-sg-text-soft">
                                    {labelMetalType(line.metal_type)}
                                    {line.weight_grams ? ` · ${formatNumber(line.weight_grams, ' g')}` : ''}
                                    {line.purity_karat ? ` · ${line.purity_karat}K` : ''}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </ModernSection>
      </div>

      {state.previewSequenceNo !== null ? (
        <ModernAfgPreviewDrawer
          sequenceNo={state.previewSequenceNo}
          detail={state.previewDetail}
          loading={state.previewLoading}
          error={state.previewError}
          onRetry={() => state.onRetryDocumentQuery('preview')}
          onClose={state.onPreviewClose}
        />
      ) : null}
    </ModernModuleShell>
  );
}

function ModernAfgPreviewDrawer({
  sequenceNo,
  detail,
  loading,
  error,
  onRetry,
  onClose,
}: {
  sequenceNo: number;
  detail: PosDocumentDetail | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <ModernDrawer
      // A6-7: drawer detay gelene kadar da AÇIKTIR — loading/error yüzeyiyle;
      // hata sessiz kalmaz, Önceki "detay yok → drawer hiç açılmıyor" tuzağı bitti.
      open
      title={detail?.document_number || `Belge önizleme #${sequenceNo}`}
      description={detail ? `${formatDate(detail.issued_at)} · ${detail.customer_name || '—'}` : undefined}
      onClose={onClose}
    >
      {error ? (
        <div className="rounded-sg-lg border border-sg-red/30 bg-sg-red-soft p-4 text-center">
          <p className="text-sm font-semibold text-sg-red">Belge yüklenemedi</p>
          <p className="mt-1 text-xs text-sg-text-soft">Belge detayı alınırken bir sorun oluştu.</p>
          <button type="button" onClick={onRetry} disabled={loading} className={`${shellButtonClass('secondary')} mt-2`}>
            Tekrar dene
          </button>
        </div>
      ) : loading || !detail ? (
        <LoadingState label="Belge yükleniyor" />
      ) : (
        <>
          <div className="grid gap-2 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-3 text-sm">
            <MobileRow label="Toplam" value={formatMoney(detail.gross_amount_dkk)} />
            <MobileRow label="Gram" value={detail.total_weight_grams ? formatNumber(detail.total_weight_grams, ' g') : '—'} />
            <MobileRow label="Ödeme" value={detail.payment_method === 'bank' ? 'Banka' : '—'} />
          </div>
          <div className="mt-3 grid gap-2">
            {detail.lines.length === 0 ? (
              <p className="text-sm text-sg-text-soft">Bu belgede ürün satırı yok.</p>
            ) : (
              detail.lines.map((line) => (
                <div key={line.id} className="rounded-sg-md border border-sg-border bg-sg-surface p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-sg-text">
                      L{line.line_no} · {line.product_number || line.reference_number || line.product_type || 'Kalem'}
                    </p>
                    <p className="font-semibold text-sg-text">{formatMoney(line.line_total_dkk)}</p>
                  </div>
                  <p className="mt-1 text-xs text-sg-text-soft">
                    {labelMetalType(line.metal_type)}
                    {line.weight_grams ? ` · ${formatNumber(line.weight_grams, ' g')}` : ''}
                    {line.purity_karat ? ` · ${line.purity_karat}K` : ''}
                  </p>
                </div>
              ))
            )}
          </div>
          {detail.notes ? <p className="mt-3 rounded-sg-md border border-sg-border bg-sg-surface-soft p-3 text-sm text-sg-text">{detail.notes}</p> : null}
        </>
      )}
    </ModernDrawer>
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
