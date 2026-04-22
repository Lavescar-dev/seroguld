import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck, ShieldEllipsis } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { apiRequest } from '@/lib/api';
import { formatDate } from '@/lib/format';

import type {
  GdprPublicCookieConfig,
  GdprPublicRequestCreateOut,
  GdprPublicRequestStatus,
  GdprPublicSiteConfig,
} from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

function PublicShell({
  config,
  title,
  eyebrow,
  children,
}: {
  config: GdprPublicSiteConfig | null;
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-brand-950 text-white" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="border border-brand-700 bg-brand-900/80 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.32em] text-amber-300">{eyebrow}</p>
              <h1 className="mt-3 text-3xl font-black text-white">{title}</h1>
              <p className="mt-4 text-sm leading-6 text-brand-200">
                Sero Guld CRM public privacy surface. WordPress privacy ve cookie linkleri bu branded sayfalara bridge edilir.
              </p>
            </div>

            <div className="border border-brand-700 bg-brand-900/70 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-400">Sero Guld</p>
              <p className="mt-2 text-sm font-semibold text-white">{config?.company_name || 'Sero Guld'}</p>
              <div className="mt-3 space-y-1 text-sm text-brand-200">
                {config?.company_address ? <p>{config.company_address}</p> : null}
                {config?.company_phone ? <p>{config.company_phone}</p> : null}
                {config?.privacy_email ? <p>{config.privacy_email}</p> : null}
                {config?.company_cvr ? <p>CVR: {config.company_cvr}</p> : null}
              </div>
            </div>

            <div className="border border-brand-700 bg-brand-900/70 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-400">Public Links</p>
              <div className="mt-3 grid gap-2 text-sm">
                <a href={config?.privacy_policy_url || '#/gdpr/privacy'} className="inline-flex items-center justify-between border border-brand-700 px-3 py-2 hover:border-amber-400 hover:text-amber-200">
                  Privacy Policy
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a href={config?.cookies_url || '#/gdpr/cookies'} className="inline-flex items-center justify-between border border-brand-700 px-3 py-2 hover:border-amber-400 hover:text-amber-200">
                  Cookies
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a href={config?.privacy_request_url || '#/gdpr/request'} className="inline-flex items-center justify-between border border-brand-700 px-3 py-2 hover:border-amber-400 hover:text-amber-200">
                  Request Center
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </aside>

          <main className="border border-brand-700 bg-white p-6 text-brand-900 md:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function usePublicSiteConfig() {
  return useQuery({
    queryKey: ['gdpr-public-site-config'],
    queryFn: () => apiRequest<GdprPublicSiteConfig>('/api/v2/public/gdpr/site-config', { auth: false }),
  });
}

export function GdprPublicPrivacyPage() {
  const configQuery = usePublicSiteConfig();
  const config = configQuery.data || null;

  return (
    <PublicShell config={config} eyebrow="Privacy" title="Persondatapolitik">
      <div className="space-y-6">
        <section>
          <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-500">Data Controller</p>
          <h2 className="mt-2 text-2xl font-black text-brand-950">{config?.company_name || 'Sero Guld'}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-brand-700">
            Sero Guld CRM, müşteri talebi, işlem güvenliği, finansal kayıt zorunlulukları ve mağaza operasyonları için gerekli kişisel verileri işler. Danimarka hukukuna uygun olarak finansal ledger ve pos belgeleri hukuki zorunluluk süresince korunur; müşteri ana veri ve kimlik alanları gerekli süre sonunda pseudonymize edilir.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="border border-brand-200 bg-brand-50 p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <p className="text-sm font-black uppercase tracking-widest text-brand-700">What we keep</p>
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-brand-700">
              <li>Customer master data and identity references for lawful KYC and transaction handling.</li>
              <li>POS documents, purchase receipts and ledger entries for accounting and compliance.</li>
              <li>Operational request history for GDPR audit trail.</li>
            </ul>
          </div>
          <div className="border border-brand-200 bg-brand-50 p-5">
            <div className="flex items-center gap-2">
              <ShieldEllipsis className="h-4 w-4 text-brand-700" />
              <p className="text-sm font-black uppercase tracking-widest text-brand-700">Your rights</p>
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-brand-700">
              <li>Request access/export of your stored data.</li>
              <li>Request rectification or restriction where legally appropriate.</li>
              <li>Request pseudonymization after the legal retention window.</li>
            </ul>
          </div>
        </section>

        <section className="border border-brand-200 p-5">
          <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-500">Processors and hosting</p>
          <p className="mt-3 text-sm leading-7 text-brand-700">
            CRM, WordPress public pages, WooCommerce and office runtimes may process limited subsets of personal data depending on the workflow. The authoritative request handling and retention policy live in Sero Guld CRM.
          </p>
        </section>
      </div>
    </PublicShell>
  );
}

