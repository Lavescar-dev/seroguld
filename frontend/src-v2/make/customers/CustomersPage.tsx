import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileText,
  IdCard,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { apiRequest, fetchAuthedPdfBlob, printAuthedDocument, localizeApiError } from '@/lib/api';
import { exportDocumentBytes, isTauriRuntime } from '@/lib/desktop';
import {
  formatDate,
  formatMoney,
  formatNumber,
  labelProductType,
} from '@/lib/format';
import { normalizePostalCode } from '@/make/alis/addressAutocomplete';
import { useCustomerMatch } from '@/make/alis/customerMatch';
import type { EditableCustomer } from '@/make/alis/types';
import { useToast } from '@/lib/toast';
import type { PosDocumentDetail, PosDocumentListItem, PosPostalLookup } from '@/types';

import { useConfirm } from '@/components/ConfirmDialog';
import type { CustomerDraft, CustomerHistoryLogMeta, CustomersPageProps } from './types';
import { CustomerOcrPanel } from './CustomerOcrPanel';

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

/**
 * M2: backend CustomerOut artık `city` döndürüyor; paylaşılan FE CustomerOut
 * tipi (src-v2/types.ts) henüz tanımlamadığı için yerel okuma yardımcısı.
 * (Tip düzeltmesi types.ts'e ayrı iş olarak yapılmalı.)
 */
