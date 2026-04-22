import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle,
  CircleCheck,
  CircleX,
  ClipboardList,
  CreditCard,
  Globe,
  HelpCircle,
  RefreshCw,
  ShieldAlert,
  StickyNote,
  User,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type { AntiFraudOrder } from '@/types';
import { formatOrderStatus, monoStyle, normalizeRiskLevel, riskTone } from '@/components/OpmcShared';

function dateTimeLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date
    .toLocaleString('tr-TR', {
      hour12: false,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');
}

function countryCityLabel(country?: string | null, city?: string | null) {
  const head = (country || '').trim();
  const tail = (city || '').trim();
  if (head && tail) return `${head} · ${tail}`;
  return head || tail || '-';
}

function RiskIcon({ level }: { level?: string | null }) {
  const normalized = normalizeRiskLevel(level);
  if (normalized === 'high') return <AlertTriangle className="h-4 w-4 text-red-600" />;
  if (normalized === 'medium') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (normalized === 'low') return <CheckCircle className="h-4 w-4 text-emerald-600" />;
  return <HelpCircle className="h-4 w-4 text-slate-400" />;
}

function InfoRow({
  label,
  value,
  mono = false,
  accent = '',
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: string;
}) {
  return (
    <div className="flex items-start border-b border-brand-100 last:border-b-0">
      <div className="w-40 flex-shrink-0 border-r border-brand-200 bg-brand-50 px-3 py-2.5">
        <span className="text-xs font-black uppercase tracking-wider text-brand-600">{label}</span>
      </div>
      <div className="flex-1 px-3 py-2.5">
        <span className={`text-sm font-semibold ${accent || 'text-brand-900'}`} style={mono ? monoStyle : undefined}>
          {value || '—'}
        </span>
      </div>
    </div>
  );
}

function OpmcField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border border-brand-200">
      <div className="border-b border-brand-200 bg-brand-100 px-3 py-2">
        <span className="text-xs font-black uppercase tracking-wider text-brand-600">{label}</span>
      </div>
      <div className="bg-white px-3 py-2.5">{children}</div>
    </div>
  );
}

type MakeOpmcDetailPageProps = {
  requestedId: string;
  detail: AntiFraudOrder | null;
  hasData: boolean;
  errorKind: 'transport' | 'upstream' | 'not_found' | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isNotFound: boolean;
  errorMessage: string;
  onRefresh: () => void;
};

