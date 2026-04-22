import type { ReactNode } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileText,
  IdCard,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { openAuthedDocument } from '@/lib/api';
import {
  formatDate,
  formatMoney,
  formatNumber,
  labelProductType,
} from '@/lib/format';
import type { CustomerOut, PosDocumentDetail, PosDocumentListItem } from '@/types';

import type { CustomerDraft, CustomerHistoryLogMeta, CustomersPageProps } from './types';

const cellInput =
  'w-full border border-brand-300 bg-white px-2 py-1 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50';

const AVATAR_COLORS = [
  'bg-amber-600',
  'bg-brand-700',
  'bg-emerald-700',
  'bg-sky-700',
  'bg-rose-700',
  'bg-violet-700',
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts.at(-1)?.slice(0, 1) || ''}`.toUpperCase();
}

function labelIdentityDocType(value?: string | null) {
  switch (value) {
    case 'driver_license':
      return 'Korekort';
    case 'passport':
      return 'Pas';
    case 'id_card':
      return 'Kimlik';
    default:
      return '-';
  }
}

function LabelCell({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap border border-brand-300 bg-brand-100 px-3 py-3 text-left text-xs font-black uppercase tracking-wider text-brand-700">
      {children}
    </th>
  );
}

function DraftRow({
  draft,
  onChange,
  onSave,
  onCancel,
  saveLabel,
}: {
  draft: CustomerDraft;
  onChange: (field: keyof CustomerDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <tr className="bg-amber-50">
      <td className="border border-brand-300 px-3 py-2 text-center text-xs font-bold text-brand-600">+</td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input value={draft.name} onChange={(event) => onChange('name', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input value={draft.cpr_number} onChange={(event) => onChange('cpr_number', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input value={draft.phone} onChange={(event) => onChange('phone', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input value={draft.email} onChange={(event) => onChange('email', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input value={draft.address} onChange={(event) => onChange('address', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input value={draft.postal_code} onChange={(event) => onChange('postal_code', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <div className="grid gap-1">
          <select value={draft.identity_doc_type} onChange={(event) => onChange('identity_doc_type', event.target.value)} className={cellInput}>
            <option value="">Belge tipi</option>
            <option value="driver_license">Korekort</option>
            <option value="passport">Pas</option>
            <option value="id_card">Kimlik</option>
          </select>
          <input
            value={draft.identity_doc_number}
            onChange={(event) => onChange('identity_doc_number', event.target.value)}
            className={cellInput}
            placeholder="Belge no"
          />
        </div>
      </td>
      <td className="border border-brand-300 px-2 py-2 text-xs text-brand-500">{saveLabel}</td>
      <td className="border border-brand-300 px-2 py-2">
        <div className="flex items-center justify-center space-x-1">
          <button type="button" onClick={onSave} className="p-1 text-green-700 transition-colors hover:text-green-900">
            <Check className="h-4 w-4" />
          </button>
          <button type="button" onClick={onCancel} className="p-1 text-brand-400 transition-colors hover:text-brand-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AfgPreviewModal({
  sequenceNo,
  detail,
  isLoading,
  onClose,
}: {
  sequenceNo: number;
  detail: PosDocumentDetail | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  const totalGold = detail?.lines
    .filter((line) => line.metal_type !== 'silver')
    .reduce((sum, line) => sum + Number(line.weight_grams || 0), 0) ?? 0;
  const totalSilver = detail?.lines
    .filter((line) => line.metal_type === 'silver')
    .reduce((sum, line) => sum + Number(line.weight_grams || 0), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b-4 border-amber-600 bg-brand-900 px-5 py-3">
          <div className="flex items-center gap-3">
            <FileText className="h-4 w-4 text-amber-400" />
            <div>
              <span className="block text-xs uppercase tracking-widest text-brand-500">Afregningsbilag</span>
              <span className="font-mono text-lg font-black text-white">
                {detail?.document_number || `#${sequenceNo}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {detail ? (
              <button
                type="button"
                onClick={() => void openAuthedDocument(`/api/pos/sessions/${detail.session_id}/receipt?audience=admin&format=pdf`)}
                className="flex items-center gap-1.5 bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
              >
                <Printer className="h-3.5 w-3.5" />
                Yazdır
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="ml-2 text-brand-500 transition-colors hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {!detail ? (
          <div className="p-6">
            <div className="border border-brand-200 bg-brand-50 px-4 py-5 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Belge Durumu</p>
              <p className="mt-2 text-sm font-semibold text-brand-700">
                {isLoading ? 'Belge detaylari hazirlaniyor' : `Belge bulunamadi (#${sequenceNo})`}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-auto">
            <div className="flex items-center justify-between border-b border-brand-200 bg-brand-50 px-5 py-3">
              <span className="text-xs font-black uppercase tracking-widest text-brand-500">Dato</span>
              <span className="font-mono text-sm font-black text-brand-900">{formatDate(detail.issued_at)}</span>
            </div>

            <div className="border-b border-brand-200 px-5 py-4">
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-brand-500">Müşteri / Kunde</p>
              <p className="font-black text-brand-900">{detail.customer_name || '-'}</p>
              {detail.customer_cpr ? <p className="mt-1 text-xs text-brand-500" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>CPR: {detail.customer_cpr}</p> : null}
              {detail.customer_identity_doc_number ? (
                <p className="mt-1 text-xs text-brand-500" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  Kørekort/Pas: {detail.customer_identity_doc_number}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-brand-500">{detail.customer_phone || '-'}</p>
              <p className="mt-1 text-xs text-brand-500">
                {[detail.customer_address, detail.customer_postal_code].filter(Boolean).join(', ') || '-'}
              </p>
            </div>

            <div className="border-b border-brand-200 px-5 py-4">
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-brand-500">Ürünler / Produkter</p>
              {!detail.lines.length ? (
                <p className="text-xs italic text-brand-300">Ürün detayı bulunamadı</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-brand-100">
                      <LabelCell>Açıklama</LabelCell>
                      <LabelCell>Vægt (g)</LabelCell>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr
                        key={line.id}
                        className={`border-b border-brand-100 ${line.metal_type === 'silver' ? 'bg-slate-50' : 'bg-amber-50'}`}
                      >
                        <td className="border border-brand-100 px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex px-1.5 py-0.5 text-[10px] font-black ${
                                line.metal_type === 'silver' ? 'bg-slate-200 text-slate-700' : 'bg-amber-200 text-amber-800'
                              }`}
                            >
                              {line.metal_type === 'silver' ? 'Ag' : 'Au'}
                            </span>
                            <div>
                              <p className="font-semibold text-brand-800">{labelProductType(line.product_type)}</p>
                              <p className="text-[11px] text-brand-500">
                                {line.product_number || '-'} · {line.reference_number || '-'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="border border-brand-100 px-3 py-2.5 text-center font-mono font-black text-brand-900">
                          {formatNumber(line.weight_grams, ' g')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between bg-emerald-800 px-5 py-4">
              <div className="flex items-center gap-3">
                {totalGold > 0 ? <span className="bg-amber-600 px-2.5 py-1 text-xs font-black text-white">Au {formatNumber(totalGold, ' g')}</span> : null}
                {totalSilver > 0 ? <span className="bg-slate-500 px-2.5 py-1 text-xs font-black text-white">Ag {formatNumber(totalSilver, ' g')}</span> : null}
              </div>
              <div className="text-right">
                <span className="block text-xs uppercase tracking-widest text-emerald-400">I alt</span>
                <span className="font-mono text-2xl font-black text-white">{formatMoney(detail.net_amount_dkk)}</span>
              </div>
            </div>

            <div className="grid gap-6 bg-brand-50 px-5 py-4 md:grid-cols-2">
              <div>
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-brand-500">Underskrift</p>
                <div className="h-10 border-b-2 border-brand-400" />
                <p className="mt-1 text-xs text-brand-400">{detail.customer_name || ''}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-widest text-brand-500">Erklæring</p>
                <p className="text-xs leading-relaxed text-brand-400">
                  Undertegnede erklærer, at de solgte varer er min ejendom ve sælges frivilligt.
                  Varerne kan ikke returneres efter afregning.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'emerald';
}) {
  const wrapperClassName = accent === 'emerald'
    ? 'flex-1 border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm'
    : 'flex-1 border border-brand-200 bg-white px-4 py-3 shadow-sm';
  const labelClassName = accent === 'emerald'
    ? 'text-[10px] uppercase tracking-widest text-emerald-600'
    : 'text-[10px] uppercase tracking-widest text-brand-500';
  const valueClassName = accent === 'emerald'
    ? 'mt-1 text-xl font-black leading-tight text-emerald-700'
    : 'mt-1 text-sm font-black text-brand-700';

  return (
    <div className={wrapperClassName}>
      <p className={labelClassName}>{label}</p>
      <p className={valueClassName}>{value}</p>
    </div>
  );
}

function IdentityRow({
  icon: Icon,
  label,
  value,
  helper,
  accent,
}: {
  icon?: typeof IdCard;
  label: string;
  value?: string | null;
  helper?: string;
  accent?: 'amber' | 'teal' | 'sky' | 'emerald';
}) {
  const labelBgClassName =
    accent === 'amber'
      ? 'bg-amber-100 border-r-2 border-amber-300'
      : accent === 'teal'
        ? 'bg-teal-100 border-r-2 border-teal-300'
        : accent === 'sky'
          ? 'bg-sky-100 border-r-2 border-sky-300'
          : accent === 'emerald'
            ? 'bg-emerald-100 border-r-2 border-emerald-200'
            : 'bg-brand-50 border-r border-brand-200';

  const valueClassName =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'teal'
        ? 'text-teal-700'
        : accent === 'sky'
          ? 'text-sky-700'
          : accent === 'emerald'
            ? 'text-emerald-700'
            : 'text-brand-700';

  return (
    <tr className="border-b border-brand-200">
      <td className={`w-40 px-3 py-2.5 ${labelBgClassName}`}>
        <div className="flex items-center gap-1.5">
          {Icon ? <Icon className="h-3 w-3 flex-shrink-0 text-brand-400" /> : null}
          <span className="text-xs font-bold uppercase tracking-wider text-brand-600">{label}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-sm ${valueClassName}`}>{value || '-'}</span>
        {helper && helper !== '-' ? <span className="ml-2 text-xs text-brand-400">({helper})</span> : null}
      </td>
    </tr>
  );
}