export function GdprPublicCookiesPage() {
  const configQuery = usePublicSiteConfig();
  const cookieQuery = useQuery({
    queryKey: ['gdpr-public-cookie-config'],
    queryFn: () => apiRequest<GdprPublicCookieConfig>('/api/v2/public/gdpr/cookie-config', { auth: false }),
  });
  const config = configQuery.data || null;

  return (
    <PublicShell config={config} eyebrow="Cookies" title="Cookie Information">
      <div className="space-y-5">
        <p className="max-w-3xl text-sm leading-7 text-brand-700">
          Public web yüzeyleri gerekli oturum, güvenlik ve isteğe bağlı analytics/marketing kategorilerine ayrılır. WordPress ve WooCommerce kaynaklı cookie davranışı bu sayfadan referans alınır.
        </p>
        <div className="grid gap-4">
          {(cookieQuery.data?.categories || []).map((item) => (
            <div key={item.key} className="border border-brand-200 bg-brand-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-brand-950">{item.title}</p>
                  <p className="mt-1 text-sm text-brand-700">{item.description}</p>
                </div>
                <span className={`border px-3 py-1 text-xs font-black uppercase tracking-widest ${item.required ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-brand-300 bg-white text-brand-700'}`}>
                  {item.required ? 'Required' : 'Optional'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}

export function GdprPublicRequestPage() {
  const configQuery = usePublicSiteConfig();
  const config = configQuery.data || null;
  const [form, setForm] = useState({
    request_type: 'access_export',
    subject_name: '',
    subject_email: '',
    subject_phone: '',
    message: '',
    accepted_privacy: true,
  });

  const requestMutation = useMutation({
    mutationFn: () =>
      apiRequest<GdprPublicRequestCreateOut>('/api/v2/public/gdpr/request', {
        method: 'POST',
        auth: false,
        body: JSON.stringify(form),
      }),
  });

  const trackingUrl = useMemo(() => {
    if (!requestMutation.data) return null;
    return `${window.location.origin}${window.location.pathname}#/gdpr/request/${requestMutation.data.tracking_token}`;
  }, [requestMutation.data]);

  return (
    <PublicShell config={config} eyebrow="Request" title="Data Request Center">
      <div className="space-y-6">
        <p className="max-w-3xl text-sm leading-7 text-brand-700">
          Erişim, export, restriction, rectification veya pseudonymize talebinizi buradan iletebilirsiniz. V1 akışında execution insan doğrulaması sonrası başlar; tracking token ile request durumunu takip edebilirsiniz.
        </p>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            requestMutation.mutate();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-brand-800">
              Request type
              <select
                value={form.request_type}
                onChange={(event) => setForm((current) => ({ ...current, request_type: event.target.value }))}
                className="border border-brand-300 px-3 py-2 outline-none focus:border-brand-700"
              >
                <option value="access_export">Access / Export</option>
                <option value="erasure_pseudonymize">Erasure / Pseudonymize</option>
                <option value="rectification">Rectification</option>
                <option value="objection_restriction">Objection / Restriction</option>
                <option value="marketing_opt_out">Marketing opt-out</option>
                <option value="cookie_privacy_contact">Cookie / Privacy contact</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-brand-800">
              Ad Soyad
              <input
                value={form.subject_name}
                onChange={(event) => setForm((current) => ({ ...current, subject_name: event.target.value }))}
                className="border border-brand-300 px-3 py-2 outline-none focus:border-brand-700"
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-brand-800">
              E-mail
              <input
                type="email"
                value={form.subject_email}
                onChange={(event) => setForm((current) => ({ ...current, subject_email: event.target.value }))}
                className="border border-brand-300 px-3 py-2 outline-none focus:border-brand-700"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-brand-800">
              Telefon
              <input
                value={form.subject_phone}
                onChange={(event) => setForm((current) => ({ ...current, subject_phone: event.target.value }))}
                className="border border-brand-300 px-3 py-2 outline-none focus:border-brand-700"
              />
            </label>
          </div>
          <label className="grid gap-2 text-sm font-semibold text-brand-800">
            Açıklama
            <textarea
              value={form.message}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              className="min-h-[140px] border border-brand-300 px-3 py-2 outline-none focus:border-brand-700"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-brand-700">
            <input
              type="checkbox"
              checked={form.accepted_privacy}
              onChange={(event) => setForm((current) => ({ ...current, accepted_privacy: event.target.checked }))}
            />
            Persondata ve privacy işleme metnini kabul ediyorum.
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={requestMutation.isPending}
              className="border border-amber-500 bg-amber-500 px-4 py-2 text-sm font-black uppercase tracking-widest text-brand-950 transition hover:bg-amber-400 disabled:opacity-60"
            >
              {requestMutation.isPending ? 'Gönderiliyor' : 'Request oluştur'}
            </button>
            {requestMutation.isError ? (
              <span className="text-sm text-rose-700">
                {requestMutation.error instanceof Error ? requestMutation.error.message : 'Request oluşturulamadı.'}
              </span>
            ) : null}
          </div>
        </form>

        {requestMutation.data ? (
          <div className="border border-emerald-300 bg-emerald-50 p-5 text-emerald-900">
            <p className="text-sm font-black uppercase tracking-widest">Request created</p>
            <p className="mt-2 text-sm">Reference: <span style={monoStyle}>{requestMutation.data.reference_number}</span></p>
            <p className="mt-2 text-sm">Due: {formatDate(requestMutation.data.due_at)}</p>
            {trackingUrl ? (
              <a href={trackingUrl} className="mt-4 inline-flex items-center gap-2 border border-emerald-400 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-emerald-700">
                Tracking sayfasını aç
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </PublicShell>
  );
}

export function GdprPublicRequestStatusPage() {
  const configQuery = usePublicSiteConfig();
  const config = configQuery.data || null;
  const params = useParams();
  const token = params.token || '';

  const statusQuery = useQuery({
    queryKey: ['gdpr-public-request-status', token],
    queryFn: () => apiRequest<GdprPublicRequestStatus>(`/api/v2/public/gdpr/request/${token}`, { auth: false }),
    enabled: Boolean(token),
  });

  return (
    <PublicShell config={config} eyebrow="Tracking" title="Request Status">
      {!token ? (
        <p className="text-sm text-brand-700">Takip token bulunamadı.</p>
      ) : statusQuery.isLoading ? (
        <p className="text-sm text-brand-700">Request status yükleniyor…</p>
      ) : statusQuery.isError ? (
        <p className="text-sm text-rose-700">{statusQuery.error instanceof Error ? statusQuery.error.message : 'Status okunamadı.'}</p>
      ) : statusQuery.data ? (
        <div className="space-y-4">
          <div className="border border-brand-200 bg-brand-50 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-500">{statusQuery.data.reference_number}</p>
            <h2 className="mt-2 text-2xl font-black text-brand-950">{statusQuery.data.request_type}</h2>
            <p className="mt-3 text-sm text-brand-700">Status: <span className="font-semibold">{statusQuery.data.status}</span></p>
            <p className="mt-1 text-sm text-brand-700">Submitted: {formatDate(statusQuery.data.submitted_at)}</p>
            {statusQuery.data.due_at ? <p className="mt-1 text-sm text-brand-700">Due: {formatDate(statusQuery.data.due_at)}</p> : null}
            {statusQuery.data.completed_at ? <p className="mt-1 text-sm text-brand-700">Completed: {formatDate(statusQuery.data.completed_at)}</p> : null}
            {statusQuery.data.last_message ? <p className="mt-4 text-sm leading-6 text-brand-700">{statusQuery.data.last_message}</p> : null}
          </div>
        </div>
      ) : null}
    </PublicShell>
  );
}
