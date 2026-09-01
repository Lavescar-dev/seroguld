import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Eye,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

import type { AntiFraudOrdersResponse } from '@/types';
import { formatOrderStatus, monoStyle, normalizeRiskLevel, riskTone, type RiskFilter } from '@/components/OpmcShared';
import { CommittedNumericInput } from '@/shared/forms/CommittedNumericInput';

function dateTimeLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date
    .toLocaleString(document.documentElement.lang, {
      hour12: false,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');
}

function statusTone(status?: string | null) {
  const normalized = (status || '').toLowerCase();
  if (normalized.includes('processing') || normalized.includes('işlen')) return 'bg-amber-50 text-amber-800';
  if (normalized.includes('pending') || normalized.includes('bekle')) return 'bg-slate-100 text-slate-700';
  if (normalized.includes('completed') || normalized.includes('tamam')) return 'bg-emerald-50 text-emerald-700';
  if (normalized.includes('cancel') || normalized.includes('iptal')) return 'bg-rose-50 text-rose-700';
  return 'bg-brand-100 text-brand-700';
}

function SummaryMetric({
  label,
  value,
  icon,
  background,
  border,
  valueClass,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  background: string;
  border: string;
  valueClass: string;
}) {
  return (
    <div className={`${background} border-r ${border} last:border-r-0 px-4 py-2`}>
      <div className="mb-0.5 flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-widest text-brand-600">{label}</span>
      </div>
      <span className={`text-xl font-black ${valueClass}`} style={monoStyle}>
        {value}
      </span>
    </div>
  );
}

type MakeOpmcPageProps = {
  days: number;
  riskFilter: RiskFilter;
  manualOnly: 'all' | 'yes' | 'no';
  statusFilter: string;
  source: string | null;
  hasData: boolean;
  errorKind: 'transport' | 'upstream' | null;
  filteredOrders: AntiFraudOrdersResponse['items'];
  quickReviewOrders: AntiFraudOrdersResponse['items'];
  summary?: AntiFraudOrdersResponse['summary'];
  generatedAt: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string;
  onRefresh: () => void;
  onDaysChange: (value: number) => void;
  onRiskFilterChange: (value: RiskFilter) => void;
  onManualOnlyChange: (value: 'all' | 'yes' | 'no') => void;
  onStatusFilterChange: (value: string) => void;
};

export function MakeOpmcPage({
  days,
  riskFilter,
  manualOnly,
  statusFilter,
  source,
  hasData,
  errorKind,
  filteredOrders,
  quickReviewOrders,
  summary,
  generatedAt,
  isLoading,
  isFetching,
  isError,
  errorMessage,
  onRefresh,
  onDaysChange,
  onRiskFilterChange,
  onManualOnlyChange,
  onStatusFilterChange,
}: MakeOpmcPageProps) {
  const navigate = useNavigate();
  const showLoadingState = isLoading && !hasData;
  const showErrorState = isError && !hasData;
  const showWarningRail = isError && hasData;
  const sourceLabel = hasData
    ? source || 'Kaynak bilinmiyor'
    : showLoadingState
      ? 'Kaynak hazirlaniyor'
      : errorKind === 'transport'
        ? 'Yerel baglanti'
        : errorKind === 'upstream'
          ? 'Upstream hatasi'
          : 'Kaynak hazirlaniyor';
  const warningTitle = errorKind === 'transport' ? 'Yerel baglanti kesildi' : 'Upstream yenileme hatasi';
  const warningMessage =
    errorKind === 'transport'
      ? 'Son gecerli OPMC verisi gosteriliyor. Backend yeniden ulasilabilir oldugunda ekran toparlanacak.'
      : 'Son gecerli OPMC verisi gosteriliyor. Risk verisi su an yeniden alinamadi.';

  return (
    <div className="flex min-h-full flex-col bg-brand-50" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="flex-shrink-0 border-b-2 border-brand-300 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-brand-100 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center border border-red-300 bg-red-100">
              <ShieldAlert className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-widest text-brand-900">OPMC İzleme Modülü</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-xs tracking-wide text-brand-500">WooCommerce siparişlerinden çekilen risk sinyalleri</p>
                <span className="border border-brand-300 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-brand-600">
                  {sourceLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end text-right">
            <span className="mb-1 text-[10px] font-black uppercase tracking-widest text-brand-400">SON GÜNCELLEME</span>
            <div className="flex items-center gap-3">
                <span className="text-sm font-black text-brand-800" style={monoStyle}>
                {dateTimeLabel(generatedAt ?? null)}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={isFetching}
                className="border border-brand-300 bg-brand-100 p-1.5 text-brand-700 transition-colors hover:bg-brand-200 disabled:opacity-50"
                title="Veriyi Yenile"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 bg-brand-50/50 px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center border border-brand-300 bg-white">
              <span className="border-r border-brand-200 bg-brand-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-brand-500">GÜN</span>
              <CommittedNumericInput
                value={days}
                rules={{ kind: 'integer', required: true, allowNegative: false, min: 1 }}
                onCommit={(value) => { if (value !== null) onDaysChange(value); }}
                className="w-12 py-1.5 text-center text-xs font-black text-brand-900 outline-none"
                style={monoStyle}
              />
            </div>

            <div className="mx-2 h-6 w-px bg-brand-300" />

            <div className="flex items-center border border-brand-300 bg-white">
              <span className="border-r border-brand-200 bg-brand-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-brand-500">RİSK</span>
              <select
                value={riskFilter}
                onChange={(event) => onRiskFilterChange(event.target.value as RiskFilter)}
                className="appearance-none bg-transparent px-2 py-1.5 text-xs font-bold text-brand-800 outline-none"
              >
                <option value="all">Tümü</option>
                <option value="high">Yüksek</option>
                <option value="medium">Orta</option>
                <option value="low">Düşük</option>
                <option value="unknown">Belirsiz</option>
              </select>
            </div>

            <div className="flex items-center border border-brand-300 bg-white">
              <span className="border-r border-brand-200 bg-brand-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-brand-500">DURUM</span>
              <select
                value={statusFilter}
                onChange={(event) => onStatusFilterChange(event.target.value)}
                className="appearance-none bg-transparent px-2 py-1.5 text-xs font-bold text-brand-800 outline-none"
              >
                <option value="all">Tümü</option>
                <option value="processing">İşleniyor</option>
                <option value="pending">Beklemede</option>
                <option value="completed">Tamamlandı</option>
                <option value="cancelled">İptal</option>
              </select>
            </div>

            <div className="flex items-center border border-brand-300 bg-white">
              <span className="border-r border-brand-200 bg-brand-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-brand-500">MANUEL</span>
              <select
                value={manualOnly}
                onChange={(event) => onManualOnlyChange(event.target.value as 'all' | 'yes' | 'no')}
                className="appearance-none bg-transparent px-2 py-1.5 text-xs font-bold text-brand-800 outline-none"
              >
                <option value="all">Tümü</option>
                <option value="yes">Evet</option>
                <option value="no">Hayır</option>
              </select>
            </div>
          </div>

          <div className="text-[10px] font-black uppercase tracking-widest text-brand-500">
            Filtrelenen:
            <span className="ml-1 text-sm text-brand-900" style={monoStyle}>
              {filteredOrders.length}
            </span>
          </div>
        </div>
      </div>

      {showWarningRail ? (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-800">{warningTitle}</span>
          </div>
          <p className="mt-1 text-xs font-medium text-amber-800">{warningMessage}</p>
          <p className="mt-1 text-[11px] text-amber-700">{errorMessage}</p>
        </div>
      ) : null}

      <div className="grid flex-shrink-0 grid-cols-3 border-b-2 border-brand-300 bg-white md:grid-cols-6 xl:grid-cols-9">
        <SummaryMetric label="Toplam" value={summary?.total_orders ?? 0} icon={<ClipboardList className="h-3.5 w-3.5 text-brand-400" />} background="bg-brand-50/50" border="border-brand-200" valueClass="text-brand-900" />
        <SummaryMetric label="Yüksek Risk" value={summary?.high_risk_count ?? 0} icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />} background="bg-red-50" border="border-red-200" valueClass="text-red-700" />
        <SummaryMetric label="Orta Risk" value={summary?.medium_risk_count ?? 0} icon={<AlertCircle className="h-3.5 w-3.5 text-amber-500" />} background="bg-amber-50" border="border-amber-200" valueClass="text-amber-700" />
        <SummaryMetric label="Düşük Risk" value={summary?.low_risk_count ?? 0} icon={<CheckCircle className="h-3.5 w-3.5 text-emerald-500" />} background="bg-emerald-50" border="border-emerald-200" valueClass="text-emerald-700" />
        <SummaryMetric label="Belirsiz" value={summary?.unknown_risk_count ?? 0} icon={<HelpCircle className="h-3.5 w-3.5 text-slate-400" />} background="bg-slate-50" border="border-slate-200" valueClass="text-slate-600" />
        <SummaryMetric label="Aktif İnceleme" value={summary?.active_review_count ?? summary?.manual_review_count ?? 0} icon={<Eye className="h-3.5 w-3.5 text-orange-500" />} background="bg-orange-50" border="border-orange-200" valueClass="text-orange-700" />
        <SummaryMetric label="Atlanan" value={summary?.skipped_whitelist_count ?? 0} icon={<CheckCircle className="h-3.5 w-3.5 text-emerald-500" />} background="bg-emerald-50" border="border-emerald-200" valueClass="text-emerald-700" />
        <SummaryMetric label="Skorsuz" value={summary?.not_scored_count ?? 0} icon={<HelpCircle className="h-3.5 w-3.5 text-slate-400" />} background="bg-slate-50" border="border-slate-200" valueClass="text-slate-600" />
        <SummaryMetric label="AI Uyarı" value={summary?.ai_alert_count ?? 0} icon={<AlertTriangle className="h-3.5 w-3.5 text-violet-500" />} background="bg-violet-50" border="border-violet-200" valueClass="text-violet-700" />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden border-r-2 border-brand-300 bg-white">
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse whitespace-nowrap text-left">
              <thead className="sticky top-0 z-sticky bg-brand-800 text-brand-100 shadow-[0_1px_0_0_#453323]">
                <tr>
                  {['Sipariş', 'Tarih', 'Durum', 'Toplam', 'Risk & Skor', 'Müşteri', 'Nedeni', ''].map((header) => (
                    <th key={header} className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${header === 'Toplam' ? 'text-right' : ''}`}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {showLoadingState ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-sm font-bold text-brand-500">
                      Risk siparisleri hazirlaniyor.
                    </td>
                  </tr>
                ) : showErrorState ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">
                        {errorKind === 'transport' ? 'Yerel baglanti' : 'Upstream'}
                      </p>
                      <p className="mt-2 text-sm font-bold text-brand-600">{errorMessage}</p>
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-sm font-bold text-brand-400">
                      Filtrelere uygun siparis bulunamadi.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((item, index) => {
                    const tone = riskTone(item.risk_level);
                    const even = index % 2 === 0;

                    return (
                      <tr key={item.order_id} onClick={() => navigate(`/opmc/${item.order_id}`)} className={`group cursor-pointer transition-colors ${even ? 'bg-white' : 'bg-brand-50/30'} hover:bg-amber-50/50`}>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            <div className={`h-6 w-1.5 ${
                              normalizeRiskLevel(item.risk_level) === 'high'
                                ? 'bg-red-500'
                                : normalizeRiskLevel(item.risk_level) === 'medium'
                                  ? 'bg-amber-500'
                                  : normalizeRiskLevel(item.risk_level) === 'low'
                                    ? 'bg-emerald-500'
                                    : 'bg-slate-300'
                            }`} />
                            <span className="text-sm font-black text-brand-900" style={monoStyle}>{item.order_number || item.order_id}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-xs font-bold text-brand-600" style={monoStyle}>{dateTimeLabel(item.date_created ?? null)}</td>
                        <td className="px-4 py-3 align-middle">
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${statusTone(item.status)}`}>
                            {formatOrderStatus(item.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <span className="font-black text-brand-900" style={monoStyle}>{item.total ? `${Number(item.total).toLocaleString(document.documentElement.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DKK` : '—'}</span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-black ${tone.soft}`}>
                              {tone.icon}
                              {tone.label}
                              <span style={monoStyle}>· {item.risk_score ?? '—'}</span>
                            </span>
                            {/* O8 — Skor kaynağı badge */}
                            {item.risk_score_source && item.risk_score_source !== 'unknown' ? (
                              <span
                                className={`border px-1 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                  item.risk_score_source === 'manual_override'
                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                    : item.risk_score_source === 'whitelist'
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : item.risk_score_source === 'blacklist'
                                        ? 'border-rose-300 bg-rose-50 text-rose-700'
                                        : item.risk_score_source === 'known_customer'
                                          ? 'border-sky-300 bg-sky-50 text-sky-700'
                                          : item.risk_score_source === 'opmc'
                                            ? 'border-brand-300 bg-brand-100 text-brand-700'
                                            : 'border-amber-300 bg-amber-50 text-amber-700'
                                }`}
                                title={
                                  item.raw_risk_score != null && item.raw_risk_score !== item.risk_score
                                    ? `Override: ham skor ${item.raw_risk_score}, etkin ${item.risk_score}`
                                    : undefined
                                }
                              >
                                {item.risk_score_source === 'manual_override'
                                  ? 'Manuel'
                                  : item.risk_score_source === 'whitelist'
                                    ? 'Beyaz Liste'
                                    : item.risk_score_source === 'blacklist'
                                      ? 'Kara Liste'
                                      : item.risk_score_source === 'known_customer'
                                        ? 'Bilinen Müşteri'
                                        : item.risk_score_source === 'opmc'
                                          ? 'OPMC'
                                          : 'AI'}
                              </span>
                            ) : null}
                            {item.assessment_status === 'skipped_whitelist' ? (
                              <span className="border border-emerald-300 bg-emerald-50 px-1 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">Kontrol Atlandı</span>
                            ) : item.assessment_status === 'not_scored' ? (
                              <span className="border border-slate-300 bg-slate-100 px-1 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600">Skor Yok</span>
                            ) : null}
                            {item.customer_history?.known_safe ? (
                              <span className="border border-sky-300 bg-sky-50 px-1 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-700">
                                {item.customer_history.successful_orders} eski sipariş
                              </span>
                            ) : null}
                            {item.review_queue_status === 'active' ? <span className="border border-orange-300 bg-orange-100 px-1 py-0.5 text-[9px] font-black uppercase tracking-wider text-orange-700">AKTİF İNCELEME</span> : null}
                            {item.review_queue_status === 'historical' ? <span className="border border-slate-300 bg-slate-100 px-1 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600">GEÇMİŞ SİNYAL</span> : null}
                            {item.score_consistency === 'mismatch' ? <span className="border border-red-300 bg-red-50 px-1 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-700">SKOR UYUŞMAZLIĞI</span> : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <p className="text-sm font-black text-brand-800">{item.customer_name || 'Müşteri yok'}</p>
                          <p className="text-xs font-medium text-brand-500">{item.customer_email || '-'}</p>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className="text-xs font-bold text-brand-600">{item.risk_reasons.length} sinyal</span>
                          <p className="mt-0.5 text-[10px] font-medium text-brand-400">Detay için tıkla</p>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <ChevronRight className="inline-block h-5 w-5 text-brand-300 transition-colors group-hover:text-amber-600" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex w-72 flex-shrink-0 flex-col bg-brand-50">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-orange-300 bg-orange-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-orange-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-orange-800">Bekleyen İnceleme</span>
            </div>
            <span className="rounded-sm bg-orange-200 px-1.5 py-0.5 text-xs font-black text-orange-800" style={monoStyle}>
              {quickReviewOrders.length}
            </span>
          </div>

          <div className="flex-1 space-y-2 overflow-auto p-2">
            {showErrorState ? (
              <div className="border border-brand-200 bg-white p-4 text-center text-xs font-bold text-brand-500">
                {errorKind === 'transport'
                  ? 'Yerel backend baglantisi su an kurulamadigi icin inceleme listesi acilamadi.'
                  : 'Manuel inceleme listesi şu an yenilenemedi.'}
              </div>
            ) : quickReviewOrders.length === 0 ? (
              <div className="p-4 text-center text-xs font-bold text-brand-400">İnceleme bekleyen sipariş yok.</div>
            ) : (
              quickReviewOrders.map((item) => {
                const tone = riskTone(item.risk_level);
                return (
                  <button key={item.order_id} type="button" onClick={() => navigate(`/opmc/${item.order_id}`)} className="group w-full cursor-pointer border border-brand-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-orange-400">
                    <div className="mb-2 flex items-start justify-between">
                      <span className="text-sm font-black text-brand-900 transition-colors group-hover:text-orange-700" style={monoStyle}>{item.order_number || item.order_id}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${tone.soft}`}>{tone.label}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="mr-2 truncate font-bold text-brand-600" style={monoStyle}>
                        {item.total ? `${Number(item.total).toLocaleString(document.documentElement.lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DKK` : '—'}
                      </span>
                      <span className="font-bold text-brand-400">Skor:<span className="ml-1 font-black text-brand-800" style={monoStyle}>{item.risk_score ?? '—'}</span></span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