function FragmentRow({
  summary,
  detail,
  logMeta,
  isEven,
  isExpanded,
  onToggle,
  onPreview,
}: {
  summary: PosDocumentListItem;
  detail: PosDocumentDetail | null;
  logMeta?: CustomerHistoryLogMeta;
  isEven: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const goldLines = detail?.lines.filter((line) => line.metal_type !== 'silver') ?? [];
  const silverLines = detail?.lines.filter((line) => line.metal_type === 'silver') ?? [];

  return (
    <>
      <tr
        onClick={onToggle}
        className={`group cursor-pointer border-b border-brand-200 transition-colors ${
          isExpanded ? 'bg-brand-800' : isEven ? 'bg-white hover:bg-brand-50' : 'bg-brand-50 hover:bg-brand-100'
        }`}
      >
        <td className={`border border-brand-200 px-2 py-2.5 text-center ${isExpanded ? 'border-brand-700 bg-brand-800' : ''}`}>
          {isExpanded ? (
            <ChevronDown className="mx-auto h-3.5 w-3.5 text-brand-300" />
          ) : (
            <ChevronRight className="mx-auto h-3.5 w-3.5 text-brand-300 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </td>
        <td className={`border border-brand-200 px-3 py-2.5 ${isExpanded ? 'border-brand-700' : ''}`}>
          <span className={`font-mono text-sm font-black ${isExpanded ? 'text-amber-300' : 'text-brand-900'}`}>
            {summary.document_number}
          </span>
          {logMeta?.inLog ? (
            <span
              className={`ml-2 px-1.5 py-0.5 text-xs font-black ${
                logMeta.splitCount > 0
                  ? 'border border-amber-300 bg-amber-100 text-amber-700'
                  : 'border border-brand-300 bg-brand-100 text-brand-500'
              }`}
            >
              {logMeta.splitCount > 0 ? `LOG ×${logMeta.splitCount}` : 'LOG'}
            </span>
          ) : null}
        </td>
        <td className={`border border-brand-200 px-3 py-2.5 font-mono ${isExpanded ? 'border-brand-700 text-brand-300' : 'text-brand-700'}`}>
          {formatDate(summary.issued_at)}
        </td>
        <td className={`border px-3 py-2.5 text-right ${isExpanded ? 'border-brand-700 bg-emerald-900' : 'border-emerald-100 bg-emerald-50'}`}>
          <span className={`font-mono text-sm font-black ${isExpanded ? 'text-emerald-300' : 'text-emerald-800'}`}>
            {formatMoney(summary.gross_amount_dkk)}
          </span>
        </td>
      </tr>

      {isExpanded ? (
        <tr className="border-b-2 border-brand-300 bg-brand-50">
          <td colSpan={4} className="px-0 py-0">
            <div className="border-l-4 border-amber-500">
              <div className="px-4 py-3">
                <p className="mb-2 text-xs font-black uppercase tracking-widest text-brand-500">Urunler / Produkter</p>
                {!detail ? (
                  <div className="border border-brand-200 bg-white px-3 py-2 text-xs text-brand-500">
                    Belge detaylari yuklenirken history satiri acik tutuluyor.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {goldLines.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-amber-100 px-1.5 py-0.5 text-xs font-black text-amber-700">Au</span>
                        {goldLines.map((line) => (
                          <span key={line.id} className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                            {labelProductType(line.product_type)} · <span className="font-mono font-black">{formatNumber(line.weight_grams, ' g')}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {silverLines.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-slate-100 px-1.5 py-0.5 text-xs font-black text-slate-600">Ag</span>
                        {silverLines.map((line) => (
                          <span key={line.id} className="border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                            {labelProductType(line.product_type)} · <span className="font-mono font-black">{formatNumber(line.weight_grams, ' g')}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {logMeta?.inLog ? (
                <div className="border-t border-brand-200 bg-brand-50 px-4 py-3">
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-brand-500">Log Sistemi Durumu</p>
                  {logMeta.splitCount === 0 ? (
                    <p className="text-xs italic text-brand-400">Log&apos;a aktarıldı — henüz ayrıştırma yapılmamış</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {logMeta.smykkerCount > 0 ? (
                        <span className="bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800 border border-amber-400">
                          Smykker ×{logMeta.smykkerCount} · {formatNumber(logMeta.smykkerGrams, ' g')}
                        </span>
                      ) : null}
                      {logMeta.whiteGoldCount > 0 ? (
                        <span className="border border-sky-400 bg-sky-100 px-2 py-0.5 text-xs font-black text-sky-800">
                          Hvidguld ×{logMeta.whiteGoldCount} · {formatNumber(logMeta.whiteGoldGrams, ' g')}
                        </span>
                      ) : null}
                      {logMeta.separateStorageCount > 0 ? (
                        <span className="border border-purple-400 bg-purple-100 px-2 py-0.5 text-xs font-black text-purple-800">
                          Ayrı Depo ×{logMeta.separateStorageCount} · {formatNumber(logMeta.separateStorageGrams, ' g')}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex items-center gap-2 border-t border-brand-200 bg-brand-100 px-4 py-2.5">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreview();
                  }}
                  className="flex items-center gap-1.5 bg-brand-800 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-900"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Afregningsbilag Goruntule
                </button>
                {detail ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openAuthedDocument(`/api/pos/sessions/${detail.session_id}/receipt?audience=admin&format=pdf`);
                    }}
                    className="flex items-center gap-1.5 bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Yazdir
                  </button>
                ) : null}
                <span className="ml-auto flex items-center gap-1 text-xs text-brand-400">
                  <ExternalLink className="h-3 w-3" />
                  #{summary.sequence_no}
                </span>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function CustomersPage({
  search,
  onSearchChange,
  customers,
  selectedId,
  onSelectCustomer,
  editingId,
  showNewRow,
  onToggleNewRow,
  newDraft,
  onNewDraftChange,
  onSaveNew,
  editDraft,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDelete,
  selectedCustomer,
  historyItems,
  historySummary,
  historyLogMeta,
  expandedSequenceNo,
  onToggleHistory,
  expandedDetail,
  previewSequenceNo,
  previewDetail,
  previewLoading,
  onPreviewOpen,
  onPreviewClose,
}: CustomersPageProps) {
  return (
    <div className="flex min-h-full flex-col bg-white">
      {previewSequenceNo !== null ? (
        <AfgPreviewModal
          sequenceNo={previewSequenceNo}
          detail={previewDetail}
          isLoading={previewLoading}
          onClose={onPreviewClose}
        />
      ) : null}

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4 border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
        <div>
          <h2 className="text-lg font-black uppercase tracking-wider text-brand-900">Müşteriler</h2>
          <p className="mt-0.5 text-xs text-brand-600">Kayıtlı müşteri veritabanı</p>
        </div>
        <div className="flex min-w-[320px] flex-1 items-center justify-end gap-2">
          <div className="flex h-10 min-w-[260px] max-w-[420px] flex-1 items-center gap-3 border border-brand-300 bg-white px-4">
            <Search className="h-4 w-4 text-brand-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="h-full flex-1 bg-transparent text-sm text-brand-900 outline-none"
              placeholder="Ara: isim, CPR, telefon..."
            />
          </div>
          <button
            type="button"
            onClick={onToggleNewRow}
            className="inline-flex items-center gap-2 border border-brand-700 bg-brand-900 px-4 py-2 text-sm font-bold uppercase tracking-wider text-brand-300 transition hover:bg-brand-800"
          >
            <Plus className="h-4 w-4" />
            Yeni Müşteri
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 flex-col overflow-hidden ${selectedCustomer ? 'w-3/5 border-r-2 border-brand-200' : 'flex-1'}`}>
          <div className="flex flex-shrink-0 items-center bg-brand-800 px-4 py-2">
            <span className="text-xs font-semibold text-brand-400">
              Toplam: <span className="font-mono font-black text-brand-200">{customers.length}</span> müşteri
            </span>
            {search ? (
              <span className="ml-4 text-xs text-brand-400">
                Filtre: <span className="font-mono font-black text-brand-200">{customers.length}</span>
              </span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-max w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <LabelCell>#</LabelCell>
                  <LabelCell>Ad Soyad / Navn</LabelCell>
                  <LabelCell>CPR Nr.</LabelCell>
                  <LabelCell>Telefon</LabelCell>
                  <LabelCell>E-mail</LabelCell>
                  <LabelCell>Adresse</LabelCell>
                  <LabelCell>Postnr.</LabelCell>
                  <LabelCell>Kørekort / Pas</LabelCell>
                  <LabelCell>Kayıt Tarihi</LabelCell>
                  <th className="w-20 border border-brand-300 bg-brand-100 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {showNewRow ? (
                  <DraftRow
                    draft={newDraft}
                    onChange={onNewDraftChange}
                    onSave={onSaveNew}
                    onCancel={onToggleNewRow}
                    saveLabel="Yeni"
                  />
                ) : null}

                {!customers.length && !showNewRow ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-sm text-brand-400">
                      {search ? 'Arama sonucu bulunamadı' : 'Henüz kayıtlı müşteri yok'}
                    </td>
                  </tr>
                ) : null}

                {customers.map((customer, index) => {
                  const isSelected = selectedId === customer.id;
                  const isEditing = editingId === customer.id;
                  const rowTone = isSelected
                    ? 'bg-brand-800 text-white'
                    : index % 2 === 0
                      ? 'bg-white hover:bg-brand-100'
                      : 'bg-brand-50 hover:bg-brand-100';

                  if (isEditing) {
                    return (
                      <DraftRow
                        key={customer.id}
                        draft={editDraft}
                        onChange={onEditDraftChange}
                        onSave={() => onSaveEdit(customer.id)}
                        onCancel={onCancelEdit}
                        saveLabel={formatDate(customer.created_at)}
                      />
                    );
                  }

                  return (
                    <tr
                      key={customer.id}
                      onClick={() => onSelectCustomer(customer.id)}
                      className={`cursor-pointer border-b border-brand-200 transition-colors ${rowTone}`}
                    >
                      <td className={`border px-3 py-2.5 text-center text-xs font-bold ${isSelected ? 'border-brand-700 border-l-4 border-l-amber-400 bg-brand-900 text-amber-300' : 'border-brand-200 text-brand-500'}`}>
                        {index + 1}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 font-bold ${isSelected ? 'border-brand-700 text-white' : 'text-brand-900'}`}>
                        {customer.name || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 font-mono ${isSelected ? 'border-brand-700 text-brand-200' : 'text-brand-700'}`}>
                        {customer.cpr_number || customer.cpr_number_masked || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 font-mono ${isSelected ? 'border-brand-700 text-brand-200' : 'text-brand-700'}`}>
                        {customer.phone || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 ${isSelected ? 'border-brand-700 text-brand-300' : 'text-brand-700'}`}>
                        {customer.email || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 ${isSelected ? 'border-brand-700 text-brand-300' : 'text-brand-700'}`}>
                        {customer.address || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 font-mono ${isSelected ? 'border-brand-700 text-brand-200' : 'text-brand-600'}`}>
                        {customer.postal_code || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 font-mono ${isSelected ? 'border-brand-700 text-brand-200' : 'text-brand-600'}`}>
                        {customer.identity_doc_number || customer.identity_doc_number_masked || '-'}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 text-xs font-mono ${isSelected ? 'border-brand-700 text-brand-300' : 'text-brand-500'}`}>
                        {formatDate(customer.created_at)}
                      </td>
                      <td className={`border border-brand-200 px-2 py-2.5 ${isSelected ? 'border-brand-700' : ''}`}>
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onStartEdit(customer);
                            }}
                            className={`p-1 transition-colors ${isSelected ? 'text-brand-300 hover:text-white' : 'text-brand-400 hover:text-brand-800'}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!window.confirm(`${customer.name} kaydını pasife almak istiyor musunuz?`)) return;
                              onDelete(customer);
                            }}
                            className={`p-1 transition-colors ${isSelected ? 'text-red-300 hover:text-red-100' : 'text-red-400 hover:text-red-700'}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-shrink-0 items-center space-x-6 border-t-2 border-brand-300 bg-brand-100 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">{customers.length} kayit gosteriliyor</span>
            {selectedCustomer ? (
              <span className="text-xs text-brand-500">
                Seçili: <span className="font-black text-brand-800">{selectedCustomer.name}</span>
                <button type="button" onClick={() => onSelectCustomer(null)} className="ml-2 text-brand-400 transition-colors hover:text-brand-700">
                  <X className="inline h-3 w-3" />
                </button>
              </span>
            ) : null}
          </div>
        </div>

        {selectedCustomer ? (
          <div className="flex w-2/5 min-w-[520px] flex-col overflow-hidden bg-white">
            <div className="flex-shrink-0 border-b-2 border-brand-200 bg-brand-50 px-5 py-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center border-2 border-brand-300 shadow-sm ${getAvatarColor(selectedCustomer.name)}`}>
                    <span className="font-mono text-lg font-black text-white">{getInitials(selectedCustomer.name)}</span>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-brand-500">Müşteri Detayı</p>
                    <p className="text-2xl font-black leading-none text-brand-900">{selectedCustomer.name}</p>
                    <p className="mt-1.5 font-mono text-sm font-bold text-brand-600">
                      {selectedCustomer.cpr_number || selectedCustomer.cpr_number_masked || '-'}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => onSelectCustomer(null)} className="p-1 text-brand-400 transition-colors hover:text-brand-800">
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <SummaryChip label="İşlem" value={String(historySummary.count)} />
                <SummaryChip label="Toplam" value={formatMoney(historySummary.total)} accent="emerald" />
                <SummaryChip label="Son İşlem" value={historySummary.lastDate ? formatDate(historySummary.lastDate) : '-'} />
                <a
                  href={`#/gdpr?customer=${selectedCustomer.id}`}
                  className="inline-flex items-center gap-1.5 border border-brand-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:border-brand-700 hover:bg-brand-100"
                >
                  GDPR Dossier
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div className="max-h-[320px] flex-shrink-0 overflow-y-auto border-b-2 border-brand-200">
              <div className="sticky top-0 z-10 border-b border-brand-200 bg-brand-50 px-4 py-2">
                <p className="text-xs font-black uppercase tracking-widest text-brand-600">Kimlik Bilgileri</p>
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  <IdentityRow icon={IdCard} label="Navn / Ad Soyad" value={selectedCustomer.name} />
                  <IdentityRow icon={IdCard} label="CPR Numarası" value={selectedCustomer.cpr_number || selectedCustomer.cpr_number_masked} accent="amber" />
                  <IdentityRow
                    icon={CreditCard}
                    label="Kørekort / Pas"
                    value={selectedCustomer.identity_doc_number || selectedCustomer.identity_doc_number_masked}
                    accent="amber"
                    helper={labelIdentityDocType(selectedCustomer.identity_doc_type)}
                  />
                  <IdentityRow icon={Phone} label="Telefon" value={selectedCustomer.phone} accent="teal" />
                  <IdentityRow icon={Mail} label="E-mail" value={selectedCustomer.email} accent="sky" />
                  <IdentityRow icon={MapPin} label="Adresse" value={selectedCustomer.address} />
                  <IdentityRow icon={MapPin} label="Postnr." value={selectedCustomer.postal_code} />
                  <IdentityRow icon={Calendar} label="Kayıt Tarihi" value={formatDate(selectedCustomer.created_at)} accent="emerald" />
                </tbody>
              </table>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-2">
                <p className="text-xs font-black uppercase tracking-widest text-brand-600">Alış Geçmişi</p>
                <span className="bg-brand-200 px-2 py-0.5 font-mono text-xs font-black text-brand-500">{historySummary.count} işlem</span>
              </div>

              {!historyItems.length ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-brand-300">Bu müşteriye ait alış kaydı yok</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="w-4 border border-brand-200 bg-brand-100 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600"></th>
                        <th className="border border-brand-200 bg-brand-100 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600">Afg. Nr.</th>
                        <th className="border border-brand-200 bg-brand-100 px-3 py-2.5 text-left text-xs font-black uppercase tracking-wider text-brand-600">Tarih</th>
                        <th className="border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-right text-xs font-black uppercase tracking-wider text-emerald-700">Toplam</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyItems.map((item, index) => (
                        <FragmentRow
                          key={item.sequence_no}
                          summary={item}
                          detail={expandedSequenceNo === item.sequence_no ? expandedDetail : null}
                          logMeta={historyLogMeta[item.sequence_no]}
                          isEven={index % 2 === 0}
                          isExpanded={expandedSequenceNo === item.sequence_no}
                          onToggle={() => onToggleHistory(item.sequence_no)}
                          onPreview={() => onPreviewOpen(item.sequence_no)}
                        />
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-brand-400">
                        <td colSpan={3} className="border border-brand-300 bg-emerald-50 px-3 py-2.5 text-right text-xs font-black uppercase tracking-wider text-emerald-700">
                          Genel Toplam
                        </td>
                        <td className="border border-emerald-700 bg-emerald-800 px-3 py-2.5 text-right">
                          <span className="font-mono text-base font-black text-white">{formatMoney(historySummary.total)}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