export function MakeOpmcDetailPage({
  requestedId,
  detail,
  hasData,
  errorKind,
  isLoading,
  isFetching,
  isError,
  isNotFound,
  errorMessage,
  onRefresh,
}: MakeOpmcDetailPageProps) {
  const showLoadingState = isLoading && !hasData;
  const showErrorState = isError && !hasData;
  const showWarningRail = isError && hasData;
  const warningTitle = errorKind === 'transport' ? 'Yerel baglanti kesildi' : 'Detay yenileme hatasi';
  const warningMessage =
    errorKind === 'transport'
      ? 'Son gecerli OPMC detay verisi gosteriliyor. Backend yeniden ulasilabilir oldugunda ekran toparlanacak.'
      : 'Son gecerli OPMC detay verisi gosteriliyor. Risk detayi su an yeniden alinamadi.';

  if (showLoadingState) {
    return (
      <div className="min-h-full bg-white px-6 py-10" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        <div className="overflow-hidden border-2 border-brand-300 bg-white">
          <div className="border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">OPMC Risk Detayi</p>
            <p className="mt-1 text-sm text-brand-700">Siparis #{requestedId}</p>
          </div>
          <div className="px-6 py-12 text-center text-sm text-brand-500">Detay alani hazirlaniyor.</div>
        </div>
      </div>
    );
  }

  if (isNotFound && !hasData) {
    return (
      <div className="min-h-full bg-white px-6 py-10" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        <div className="overflow-hidden border-2 border-brand-300 bg-white">
          <div className="border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">OPMC Risk Detayi</p>
            <p className="mt-1 text-sm text-brand-700">Siparis #{requestedId}</p>
          </div>
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <ShieldAlert className="mb-4 h-10 w-10 text-brand-300" />
            <p className="text-lg font-black uppercase tracking-wider text-brand-600">Siparis bulunamadi</p>
            <p className="mt-2 text-sm text-brand-400" style={monoStyle}>#{requestedId}</p>
            <Link to="/opmc" className="mt-6 inline-flex items-center gap-2 bg-brand-800 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-900">
              <ArrowLeft className="h-4 w-4" />
              Listeye Don
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (showErrorState) {
    return (
      <div className="min-h-full bg-white px-6 py-10" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        <div className="overflow-hidden border-2 border-brand-300 bg-white">
          <div className="border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">OPMC Risk Detayi</p>
            <p className="mt-1 text-sm text-brand-700">Siparis #{requestedId}</p>
          </div>
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <ShieldAlert className="mb-4 h-10 w-10 text-brand-300" />
            <p className="text-lg font-black uppercase tracking-wider text-brand-600">Veri alinamadi</p>
            <p className="mt-2 max-w-lg text-sm text-brand-500">{errorMessage}</p>
            <div className="mt-6 flex items-center gap-3">
              <Link to="/opmc" className="inline-flex items-center gap-2 border border-brand-300 bg-white px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100">
                <ArrowLeft className="h-4 w-4" />
                Listeye Don
              </Link>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-2 bg-brand-800 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-900"
              >
                <RefreshCw className="h-4 w-4" />
                Tekrar Dene
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="min-h-full bg-white px-6 py-10" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
        <div className="overflow-hidden border-2 border-brand-300 bg-white">
          <div className="border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">OPMC Risk Detayi</p>
            <p className="mt-1 text-sm text-brand-700">Siparis #{requestedId}</p>
          </div>
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <ShieldAlert className="mb-4 h-10 w-10 text-brand-300" />
            <p className="text-lg font-black uppercase tracking-wider text-brand-600">Siparis bulunamadi</p>
          </div>
        </div>
      </div>
    );
  }

  const tone = riskTone(detail.risk_level);
  const mismatchCountries = detail.billing_country && detail.shipping_country && detail.billing_country !== detail.shipping_country;
  const orderLabel = detail.order_number || detail.order_id;

  return (
    <div className="flex min-h-full flex-col bg-white" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="flex-shrink-0 border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/opmc" className="inline-flex items-center gap-1.5 border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-100">
              <ArrowLeft className="h-3.5 w-3.5" />
              Listeye Dön
            </Link>

            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-brand-500" />
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-brand-500">OPMC Risk Detayı</p>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-lg font-black text-brand-900" style={monoStyle}>Sipariş {orderLabel}</span>
                  <span className="bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">{formatOrderStatus(detail.status)}</span>
                  {detail.requires_manual_review ? <span className="border border-violet-300 bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">Manuel İnceleme: Evet</span> : null}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="inline-flex items-center gap-2 border border-brand-900 bg-brand-800 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-900 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Detayı Yenile
          </button>
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

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-7xl grid-cols-3 gap-5">
          <div className="col-span-2 space-y-5">
            <div className={`overflow-hidden border-2 ${tone.soft.includes('red') ? 'border-red-300' : tone.soft.includes('amber') ? 'border-amber-300' : tone.soft.includes('emerald') ? 'border-emerald-300' : 'border-slate-300'}`}>
              <div className={`flex items-center justify-between border-b-2 px-4 py-3 ${
                tone.soft.includes('red')
                  ? 'border-red-300 bg-red-50'
                  : tone.soft.includes('amber')
                    ? 'border-amber-300 bg-amber-50'
                    : tone.soft.includes('emerald')
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-300 bg-slate-50'
              }`}>
                <div className="flex items-center gap-2">
                  <RiskIcon level={detail.risk_level} />
                  <span className={`text-xs font-black uppercase tracking-widest ${tone.soft.includes('red') ? 'text-red-700' : tone.soft.includes('amber') ? 'text-amber-700' : tone.soft.includes('emerald') ? 'text-emerald-700' : 'text-slate-700'}`}>Risk Özeti</span>
                </div>
                <span className={`border px-2 py-0.5 text-xs font-black ${tone.soft}`} style={monoStyle}>{tone.label}</span>
              </div>

              <div className="bg-white px-5 py-4">
                <div className="flex items-center gap-6">
                  <div className={`flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center border-4 ${
                    tone.soft.includes('red')
                      ? 'border-red-300 bg-red-50'
                      : tone.soft.includes('amber')
                        ? 'border-amber-300 bg-amber-50'
                        : tone.soft.includes('emerald')
                          ? 'border-emerald-300 bg-emerald-50'
                          : 'border-slate-300 bg-slate-50'
                  }`}>
                    <span className={`text-3xl font-black ${
                      tone.soft.includes('red')
                        ? 'text-red-700'
                        : tone.soft.includes('amber')
                          ? 'text-amber-700'
                          : tone.soft.includes('emerald')
                            ? 'text-emerald-700'
                            : 'text-slate-700'
                    }`} style={monoStyle}>{detail.risk_score ?? '—'}</span>
                  </div>

                  <div>
                    <p className={`text-base font-black ${
                      tone.soft.includes('red')
                        ? 'text-red-700'
                        : tone.soft.includes('amber')
                          ? 'text-amber-700'
                          : tone.soft.includes('emerald')
                            ? 'text-emerald-700'
                            : 'text-slate-700'
                    }`}>
                      Risk Seviyesi: {tone.label}
                    </p>
                    <p className="mt-1.5 text-sm text-brand-700">
                      Toplam tutar: <span className="font-black text-brand-900" style={monoStyle}>{detail.total ? `${Number(detail.total).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DKK` : '—'}</span>
                      {' · '}Ödeme: <span className="font-bold text-brand-800">{detail.payment_method || '-'}</span>
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      {detail.requires_manual_review ? (
                        <span className="inline-flex items-center gap-1.5 border border-violet-300 bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">
                          <ClipboardList className="h-3 w-3" />
                          Manuel İnceleme Kuyruğu
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                          Manuel İnceleme Yok
                        </span>
                      )}
                      <span className="text-xs text-brand-400" style={monoStyle}>{detail.risk_reasons.length} sinyal</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden border border-brand-300">
              <div className="flex items-center gap-2 border-b border-brand-700 bg-brand-800 px-4 py-2.5">
                <ShieldAlert className="h-3.5 w-3.5 text-brand-400" />
                <span className="text-xs font-black uppercase tracking-widest text-brand-300">Neden Bu Risk Skoru?</span>
              </div>
              <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs italic text-brand-500">Aşağıdaki maddeler OPMC ve AI sinyallerinden otomatik üretilmiş açıklamalardır.</p>
              </div>
              <div className="divide-y divide-brand-100 bg-white">
                {detail.risk_reasons.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-brand-500">Risk nedeni bulunmuyor.</div>
                ) : (
                  detail.risk_reasons.map((reason, index) => (
                    <div key={reason.code} className="flex items-start gap-3 px-4 py-3">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center border border-brand-300 bg-brand-100 text-xs font-black text-brand-600" style={monoStyle}>{index + 1}</span>
                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-brand-700">{reason.code}</p>
                        <p className="mt-0.5 text-sm text-brand-800">{reason.reason}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {detail.ai_explanations_human.length > 0 ? (
              <div className="overflow-hidden border border-brand-300">
                <div className="flex items-center gap-2 border-b border-indigo-700 bg-indigo-900 px-4 py-2.5">
                  <Bot className="h-3.5 w-3.5 text-indigo-300" />
                  <span className="text-xs font-black uppercase tracking-widest text-indigo-300">AI Değerlendirmesi</span>
                </div>
                <div className="divide-y divide-brand-50 bg-white">
                  {detail.ai_explanations_human.map((line, index) => (
                    <div key={`${line}-${index}`} className="flex items-start gap-2.5 px-4 py-3">
                      <span className="mt-0.5 flex-shrink-0 text-indigo-500">•</span>
                      <p className="text-sm text-brand-800">{line}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.notes_human.length > 0 ? (
              <div className="overflow-hidden border border-red-300">
                <div className="flex items-center gap-2 border-b border-red-700 bg-red-900 px-4 py-2.5">
                  <StickyNote className="h-3.5 w-3.5 text-red-300" />
                  <span className="text-xs font-black uppercase tracking-widest text-red-300">Risk Notları</span>
                </div>
                <div className="divide-y divide-red-100 bg-red-50">
                  {detail.notes_human.map((note, index) => (
                    <div key={`${note}-${index}`} className="flex items-start gap-2.5 px-4 py-3">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                      <p className="text-sm font-semibold text-red-800">{note}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-5">
            <div className="overflow-hidden border border-brand-300">
              <div className="flex items-center gap-2 border-b border-brand-700 bg-brand-800 px-4 py-2.5">
                <User className="h-3.5 w-3.5 text-brand-400" />
                <span className="text-xs font-black uppercase tracking-widest text-brand-300">Müşteri ve Sipariş Bilgisi</span>
              </div>
              <div className="divide-y divide-brand-100">
                <InfoRow label="Müşteri" value={detail.customer_name || 'Müşteri yok'} accent="font-black text-brand-900" />
                <InfoRow label="E-posta" value={detail.customer_email || '-'} mono accent="text-sky-700" />
                <InfoRow label="IP" value={detail.ip_address || '-'} mono accent="text-brand-700" />
                <div className="flex items-start border-b border-brand-100">
                  <div className="w-40 flex-shrink-0 border-r border-brand-200 bg-brand-50 px-3 py-2.5">
                    <span className="text-xs font-black uppercase tracking-wider text-brand-600">Fatura Ülkesi</span>
                  </div>
                  <div className="flex flex-1 items-center gap-1.5 px-3 py-2.5">
                    <Globe className="h-3.5 w-3.5 text-brand-400" />
                    <span className="text-sm font-bold text-brand-900" style={monoStyle}>{countryCityLabel(detail.billing_country, detail.billing_city)}</span>
                  </div>
                </div>
                <div className="flex items-start">
                  <div className="w-40 flex-shrink-0 border-r border-brand-200 bg-brand-50 px-3 py-2.5">
                    <span className="text-xs font-black uppercase tracking-wider text-brand-600">Teslimat Ülkesi</span>
                  </div>
                  <div className="flex flex-1 items-center gap-1.5 px-3 py-2.5">
                    <Globe className="h-3.5 w-3.5 text-brand-400" />
                    <span className={`text-sm font-bold ${mismatchCountries ? 'text-red-700' : 'text-brand-900'}`} style={monoStyle}>
                      {countryCityLabel(detail.shipping_country, detail.shipping_city)}
                    </span>
                    {mismatchCountries ? <AlertTriangle className="h-3 w-3 text-red-500" /> : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden border border-brand-300">
              <div className="flex items-center gap-2 border-b border-brand-700 bg-brand-900 px-4 py-2.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-black uppercase tracking-widest text-brand-300">OPMC Alanları (İnsan Dili)</span>
              </div>
              <div className="space-y-1 bg-white p-3">
                <OpmcField label="Manuel İnceleme Kuyruğu">
                  <div className="flex items-center gap-2">
                    {detail.requires_manual_review ? (
                      <>
                        <CircleCheck className="h-4 w-4 text-violet-600" />
                        <span className="text-sm font-bold text-violet-800">Evet (manuel inceleme bekliyor)</span>
                      </>
                    ) : (
                      <>
                        <CircleX className="h-4 w-4 text-slate-400" />
                        <span className="text-sm text-slate-600">Hayır</span>
                      </>
                    )}
                  </div>
                </OpmcField>

                <OpmcField label="AI Açıklamaları">
                  <span className="text-sm font-black text-indigo-700" style={monoStyle}>{detail.ai_explanations_human.length} adet AI açıklaması</span>
                </OpmcField>

                <OpmcField label="AI Risk Skoru">
                  <span className="text-lg font-black text-brand-900" style={monoStyle}>{detail.ai_risk_score ?? '—'}</span>
                </OpmcField>

                <OpmcField label="OPMC Risk Skoru">
                  <span className="text-lg font-black text-brand-900" style={monoStyle}>{detail.opmc_risk_score ?? '—'}</span>
                </OpmcField>

                {detail.whitelist_action_human ? (
                  <OpmcField label="Beyaz Liste Eylemi">
                    <div className="flex items-start gap-1.5">
                      <CheckCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-800">{detail.whitelist_action_human}</span>
                    </div>
                  </OpmcField>
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden border border-brand-300">
              <div className="flex items-center gap-2 border-b border-brand-700 bg-brand-800 px-4 py-2.5">
                <CreditCard className="h-3.5 w-3.5 text-brand-400" />
                <span className="text-xs font-black uppercase tracking-widest text-brand-300">Ödeme</span>
              </div>
              <div className="divide-y divide-brand-100">
                <InfoRow label="Yöntem" value={detail.payment_method || '-'} accent="font-bold text-brand-900" />
                <InfoRow label="Tutar" value={detail.total ? `${Number(detail.total).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DKK` : '—'} mono accent="font-black text-emerald-800" />
                <InfoRow label="Durum" value={formatOrderStatus(detail.status)} />
              </div>
            </div>

            <div className="border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-brand-500">Sipariş Tarihi</p>
              <p className="text-sm font-black text-brand-900" style={monoStyle}>{dateTimeLabel(detail.date_created ?? null)}</p>
              <p className="mt-0.5 text-xs text-brand-400" style={monoStyle}>Sipariş: {orderLabel}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