function customerCity(customer: unknown): string {
  if (!customer || typeof customer !== 'object') return '';
  const city = (customer as { city?: unknown }).city;
  return typeof city === 'string' ? city : '';
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
  isSaving,
}: {
  draft: CustomerDraft;
  onChange: (field: keyof CustomerDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  isSaving?: boolean;
}) {
  // A6-6: zorunlu alan (ad, en az 2 karakter) dolmadan ve istek sürerken kaydet kapalı;
  // isPending hem tıkı hem Enter'ı keser.
  const canSave = draft.name.trim().length >= 2;
  const handleRowKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSaving && canSave) onSave();
    }
  };
  const saveHint = isSaving ? 'Kaydediliyor…' : canSave ? undefined : 'Ad soyad zorunlu';

  // M2: AFG'deki posta kodu → şehir otomasyonuyla aynı kural — 4 haneli
  // posta kodunda şehir boşsa postal-lookup'tan doldurulur; elle yazılan
  // şehir asla ezilmez.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const postalDigits = normalizePostalCode(draft.postal_code);
  useEffect(() => {
    if (postalDigits.length !== 4) return;
    const timeoutId = window.setTimeout(() => {
      void apiRequest<PosPostalLookup>(`/api/v2/alis/postal-lookup/${postalDigits}`)
        .then((response) => {
          const latest = draftRef.current;
          if (normalizePostalCode(latest.postal_code) !== postalDigits) return;
          if (latest.city.trim()) return;
          const nextCity = String(response.postal_district || '').trim();
          if (response.found && nextCity) onChange('city', nextCity);
        })
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timeoutId);
    // yalnız posta kodu değişince tetiklenir; onChange ilk render'daki
    // closure'dan gelse de parent state güncelleyici olduğu için güvenlidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postalDigits]);

  return (
    <tr className="bg-amber-50" onKeyDown={handleRowKeyDown}>
      <td className="border border-brand-300 px-3 py-2 text-center text-xs font-bold text-brand-600">+</td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input aria-label="Müşteri adı" required value={draft.name} onChange={(event) => onChange('name', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input aria-label="CPR" value={draft.cpr_number} onChange={(event) => onChange('cpr_number', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input aria-label="Telefon" value={draft.phone} onChange={(event) => onChange('phone', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input aria-label="E-posta" value={draft.email} onChange={(event) => onChange('email', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input aria-label="Adres" value={draft.address} onChange={(event) => onChange('address', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <input aria-label="Posta kodu" value={draft.postal_code} onChange={(event) => onChange('postal_code', event.target.value)} className={cellInput} />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        {/* M2: şehir alanı — OCR'ın okuyup backend'in sakladığı değer artık görünür. */}
        <input aria-label="Şehir" value={draft.city} onChange={(event) => onChange('city', event.target.value)} className={cellInput} placeholder="By" />
      </td>
      <td className="border border-brand-300 px-1 py-1.5">
        <div className="grid gap-1">
          <select aria-label="Belge tipi" value={draft.identity_doc_type} onChange={(event) => onChange('identity_doc_type', event.target.value)} className={cellInput}>
            <option value="">Belge tipi</option>
            <option value="driver_license">Korekort</option>
            <option value="passport">Pas</option>
            <option value="id_card">Kimlik</option>
          </select>
          <div className="flex gap-1">
            <input
              aria-label="Belge numarası"
              value={draft.identity_doc_number}
              onChange={(event) => onChange('identity_doc_number', event.target.value)}
              className={cellInput}
              placeholder="Belge no"
            />
            {/* M2: görünür ülke kodu (ISO-3, örn. DNK) — iki konvansiyon karışması biter. */}
            <input
              aria-label="Belge ülkesi"
              value={draft.identity_doc_country}
              onChange={(event) => onChange('identity_doc_country', event.target.value.toUpperCase().slice(0, 3))}
              className={`${cellInput} w-16 text-center font-mono`}
              placeholder="DNK"
              title="Belge ülke kodu (ISO-3, örn. DNK)"
            />
          </div>
        </div>
      </td>
      <td className="border border-brand-300 px-2 py-2 text-xs text-brand-500">
        {saveLabel}
        {saveHint ? <span className="block text-[10px] text-amber-700">{saveHint}</span> : null}
      </td>
      <td className="border border-brand-300 px-2 py-2">
        <div className="flex items-center justify-center space-x-1">
          <button
            type="button"
            aria-label={`${saveLabel} kaydet`}
            title={canSave ? `${saveLabel} kaydet (Enter)` : 'Ad soyad zorunlu (en az 2 karakter)'}
            onClick={onSave}
            disabled={isSaving || !canSave}
            aria-disabled={isSaving || !canSave}
            className="p-1 text-green-700 transition-colors hover:text-green-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Düzenlemeyi iptal et" title="Düzenlemeyi iptal et" onClick={onCancel} className="p-1 text-brand-400 transition-colors hover:text-brand-700">
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
  isError,
  onRetry,
  onClose,
}: {
  sequenceNo: number;
  detail: PosDocumentDetail | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const totalGold = detail?.lines
    .filter((line) => line.metal_type !== 'silver')
    .reduce((sum, line) => sum + Number(line.weight_grams || 0), 0) ?? 0;
  const totalSilver = detail?.lines
    .filter((line) => line.metal_type === 'silver')
    .reduce((sum, line) => sum + Number(line.weight_grams || 0), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/55 p-6" onClick={onClose}>
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
                onClick={async () => {
                  try {
                    await printAuthedDocument(`/api/pos/sessions/${detail.session_id}/receipt?audience=admin&format=html`);
                  } catch (error) {
                    toast.error('Fiş yazdırılamadı', localizeApiError(error));
                  }
                }}
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
              {isError ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-red-700">Belge yüklenemedi (#${sequenceNo})</p>
                  <button
                    type="button"
                    onClick={onRetry}
                    disabled={isLoading}
                    className="mt-3 border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Tekrar dene
                  </button>
                </>
              ) : (
                <p className="mt-2 text-sm font-semibold text-brand-700">
                  {isLoading ? 'Belge detaylari hazirlaniyor' : `Belge bulunamadi (#${sequenceNo})`}
                </p>
              )}
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
  detailLoading,
  detailError,
  onRetryDetail,
  logMeta,
  isEven,
  isExpanded,
  onToggle,
  onPreview,
}: {
  summary: PosDocumentListItem;
  detail: PosDocumentDetail | null;
  detailLoading?: boolean;
  detailError?: boolean;
  onRetryDetail?: () => void;
  logMeta?: CustomerHistoryLogMeta;
  isEven: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const toast = useToast();
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
                    {detailError ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-red-700">Belge detayı yüklenemedi.</span>
                        <button
                          type="button"
                          onClick={onRetryDetail}
                          disabled={detailLoading}
                          className="border border-brand-300 bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Tekrar dene
                        </button>
                      </div>
                    ) : (
                      'Belge detaylari yuklenirken history satiri acik tutuluyor.'
                    )}
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
                    onClick={async (event) => {
                      event.stopPropagation();
                      try {
                        await printAuthedDocument(`/api/pos/sessions/${detail.session_id}/receipt?audience=admin&format=html`);
                      } catch (error) {
                        toast.error('Fiş yazdırılamadı', localizeApiError(error));
                      }
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
  totalCustomers,
  customerPage,
  customerTotalPages,
  onCustomerPageChange,
  customersLoading,
  customersError,
  onRetryCustomers,
  customerStatus,
  onCustomerStatusChange,
  selectedId,
  onSelectCustomer,
  editingId,
  showNewRow,
  onToggleNewRow,
  newDraft,
  onNewDraftChange,
  onSaveNew,
  isSavingNew,
  editDraft,
  onEditDraftChange,
  onSaveEdit,
  isUpdatingCustomer,
  onCancelEdit,
  onStartEdit,
  onDelete,
  isDeletingCustomer,
  deletingId,
  onReactivate,
  reactivatingId,
  selectedCustomer,
  historyItems,
  isHistoryLoading,
  isHistoryError,
  onRetryDocumentQuery,
  historySummary,
  historyLogMeta,
  expandedSequenceNo,
  onToggleHistory,
  expandedDetail,
  expandedDetailLoading,
  expandedDetailError,
  previewSequenceNo,
  previewDetail,
  previewLoading,
  previewError,
  onPreviewOpen,
  onPreviewClose,
}: CustomersPageProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const isSearchMode = search.trim().length >= 2;
  const [statementPending, setStatementPending] = useState(false);

  // M2: canlı mükerrer müşteri kontrolü — AFG editöründeki useCustomerMatch
  // hattı yeni-kayıt formuna bağlandı (yalnız CPR/belge no doluyken sorgular).
  const matchCustomer: EditableCustomer = {
    name: '',
    email: '',
    phone: '',
    address: '',
    postal_code: '',
    city: '',
    cpr_number: showNewRow ? newDraft.cpr_number : '',
    identity_doc_type: '',
    identity_doc_number: showNewRow ? newDraft.identity_doc_number : '',
    identity_doc_country: 'DNK',
  };
  const customerMatch = useCustomerMatch(matchCustomer);

  const ocrTarget = editingId ? 'edit' : showNewRow ? 'new' : null;

  // M2: backend'in ürettiği 30 günlük risk analizi ve istatistikler artık
  // klasik detayda da görünüyor (detay sorgusu CustomerDetailOut döndürür).
  const detailRisk = selectedCustomer && 'risk' in selectedCustomer ? selectedCustomer.risk : null;
  const detailStats = selectedCustomer && 'stats' in selectedCustomer ? selectedCustomer.stats : null;

  const openStatementPdf = async () => {
    if (!selectedCustomer) return;
    setStatementPending(true);
    try {
      // Hesap özeti PDF'i klasik yüzeyde ikinci veri çıkışı — tarayıcıda yeni
      // sekmede, masaüstünde (window.open çalışmaz) kaydet diyaloğuyla.
      const { blob } = await fetchAuthedPdfBlob(`/api/customers/${selectedCustomer.id}/statement.pdf`);
      if (isTauriRuntime()) {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.includes(',') ? result.split(',')[1] ?? '' : result);
          };
          reader.onerror = () => reject(reader.error ?? new Error('PDF okunamadı'));
          reader.readAsDataURL(blob);
        });
        await exportDocumentBytes('hesap-ozeti.pdf', dataBase64);
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) {
      toast.error('Hesap özeti açılamadı', localizeApiError(error));
    } finally {
      setStatementPending(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-white">
      {previewSequenceNo !== null ? (
        <AfgPreviewModal
          sequenceNo={previewSequenceNo}
          detail={previewDetail}
          isLoading={previewLoading}
          isError={previewError}
          onRetry={() => onRetryDocumentQuery('preview')}
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
          {ocrTarget ? (
            <div className="flex-shrink-0 px-4 pt-3">
              {/* M2: panel hedef-bilinçli — düzenleme modunda da (pas/kort
                  değişen müşteri için) tarama yapılabilir ve onApply doğru
                  taslağa (new/edit) yazılır. */}
              <CustomerOcrPanel
                targetLabel={ocrTarget === 'edit' ? 'Düzenleme' : 'Yeni kayıt'}
                onApply={(fields) => {
                  const change = ocrTarget === 'edit' ? onEditDraftChange : onNewDraftChange;
                  (Object.entries(fields) as Array<[keyof typeof fields, string | undefined]>).forEach(([field, value]) => {
                    if (value) change(field, value);
                  });
                }}
              />
              {showNewRow && (customerMatch.loading || customerMatch.response || customerMatch.error) ? (
                <div
                  className={`mb-3 border px-3 py-1.5 text-xs ${
                    customerMatch.response?.status === 'conflict' || customerMatch.error
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-brand-200 bg-brand-50 text-brand-600'
                  }`}
                >
                  {customerMatch.loading ? 'Müşteri eşleşmesi kontrol ediliyor...' : null}
                  {customerMatch.error ? 'Müşteri eşleşmesi şu an kontrol edilemedi.' : null}
                  {customerMatch.response?.status === 'none'
                    ? 'Mevcut müşteri eşleşmesi yok; yeni kayıt yalnız operatör onayıyla oluşturulur.'
                    : null}
                  {customerMatch.response?.status === 'single' ? (
                    <span>
                      Eşleşen müşteri: <strong>{customerMatch.response.matches[0]?.name}</strong>
                      {customerMatch.response.matches[0] ? (
                        <button
                          type="button"
                          onClick={() => onSelectCustomer(customerMatch.response!.matches[0]!.id)}
                          className="ml-2 inline-flex items-center border border-amber-400 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 hover:bg-amber-200"
                        >
                          Bu kayda geç
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                  {customerMatch.response?.status === 'conflict' ? (
                    <span>
                      <strong>Çakışan kayıtlar:</strong> {customerMatch.response.matches.map((item) => item.name).join(', ')}. Kaydı seçip inceleyin.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-shrink-0 flex-wrap items-center gap-4 bg-brand-800 px-4 py-2">
            <span className="text-xs font-semibold text-brand-400">
              {/* A6-4: rozet sayfalanan toplamı gösterir, yalnız elde edilen sayfayı değil. */}
              Toplam: <span className="font-mono font-black text-brand-200">{totalCustomers}</span> müşteri
            </span>
            {isSearchMode ? (
              <span className="text-xs text-brand-400">
                Filtre: <span className="font-mono font-black text-brand-200">{customers.length}</span>
              </span>
            ) : null}
            {/* A6-3: pasif müşteriler filtresi — listede soluk görünür, geri açılabilir. */}
            <div className="ml-auto flex items-center gap-1" role="group" aria-label="Müşteri durum filtresi">
              {([
                ['active', 'Aktif'],
                ['inactive', 'Pasif'],
                ['all', 'Tümü'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onCustomerStatusChange(value)}
                  aria-pressed={customerStatus === value}
                  className={`px-2 py-0.5 text-xs font-bold transition-colors ${
                    customerStatus === value
                      ? 'bg-amber-500 text-brand-900'
                      : 'text-brand-400 hover:bg-brand-700 hover:text-brand-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-max w-full border-collapse text-sm">
              <thead className="sticky top-0 z-sticky">
                <tr>
                  <LabelCell>#</LabelCell>
                  <LabelCell>Ad Soyad / Navn</LabelCell>
                  <LabelCell>CPR Nr.</LabelCell>
                  <LabelCell>Telefon</LabelCell>
                  <LabelCell>E-mail</LabelCell>
                  <LabelCell>Adresse</LabelCell>
                  <LabelCell>Postnr.</LabelCell>
                  <LabelCell>By</LabelCell>
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
                    isSaving={isSavingNew}
                  />
                ) : null}

                {!customers.length && !showNewRow && customersLoading ? (
                  [0, 1, 2, 3, 4].map((row) => (
                    <tr key={`customers-skeleton-${row}`} aria-hidden="true">
                      {Array.from({ length: 11 }, (_cell, cell) => (
                        <td key={cell} className="border border-brand-200 px-3 py-3">
                          <div className="h-3.5 w-full animate-pulse bg-brand-100" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : null}

                {!customers.length && !showNewRow && customersError ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-8 text-center">
                      <p className="text-sm font-semibold text-red-700">Müşteriler yüklenemedi</p>
                      <p className="mt-1 text-xs text-brand-500">Bağlantı sorunu olabilir; listeyi tekrar çekmeyi deneyin.</p>
                      <button
                        type="button"
                        onClick={onRetryCustomers}
                        disabled={customersLoading}
                        className="mt-3 border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Tekrar dene
                      </button>
                    </td>
                  </tr>
                ) : null}

                {!customers.length && !showNewRow && !customersLoading && !customersError ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-sm text-brand-400">
                      {isSearchMode ? 'Arama sonucu bulunamadı' : 'Henüz kayıtlı müşteri yok'}
                    </td>
                  </tr>
                ) : null}

                {customers.map((customer, index) => {
                  const isSelected = selectedId === customer.id;
                  const isEditing = editingId === customer.id;
                  const isRowDeleting = deletingId === customer.id;
                  const isRowReactivating = reactivatingId === customer.id;
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
                        isSaving={isUpdatingCustomer}
                      />
                    );
                  }

                  return (
                    <tr
                      key={customer.id}
                      onClick={() => onSelectCustomer(customer.id)}
                      className={`cursor-pointer border-b border-brand-200 transition-colors ${rowTone} ${!customer.is_active && !isSelected ? 'opacity-60 saturate-50' : ''}`}
                    >
                      <td className={`border px-3 py-2.5 text-center text-xs font-bold ${isSelected ? 'border-brand-700 border-l-4 border-l-amber-400 bg-brand-900 text-amber-300' : 'border-brand-200 text-brand-500'}`}>
                        {index + 1}
                      </td>
                      <td className={`border border-brand-200 px-3 py-2.5 font-bold ${isSelected ? 'border-brand-700 text-white' : 'text-brand-900'}`}>
                        {customer.name || '-'}
                        {!customer.is_active ? (
                          <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${isSelected ? 'bg-brand-600 text-brand-100' : 'border border-brand-300 bg-brand-100 text-brand-500'}`}>
                            Pasif
                          </span>
                        ) : null}
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
                      <td className={`border border-brand-200 px-3 py-2.5 ${isSelected ? 'border-brand-700 text-brand-300' : 'text-brand-700'}`}>
                        {customerCity(customer) || '-'}
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
                          {!customer.is_active ? (
                            <button
                              type="button"
                              aria-label={`${customer.name || 'Müşteri'} yeniden aktifleştir`}
                              title="Yeniden aktifleştir"
                              onClick={(event) => {
                                event.stopPropagation();
                                onReactivate(customer);
                              }}
                              disabled={isRowReactivating || isDeletingCustomer}
                              className={`p-1 transition-colors disabled:cursor-wait disabled:opacity-50 ${isSelected ? 'text-emerald-300 hover:text-emerald-100' : 'text-emerald-600 hover:text-emerald-800'}`}
                            >
                              <RotateCcw className={`h-3.5 w-3.5 ${isRowReactivating ? 'animate-spin' : ''}`} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`${customer.name || 'Müşteri'} pasife al`}
                              title="Pasife al"
                              onClick={async (event) => {
                                event.stopPropagation();
                                const ok = await confirm({
                                  title: 'Müşteriyi pasife al',
                                  message: `${customer.name} kaydını pasife almak istiyor musunuz?`,
                                  confirmText: 'Pasife al',
                                  variant: 'warning',
                                });
                                if (!ok) return;
                                onDelete(customer);
                              }}
                              disabled={isRowDeleting || isRowReactivating}
                              className={`p-1 transition-colors disabled:cursor-wait disabled:opacity-50 ${isSelected ? 'text-red-300 hover:text-red-100' : 'text-red-400 hover:text-red-700'}`}
                            >
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

          <div className="flex flex-shrink-0 flex-wrap items-center gap-4 border-t-2 border-brand-300 bg-brand-100 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">{customers.length} kayit gosteriliyor</span>
            {/* A6-4: arama modunda gizli sayfalama — Önceki/Sonraki + "X/Y kayıt". */}
            {!isSearchMode ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Önceki müşteri sayfası"
                  onClick={() => onCustomerPageChange(customerPage - 1)}
                  disabled={customerPage <= 1 || customersLoading}
                  className="border border-brand-300 bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Önceki
                </button>
                <span className="font-mono text-xs font-bold text-brand-700">
                  {customerPage}/{customerTotalPages} — {totalCustomers} kayıt
                </span>
                <button
                  type="button"
                  aria-label="Sonraki müşteri sayfası"
                  onClick={() => onCustomerPageChange(customerPage + 1)}
                  disabled={customerPage >= customerTotalPages || customersLoading}
                  className="border border-brand-300 bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Sonraki
                </button>
              </div>
            ) : null}
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
                <button
                  type="button"
                  onClick={() => void openStatementPdf()}
                  disabled={statementPending}
                  className="inline-flex items-center gap-1.5 border border-brand-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:border-brand-700 hover:bg-brand-100 disabled:cursor-wait disabled:opacity-60"
                >
                  {statementPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                  Hesap özeti (PDF)
                </button>
              </div>

              {detailStats ? (
                <p className="mt-3 text-[11px] text-brand-500">
                  Mağaza alışı: <span className="font-bold text-brand-700">{detailStats.total_sold_to_shop} işlem · {formatMoney(detailStats.total_purchase_value_dkk)}</span>
                  {'  ·  '}
                  Mağaza satışı: <span className="font-bold text-brand-700">{detailStats.total_bought_from_shop} işlem · {formatMoney(detailStats.total_sale_value_dkk)}</span>
                </p>
              ) : null}

              {detailRisk ? (
                <div
                  className={`mt-3 border px-3 py-2 ${
                    detailRisk.level === 'high'
                      ? 'border-rose-300 bg-rose-50 text-rose-800'
                      : detailRisk.level === 'medium'
                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-brand-200 bg-brand-50 text-brand-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className={`h-3.5 w-3.5 ${detailRisk.level === 'low' ? 'text-brand-400' : ''}`} />
                    <span className="text-[11px] font-black uppercase tracking-widest">
                      Risk {detailRisk.level === 'high' ? 'YÜKSEK' : detailRisk.level === 'medium' ? 'ORTA' : 'düşük'} · skor {detailRisk.score} (30 gün)
                    </span>
                  </div>
                  {detailRisk.warnings.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {detailRisk.warnings.map((warning) => (
                        <li key={warning} className="text-xs font-semibold">• {warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5 text-xs">Son 30 günde dikkat gerektiren örüntü yok.</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="max-h-[320px] flex-shrink-0 overflow-y-auto border-b-2 border-brand-200">
              <div className="sticky top-0 z-sticky border-b border-brand-200 bg-brand-50 px-4 py-2">
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
                  {/* M2: backend'in sakladığı şehir klasik detayda da görünür. */}
                  <IdentityRow icon={MapPin} label="By / Şehir" value={customerCity(selectedCustomer)} />
                  <IdentityRow icon={Calendar} label="Kayıt Tarihi" value={formatDate(selectedCustomer.created_at)} accent="emerald" />
                </tbody>
              </table>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-2">
                <p className="text-xs font-black uppercase tracking-widest text-brand-600">Alış Geçmişi</p>
                <span className="bg-brand-200 px-2 py-0.5 font-mono text-xs font-black text-brand-500">{historySummary.count} işlem</span>
              </div>

              {!historyItems.length && isHistoryLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-brand-300">Alış geçmişi yükleniyor…</p>
                </div>
              ) : null}

              {!historyItems.length && isHistoryError ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                  <p className="text-sm font-semibold text-red-700">Alış geçmişi yüklenemedi</p>
                  <button
                    type="button"
                    onClick={() => onRetryDocumentQuery('history')}
                    disabled={isHistoryLoading}
                    className="border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Tekrar dene
                  </button>
                </div>
              ) : null}

              {!historyItems.length && !isHistoryLoading && !isHistoryError ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-brand-300">Bu müşteriye ait alış kaydı yok</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-sticky">
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
                          detailLoading={expandedDetailLoading}
                          detailError={expandedDetailError}
                          onRetryDetail={() => onRetryDocumentQuery('expanded-detail')}
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
