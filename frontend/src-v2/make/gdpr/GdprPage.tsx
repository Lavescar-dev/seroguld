import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileKey2,
  RefreshCw,
  ShieldCheck,
  ShieldEllipsis,
  ShieldX,
  Trash2,
} from 'lucide-react';

import { downloadAuthedDocument } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';

import type {
  GdprJob,
  GdprProcessor,
  GdprRequestDetail,
  GdprRequestListItem,
  GdprRetentionPolicy,
} from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

type GdprPageProps = {
  overview: {
    open_request_count: number;
    due_soon_count: number;
    overdue_count: number;
    completed_30d_count: number;
    eligible_pseudonymize_count: number;
    locked_product_count: number;
    processor_warning_count: number;
    queued_job_count: number;
    failed_job_count: number;
    last_scan_at?: string | null;
    last_run_at?: string | null;
    readiness_checks: Array<{ name: string; ok: boolean; detail?: string | null }>;
  } | null;
  requests: GdprRequestListItem[];
  jobs: GdprJob[];
  selectedRequestId: string | null;
  setSelectedRequestId: (value: string | null) => void;
  selectedRequest: GdprRequestListItem | null;
  requestDetail: GdprRequestDetail | null;
  retentionPolicies: GdprRetentionPolicy[];
  processors: GdprProcessor[];
  publicConfig: {
    privacy_request_url: string;
    privacy_policy_url: string;
    cookies_url: string;
    website_url?: string | null;
    wordpress_url?: string | null;
    company_name: string;
    privacy_email?: string | null;
  } | null;
  bridgeConfig: {
    version: string;
    updated_at: string;
    company_name: string;
    company_email?: string | null;
    company_phone?: string | null;
    company_address?: string | null;
    company_cvr?: string | null;
    website_url?: string | null;
    wordpress_url?: string | null;
    privacy_request_url: string;
    privacy_policy_url: string;
    cookies_url: string;
    cookie_config_url: string;
    cookie_categories: Array<{ key: string; title: string; required: boolean; description: string }>;
  } | null;
  statusFilter: string;
  customerFilter: string | null;
  setStatusFilter: (value: string) => void;
  clearCustomerFilter: () => void;
  isLoading: boolean;
  isRefreshing: boolean;
  activeMutation: boolean;
  onRefresh: () => void;
  onVerify: (requestId: string, customerId: string) => Promise<unknown>;
  onApprove: (requestId: string, reason?: string) => Promise<unknown>;
  onReject: (requestId: string, reason?: string) => Promise<unknown>;
  onEnqueue: (requestId: string) => Promise<unknown>;
  onExecute: (requestId: string) => Promise<unknown>;
  onUpdatePolicy: (payload: {
    policyKey: string;
    title?: string;
    description?: string;
    action?: string;
    retention_days?: number;
    is_enabled?: boolean;
  }) => Promise<unknown>;
};

