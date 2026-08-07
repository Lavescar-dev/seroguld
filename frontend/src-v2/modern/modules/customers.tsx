import { Check, Eye, Plus, Search } from 'lucide-react';

import type { ModernCustomersViewModel } from '@/modern/adapters/customers';
import { formatDate, formatMoney, formatRelativeTime } from '@/lib/format';

import { EmptyState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';

export function ModernCustomersModule({ viewModel }: { viewModel: ModernCustomersViewModel }) {
  const { state } = viewModel;
  const selected = state.selectedCustomer;

  return (
    <ModernModuleShell
      eyebrow="Müşteriler"
      title="Müşteri Yönetimi"
      subtitle="Arama, seçim, geçmiş ve AFG önizleme akışlarını mevcut müşteri hook sözleşmesiyle kullanan light modern yüzey."
      actions={
        <button type="button" onClick={state.onToggleNewRow} className={shellButtonClass('primary')}>
          <Plus className="h-4 w-4" />
          {state.showNewRow ? 'Formu Gizle' : 'Yeni Müşteri'}
        </button>
      }
    >
      <ModernStatGrid items={viewModel.stats} />

      {viewModel.phase === 'empty' ? (
        <EmptyState title="Müşteri Yok" message="Henüz müşteri kaydı bulunmuyor. Yeni müşteri formunu açıp ilk kaydı ekleyebilirsiniz." />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <ModernSection title="Liste" subtitle="Mobilde etiketli kart, masaüstünde tablo düzeni kullanılır.">
          <div className="flex items-center gap-2 rounded-[18px] border border-brand-200 bg-stone-50 px-3 py-2">
            <Search className="h-4 w-4 text-brand-400" />
            <input
              value={state.search}
              onChange={(event) => state.onSearchChange(event.target.value)}
              placeholder="Ad, CPR veya telefon ara"
              className="w-full bg-transparent text-sm text-brand-900 outline-none"
            />
          </div>

          {state.showNewRow ? (
            <div className="mt-4 grid gap-3 rounded-[20px] border border-amber-300 bg-amber-50 p-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-amber-900">Ad
                <input value={state.newDraft.name} onChange={(event) => state.onNewDraftChange('name', event.target.value)} className="mt-1 w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-brand-900 outline-none" />
              </label>
              <label className="text-xs font-semibold text-amber-900">Telefon
                <input value={state.newDraft.phone} onChange={(event) => state.onNewDraftChange('phone', event.target.value)} className="mt-1 w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-brand-900 outline-none" />
              </label>
              <label className="text-xs font-semibold text-amber-900">CPR
                <input value={state.newDraft.cpr_number} onChange={(event) => state.onNewDraftChange('cpr_number', event.target.value)} className="mt-1 w-full rounded-2xl border border-amber-200 bg-white px-3 py-2 text-sm text-brand-900 outline-none" />
              </label>
              <div className="flex items-end justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={state.onToggleNewRow} className={shellButtonClass('secondary')}>Vazgeç</button>
                <button type="button" onClick={state.onSaveNew} className={shellButtonClass('primary')}>
                  <Check className="h-4 w-4" />
                  Kaydet
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-brand-200 text-left text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">
                  <th className="px-3 py-2">Ad</th>
                  <th className="px-3 py-2">CPR</th>
                  <th className="px-3 py-2">Telefon</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {state.customers.map((customer) => {
                  const isSelected = customer.id === state.selectedId;
                  return (
                    <tr key={customer.id} className={`border-b border-brand-100 ${isSelected ? 'bg-brand-50' : ''}`}>
                      <td className="px-3 py-3 font-black text-brand-950">{customer.name || '—'}</td>
                      <td className="px-3 py-3 text-brand-700">{customer.cpr_number_masked || (customer.cpr_number ? 'Kayıtlı · gizli' : '—')}</td>
                      <td className="px-3 py-3 text-brand-700">{customer.phone || '—'}</td>
                      <td className="px-3 py-3 text-brand-700">{customer.email || '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => state.onSelectCustomer(customer.id)} className={shellButtonClass('ghost')}>Seç</button>
                          <button type="button" onClick={() => state.onStartEdit(customer)} className={shellButtonClass('ghost')}>Düzenle</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 md:hidden">
            {state.customers.map((customer) => (
              <button key={customer.id} type="button" onClick={() => state.onSelectCustomer(customer.id)} className="rounded-[18px] border border-brand-200 bg-stone-50 p-4 text-left">
                <p className="text-sm font-black text-brand-950">{customer.name || '—'}</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <MobileRow label="CPR" value={customer.cpr_number_masked || (customer.cpr_number ? 'Kayıtlı · gizli' : '—')} />
                  <MobileRow label="Telefon" value={customer.phone || '—'} />
                  <MobileRow label="Email" value={customer.email || '—'} />
                </dl>
              </button>
            ))}
          </div>
        </ModernSection>

        <ModernSection title="Seçili Müşteri" subtitle="AFG geçmişi ve preview aksiyonları bu panelde tutulur.">
          {!selected ? (
            <EmptyState title="Müşteri Seçilmedi" message="Listeden bir müşteri seçildiğinde geçmiş belgeler ve detay özetleri burada görünür." />
          ) : (
            <>
              <div className="rounded-[20px] border border-brand-200 bg-stone-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-500">Kimlik</p>
                    <p className="mt-1 text-lg font-black text-brand-950">{selected.name || '—'}</p>
                    <p className="mt-1 text-sm text-brand-600">{selected.phone || '—'} · {selected.email || '—'}</p>
                  </div>
                  <span className="rounded-full border border-brand-200 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-brand-600">
                    {formatDate(selected.created_at)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-brand-200 bg-white p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">CPR / Belge</p>
                    <p className="mt-1 text-sm text-brand-800">{selected.cpr_number_masked || (selected.cpr_number ? 'Kayıtlı · gizli' : '—')}</p>
                    <p className="mt-1 text-xs text-brand-500">{selected.identity_doc_number_masked || (selected.identity_doc_number ? 'Kayıtlı · gizli' : '—')}</p>
                  </div>
                  <div className="rounded-[18px] border border-brand-200 bg-white p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-500">Geçmiş Özeti</p>
                    <p className="mt-1 text-sm text-brand-800">{state.historySummary.count} belge</p>
                    <p className="mt-1 text-xs text-brand-500">{formatMoney(state.historySummary.total)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {state.historyItems.map((item) => (
                  <div key={item.sequence_no} className="rounded-[18px] border border-brand-200 bg-stone-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-black text-brand-950">{item.document_number}</p>
                        <p className="mt-1 text-xs text-brand-500">{formatRelativeTime(item.issued_at)}</p>
                      </div>
                      <button type="button" onClick={() => state.onPreviewOpen(item.sequence_no)} className={shellButtonClass('secondary')}>
                        <Eye className="h-4 w-4" />
                        Preview
                      </button>
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <MobileRow label="DKK" value={formatMoney(item.gross_amount_dkk)} />
                      <MobileRow label="Gram" value={item.total_weight_grams || '—'} />
                      <MobileRow label="Log" value={state.historyLogMeta[item.sequence_no]?.inLog ? 'Var' : 'Yok'} />
                    </dl>
                  </div>
                ))}
              </div>
            </>
          )}
        </ModernSection>
      </div>
    </ModernModuleShell>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="font-semibold text-brand-500">{label}</dt>
      <dd className="text-right text-brand-900">{value}</dd>
    </div>
  );
}