function overviewCard(label: string, value: string | number, tone: string) {
  return (
    <div className={`border px-4 py-3 ${tone}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.24em]">{label}</p>
      <p className="mt-2 text-2xl font-black" style={monoStyle}>
        {value}
      </p>
    </div>
  );
}

function requestStatusTone(value?: string | null) {
  switch (value) {
    case 'completed':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    case 'completed_with_warnings':
      return 'border-amber-300 bg-amber-50 text-amber-700';
    case 'failed':
    case 'rejected':
      return 'border-rose-300 bg-rose-50 text-rose-700';
    case 'approved':
    case 'verified':
    case 'queued':
      return 'border-sky-300 bg-sky-50 text-sky-700';
    default:
      return 'border-brand-300 bg-white text-brand-700';
  }
}

function processorTone(status: string) {
  switch (status) {
    case 'healthy':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800';
    case 'disabled':
      return 'border-brand-300 bg-brand-50 text-brand-600';
    case 'missing':
    case 'degraded':
      return 'border-amber-300 bg-amber-50 text-amber-800';
    default:
      return 'border-brand-300 bg-white text-brand-700';
  }
}

function jobTone(status: string) {
  switch (status) {
    case 'completed':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    case 'completed_with_warnings':
      return 'border-amber-300 bg-amber-50 text-amber-700';
    case 'failed':
      return 'border-rose-300 bg-rose-50 text-rose-700';
    case 'running':
      return 'border-sky-300 bg-sky-50 text-sky-700';
    case 'skipped':
      return 'border-brand-300 bg-brand-50 text-brand-700';
    default:
      return 'border-brand-300 bg-white text-brand-700';
  }
}

function wooSyncTone(status: string) {
  switch (status) {
    case 'synced':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    case 'remote_error':
      return 'border-rose-300 bg-rose-50 text-rose-700';
    case 'ambiguous':
    case 'no_match':
      return 'border-amber-300 bg-amber-50 text-amber-700';
    default:
      return 'border-brand-300 bg-brand-50 text-brand-700';
  }
}

function extractWooSync(resultJson?: Record<string, unknown> | null) {
  const raw = resultJson?.woo_sync;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const payload = raw as Record<string, unknown>;
  return {
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    matchedBy: typeof payload.matched_by === 'string' ? payload.matched_by : null,
    updatedIds: Array.isArray(payload.updated_ids) ? payload.updated_ids.length : 0,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.filter((item): item is string => typeof item === 'string') : [],
  };
}

export function MakeGdprPage({
  overview,
  requests,
  jobs,
  selectedRequestId,
  setSelectedRequestId,
  selectedRequest,
  requestDetail,
  retentionPolicies,
  processors,
  publicConfig,
  bridgeConfig,
  statusFilter,
  customerFilter,
  setStatusFilter,
  clearCustomerFilter,
  isLoading,
  isRefreshing,
  activeMutation,
  onRefresh,
  onVerify,
  onApprove,
  onReject,
  onEnqueue,
  onExecute,
  onUpdatePolicy,
}: GdprPageProps) {
  const toast = useToast();
  const [decisionReason, setDecisionReason] = useState('');
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, { retention_days: string; action: string; is_enabled: boolean }>>({});
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | 'queued' | 'running' | 'failed' | 'completed'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const policyState = (policy: GdprRetentionPolicy) =>
    policyDrafts[policy.policy_key] || {
      retention_days: String(policy.retention_days),
      action: policy.action,
      is_enabled: policy.is_enabled,
    };

  const activeWarnings = useMemo(
    () => overview?.readiness_checks.filter((item) => !item.ok) || [],
    [overview],
  );
  const wordpressSnippet = useMemo(() => {
    if (!bridgeConfig) return '';
    return [
      '<ul class="seroguld-gdpr-links">',
      `  <li><a href="${bridgeConfig.privacy_policy_url}">Privatlivspolitik</a></li>`,
      `  <li><a href="${bridgeConfig.cookies_url}">Cookies</a></li>`,
      `  <li><a href="${bridgeConfig.privacy_request_url}">Anmod om dataindsigt</a></li>`,
      '</ul>',
    ].join('\n');
  }, [bridgeConfig]);
  const filteredJobs = useMemo(() => {
    if (jobStatusFilter === 'all') return jobs;
    if (jobStatusFilter === 'completed') {
      return jobs.filter((job) => ['completed', 'completed_with_warnings'].includes(job.status));
    }
    return jobs.filter((job) => job.status === jobStatusFilter);
  }, [jobStatusFilter, jobs]);
  const latestWooSync = useMemo(
    () => extractWooSync(requestDetail?.latest_job?.result_json || null),
    [requestDetail?.latest_job?.result_json],
  );

  const copyText = async (key: string, value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1800);
    } catch (error) {
      console.error('Copy failed', error);
      toast.error('Pano kopyalanamadı', 'Metin panoya yazılamadı; tarayıcı izinlerini kontrol edin.');
    }
  };

  return (
    <div className="min-h-full bg-white" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="border-b-2 border-brand-300 bg-brand-50 px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-500">GDPR</p>
            <h1 className="mt-1 text-3xl font-black text-brand-950">Veri Hakları ve Saklama Cockpit’i</h1>
            <p className="mt-2 max-w-3xl text-sm text-brand-600">
              CRM authoritative GDPR queue, retention ve public privacy surface burada yönetilir. WordPress privacy/cookie linkleri CRM public sayfalarına bridge edilir.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Yenile
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {overviewCard('Açık Request', overview?.open_request_count ?? '—', 'border-brand-300 bg-white text-brand-900')}
          {overviewCard('Yaklaşan SLA', overview?.due_soon_count ?? '—', 'border-sky-300 bg-sky-50 text-sky-800')}
          {overviewCard('Geciken', overview?.overdue_count ?? '—', 'border-amber-300 bg-amber-50 text-amber-800')}
          {overviewCard('Tamamlanan 30g', overview?.completed_30d_count ?? '—', 'border-emerald-300 bg-emerald-50 text-emerald-800')}
          {overviewCard('Pseudonymize Adayı', overview?.eligible_pseudonymize_count ?? '—', 'border-rose-300 bg-rose-50 text-rose-800')}
          {overviewCard('GDPR Lock Ürün', overview?.locked_product_count ?? '—', 'border-brand-300 bg-brand-50 text-brand-800')}
          {overviewCard('Queued Job', overview?.queued_job_count ?? '—', 'border-sky-300 bg-sky-50 text-sky-800')}
          {overviewCard('Failed Job', overview?.failed_job_count ?? '—', 'border-rose-300 bg-rose-50 text-rose-800')}
          {overviewCard('Processor Warning', overview?.processor_warning_count ?? '—', 'border-amber-300 bg-amber-50 text-amber-800')}
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <div className="border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-500">Last Retention Scan</p>
            <p className="mt-2 text-sm font-semibold text-brand-900">{overview?.last_scan_at ? formatDate(overview.last_scan_at) : 'Henüz çalışmadı'}</p>
          </div>
          <div className="border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-500">Last Job Runner</p>
            <p className="mt-2 text-sm font-semibold text-brand-900">{overview?.last_run_at ? formatDate(overview.last_run_at) : 'Henüz çalışmadı'}</p>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="border-2 border-brand-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-brand-200 bg-brand-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Requests</p>
                <p className="mt-1 text-sm text-brand-600">Public veya admin kaynaklı GDPR taleplerini doğrula, karar ver ve yürüt.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                >
                  <option value="all">Tüm statüler</option>
                  <option value="identity_pending">Identity pending</option>
                  <option value="verified">Verified</option>
                  <option value="approved">Approved</option>
                  <option value="queued">Queued</option>
                  <option value="executing">Executing</option>
                  <option value="completed">Completed</option>
                  <option value="completed_with_warnings">Completed with warnings</option>
                  <option value="rejected">Rejected</option>
                  <option value="failed">Failed</option>
                </select>
                {customerFilter ? (
                  <button
                    type="button"
                    onClick={clearCustomerFilter}
                    className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-amber-700"
                  >
                    <FileKey2 className="h-3.5 w-3.5" />
                    Customer filtresi aktif
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid min-h-[560px] xl:grid-cols-[320px_minmax(0,1fr)]">
              <div className="border-r border-brand-200">
                <div className="max-h-[640px] overflow-y-auto">
                  {isLoading && !requests.length ? (
                    <div className="px-4 py-6 text-sm text-brand-500">GDPR queue yükleniyor…</div>
                  ) : null}
                  {!isLoading && !requests.length ? (
                    <div className="px-4 py-6 text-sm text-brand-500">Bu filtrede request yok.</div>
                  ) : null}
                  {requests.map((item) => {
                    const active = item.id === selectedRequestId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedRequestId(item.id)}
                        className={`block w-full border-b border-brand-200 px-4 py-4 text-left transition ${
                          active ? 'bg-brand-900 text-white' : 'hover:bg-brand-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`text-xs font-black uppercase tracking-[0.22em] ${active ? 'text-amber-300' : 'text-brand-500'}`}>
                              {item.reference_number}
                            </p>
                            <p className={`mt-1 truncate text-sm font-semibold ${active ? 'text-white' : 'text-brand-900'}`}>
                              {item.subject_name || 'İsimsiz request'}
                            </p>
                            <p className={`mt-1 text-xs ${active ? 'text-brand-200' : 'text-brand-500'}`}>
                              {item.subject_email || item.subject_phone || item.channel}
                            </p>
                          </div>
                          <span className={`border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${requestStatusTone(item.status)}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className={`mt-3 flex items-center justify-between text-xs ${active ? 'text-brand-300' : 'text-brand-500'}`}>
                          <span>{item.request_type}</span>
                          <span style={monoStyle}>{formatDate(item.submitted_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-[560px] bg-white">
                {selectedRequest && requestDetail ? (
                  <div className="space-y-5 p-5">
                    <div className="flex flex-col gap-3 border-b border-brand-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-500">{requestDetail.reference_number}</p>
                        <h2 className="mt-1 text-2xl font-black text-brand-950">{requestDetail.subject_name || 'GDPR Request'}</h2>
                        <p className="mt-2 text-sm text-brand-600">
                          {requestDetail.subject_email || 'E-mail yok'} · {requestDetail.subject_phone || 'Telefon yok'}
                        </p>
                        {requestDetail.message ? <p className="mt-3 text-sm leading-6 text-brand-700">{requestDetail.message}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <div className={`inline-flex border px-3 py-2 text-xs font-black uppercase tracking-widest ${requestStatusTone(requestDetail.status)}`}>
                          {requestDetail.status}
                        </div>
                        {requestDetail.export_download_path ? (
                          <button
                            type="button"
                            onClick={() => void downloadAuthedDocument(requestDetail.export_download_path!, `${requestDetail.reference_number}.zip`)}
                            className="flex w-full items-center justify-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-emerald-700"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Export indir
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="space-y-4">
                        <div className="border border-brand-200 bg-brand-50 p-4">
                          <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Doğrulama</p>
                          {requestDetail.verified_customer_name ? (
                            <p className="mt-2 text-sm font-semibold text-emerald-700">
                              Eşleşen müşteri: {requestDetail.verified_customer_name}
                            </p>
                          ) : (
                            <p className="mt-2 text-sm text-brand-600">Henüz doğrulanmış müşteri seçilmedi.</p>
                          )}
                          {requestDetail.match_candidates.length ? (
                            <div className="mt-3 grid gap-2">
                              {requestDetail.match_candidates.map((candidate) => (
                                <button
                                  key={candidate.id}
                                  type="button"
                                  onClick={() => void onVerify(requestDetail.id, candidate.id)}
                                  className="flex items-center justify-between border border-brand-300 bg-white px-3 py-2 text-left hover:border-brand-700 hover:bg-brand-100"
                                >
                                  <div>
                                    <p className="text-sm font-semibold text-brand-900">{candidate.name}</p>
                                    <p className="text-xs text-brand-500">{candidate.email || candidate.phone || candidate.cpr_number_masked || '-'}</p>
                                  </div>
                                  <span className="text-xs font-black uppercase tracking-widest text-brand-500">Verify</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="border border-brand-200 bg-white p-4">
                          <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Karar ve Çalıştırma</p>
                          <textarea
                            value={decisionReason}
                            onChange={(event) => setDecisionReason(event.target.value)}
                            className="mt-3 min-h-[96px] w-full border border-brand-300 px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                            placeholder="Karar gerekçesi veya operatör notu"
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={activeMutation}
                              onClick={() => void onApprove(requestDetail.id, decisionReason)}
                              className="inline-flex items-center gap-2 border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-sky-700 disabled:opacity-60"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={activeMutation}
                              onClick={() => void onReject(requestDetail.id, decisionReason)}
                              className="inline-flex items-center gap-2 border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-rose-700 disabled:opacity-60"
                            >
                              <ShieldX className="h-3.5 w-3.5" />
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={activeMutation}
                              onClick={() => void onEnqueue(requestDetail.id)}
                              className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 disabled:opacity-60"
                            >
                              <Clock3 className="h-3.5 w-3.5" />
                              Enqueue
                            </button>
                            <button
                              type="button"
                              disabled={activeMutation}
                              onClick={() => void onExecute(requestDetail.id)}
                              className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-emerald-700 disabled:opacity-60"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Execute
                            </button>
                          </div>
                          {requestDetail.latest_job ? (
                            <div className="mt-4 border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-600">
                              <p className="font-black uppercase tracking-widest text-brand-500">Son Job</p>
                              <p className="mt-1">{requestDetail.latest_job.job_type} · {requestDetail.latest_job.status}</p>
                              {requestDetail.latest_job.completed_at ? <p className="mt-1">{formatDate(requestDetail.latest_job.completed_at)}</p> : null}
                              {latestWooSync ? (
                                <div className={`mt-3 border px-3 py-2 ${wooSyncTone(latestWooSync.status)}`}>
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] font-black uppercase tracking-widest">Woo Privacy Sync</p>
                                    <span className="text-[10px] font-black uppercase tracking-widest">
                                      {latestWooSync.status.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-[11px]">
                                    {latestWooSync.matchedBy ? `matched_by=${latestWooSync.matchedBy}` : 'eşleşme yok'} · {latestWooSync.updatedIds} kayıt
                                  </p>
                                  {latestWooSync.warnings.length ? (
                                    <p className="mt-1 text-[11px]">{latestWooSync.warnings.join(' · ')}</p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="border border-brand-200 bg-brand-50 p-4">
                          <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Timeline</p>
                          <div className="mt-3 space-y-3">
                            {requestDetail.events.map((event) => (
                              <div key={event.id} className="border-l-2 border-brand-300 pl-3">
                                <p className="text-xs font-black uppercase tracking-widest text-brand-500">{event.event_type}</p>
                                <p className="mt-1 text-sm text-brand-800">{event.message || 'Mesaj yok'}</p>
                                <p className="mt-1 text-[11px] text-brand-500">{formatDate(event.created_at)}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {requestDetail.decision_reason ? (
                          <div className="border border-amber-300 bg-amber-50 p-4">
                            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Decision reason</p>
                            <p className="mt-2 text-sm text-amber-800">{requestDetail.decision_reason}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[560px] items-center justify-center text-sm text-brand-400">
                    İncelemek için soldan bir GDPR request seçin.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border-2 border-brand-200 bg-white">
              <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">WordPress Bridge</p>
              </div>
              <div className="space-y-3 px-4 py-4">
                {publicConfig && bridgeConfig ? (
                  <>
                    <a href={publicConfig.privacy_policy_url} target="_blank" rel="noreferrer" className="flex items-center justify-between border border-brand-300 bg-brand-50 px-3 py-3 hover:border-brand-700 hover:bg-brand-100">
                      <div>
                        <p className="text-sm font-semibold text-brand-900">Privacy Policy</p>
                        <p className="text-xs text-brand-500">{publicConfig.company_name}</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-brand-500" />
                    </a>
                    <a href={publicConfig.cookies_url} target="_blank" rel="noreferrer" className="flex items-center justify-between border border-brand-300 bg-brand-50 px-3 py-3 hover:border-brand-700 hover:bg-brand-100">
                      <div>
                        <p className="text-sm font-semibold text-brand-900">Cookies</p>
                        <p className="text-xs text-brand-500">WordPress bridge link</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-brand-500" />
                    </a>
                    <a href={publicConfig.privacy_request_url} target="_blank" rel="noreferrer" className="flex items-center justify-between border border-brand-300 bg-brand-50 px-3 py-3 hover:border-brand-700 hover:bg-brand-100">
                      <div>
                        <p className="text-sm font-semibold text-brand-900">Request Center</p>
                        <p className="text-xs text-brand-500">{publicConfig.privacy_email || publicConfig.website_url || 'CRM public page'}</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-brand-500" />
                    </a>
                    <div className="border border-brand-200 bg-white p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-500">Cookie Config Endpoint</p>
                      <p className="mt-2 break-all text-xs text-brand-700" style={monoStyle}>
                        {bridgeConfig.cookie_config_url}
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => void copyText('privacy-url', bridgeConfig.privacy_policy_url)}
                        className="border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        {copiedKey === 'privacy-url' ? 'Kopyalandı' : 'Copy Privacy URL'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyText('cookies-url', bridgeConfig.cookies_url)}
                        className="border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        {copiedKey === 'cookies-url' ? 'Kopyalandı' : 'Copy Cookies URL'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyText('request-url', bridgeConfig.privacy_request_url)}
                        className="border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        {copiedKey === 'request-url' ? 'Kopyalandı' : 'Copy Request Center URL'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyText('cookie-config-url', bridgeConfig.cookie_config_url)}
                        className="border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        {copiedKey === 'cookie-config-url' ? 'Kopyalandı' : 'Copy Cookie Config URL'}
                      </button>
                    </div>
                    <div className="border border-brand-200 bg-white p-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-500">Footer Snippet</p>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-brand-700" style={monoStyle}>
                        {wordpressSnippet}
                      </pre>
                      <button
                        type="button"
                        onClick={() => void copyText('footer-snippet', wordpressSnippet)}
                        className="mt-3 border border-brand-300 bg-brand-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        {copiedKey === 'footer-snippet' ? 'Kopyalandı' : 'Copy Footer Snippet'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-brand-500">Public link bilgileri yükleniyor…</p>
                )}
              </div>
            </div>

            <div className="border-2 border-brand-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Jobs</p>
                <select
                  value={jobStatusFilter}
                  onChange={(event) => setJobStatusFilter(event.target.value as typeof jobStatusFilter)}
                  className="border border-brand-300 bg-white px-2 py-1 text-xs text-brand-900 outline-none focus:border-brand-700"
                >
                  <option value="all">All</option>
                  <option value="queued">Queued</option>
                  <option value="running">Running</option>
                  <option value="failed">Failed</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div className="grid gap-3 px-4 py-4">
                {filteredJobs.length ? (
                  filteredJobs.slice(0, 8).map((job) => (
                    <div key={job.id} className={`border p-3 ${jobTone(job.status)}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{job.request_reference_number || job.job_type}</p>
                          <p className="text-xs opacity-80">{job.job_type}</p>
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest">{job.status}</span>
                      </div>
                      <p className="mt-2 text-[11px] opacity-80">{formatDate(job.created_at)}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-brand-500">Bu filtrede runner/job kaydı yok.</p>
                )}
              </div>
            </div>

            <div className="border-2 border-brand-200 bg-white">
              <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Systems</p>
              </div>
              <div className="grid gap-3 px-4 py-4">
                {processors.map((processor) => (
                  <div key={processor.id} className={`border p-3 ${processorTone(processor.status)}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{processor.title}</p>
                        <p className="text-xs opacity-80">{processor.system_name}</p>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest">{processor.status}</span>
                    </div>
                    {processor.detail ? <p className="mt-2 text-xs opacity-90">{processor.detail}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="border-2 border-brand-200 bg-white">
            <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Retention Policies</p>
            </div>
            <div className="grid gap-3 p-4">
              {retentionPolicies.map((policy) => {
                const draft = policyState(policy);
                return (
                  <div key={policy.id} className="border border-brand-200 bg-brand-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-brand-900">{policy.title}</p>
                        <p className="mt-1 text-xs text-brand-500">{policy.description || policy.applies_to}</p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-brand-600">
                        <input
                          type="checkbox"
                          checked={draft.is_enabled}
                          onChange={(event) =>
                            setPolicyDrafts((current) => ({
                              ...current,
                              [policy.policy_key]: { ...draft, is_enabled: event.target.checked },
                            }))
                          }
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-[140px_180px_auto]">
                      <input
                        type="number"
                        min={1}
                        value={draft.retention_days}
                        onChange={(event) =>
                          setPolicyDrafts((current) => ({
                            ...current,
                            [policy.policy_key]: { ...draft, retention_days: event.target.value },
                          }))
                        }
                        className="border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                      />
                      <input
                        type="text"
                        value={draft.action}
                        onChange={(event) =>
                          setPolicyDrafts((current) => ({
                            ...current,
                            [policy.policy_key]: { ...draft, action: event.target.value },
                          }))
                        }
                        className="border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900 outline-none focus:border-brand-700"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void onUpdatePolicy({
                            policyKey: policy.policy_key,
                            retention_days: Number.parseInt(draft.retention_days, 10) || policy.retention_days,
                            action: draft.action,
                            is_enabled: draft.is_enabled,
                          })
                        }
                        className="inline-flex items-center justify-center gap-2 border border-brand-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                        Kaydet
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-brand-500">Son güncelleme: {formatDate(policy.updated_at)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-2 border-brand-200 bg-white">
            <div className="border-b border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-500">Readiness</p>
            </div>
            <div className="grid gap-3 p-4">
              {activeWarnings.length ? (
                activeWarnings.map((check) => (
                  <div key={check.name} className="border border-amber-300 bg-amber-50 p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-700" />
                      <p className="text-sm font-semibold text-amber-800">{check.name}</p>
                    </div>
                    {check.detail ? <p className="mt-2 text-xs text-amber-700">{check.detail}</p> : null}
                  </div>
                ))
              ) : (
                <div className="border border-emerald-300 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    <p className="text-sm font-semibold text-emerald-800">GDPR systems green</p>
                  </div>
                  <p className="mt-2 text-xs text-emerald-700">Backup, offsite ve runtime health şu an action gerektirmiyor.</p>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="border border-brand-200 bg-brand-50 p-3">
                  <div className="flex items-center gap-2">
                    <ShieldEllipsis className="h-4 w-4 text-brand-700" />
                    <p className="text-sm font-semibold text-brand-900">Pseudonymize varsayılanı</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-brand-600">Ledger ve pos documents korunur; customer master ve identity alanları redacted edilir.</p>
                </div>
                <div className="border border-brand-200 bg-brand-50 p-3">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-brand-700" />
                    <p className="text-sm font-semibold text-brand-900">WordPress bridge</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-brand-600">Public privacy/cookie/request linkleri CRM public pages’e yönlenir; Woo privacy sync explicit ID ve benzersiz exact eşleşme ile çalışır.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
