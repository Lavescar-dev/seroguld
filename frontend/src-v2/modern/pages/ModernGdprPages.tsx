import { FileClock, Globe2, ShieldCheck, ShieldEllipsis } from 'lucide-react';

import { ModernBadge, ModernButton, ModernCard, ModernDataTable, ModernPage, ModernSection, ModernSectionHeader, ModernStat } from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, StatusGrid, formatDate, formatRelativeTime, toneForText } from './shared';
import type {
  ModernGdprCockpitPageProps,
  ModernGdprPublicCookiesPageProps,
  ModernGdprPublicPrivacyPageProps,
  ModernGdprPublicRequestPageProps,
  ModernGdprPublicStatusPageProps,
} from './types';

export function ModernGdprCockpitPage({
  overview,
  requests,
  jobs,
  processors,
  retentionPolicies,
  selectedRequest,
}: ModernGdprCockpitPageProps) {
  return (
    <ModernPage>
      <ModernSection>
        <ModernSectionHeader
          eyebrow="GDPR merkezi"
          title="Talep, kopya görevi ve processor görünürlüğü"
          description="Tamamlanmamış kopya görevleri saklanmaz; yüzey gerçek completion yerine blokajı gösterir."
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Açık talep" value={overview.open_request_count} icon={ShieldCheck} tone="primary" />
          <ModernStat label="Yaklaşan süre" value={overview.due_soon_count} icon={FileClock} tone="warning" />
          <ModernStat label="Overdue" value={overview.overdue_count} icon={ShieldEllipsis} tone={overview.overdue_count > 0 ? 'danger' : 'neutral'} />
          <ModernStat label="Kuyruk iş" value={overview.queued_job_count} icon={FileClock} tone="info" />
        </div>
      </ModernSection>

      <ModernSection>
        <ModernSectionHeader title="Runtime readiness" description="Processor ve policy bağlamının doğrulanmış görünümü." />
        <div className="mt-4">
          <StatusGrid
            items={overview.readiness_checks.map((item) => ({
              label: item.name,
              value: item.ok ? 'Hazır' : 'Eksik',
              detail: item.detail || undefined,
              tone: item.ok ? 'success' : 'danger',
            }))}
          />
        </div>
      </ModernSection>

      <div className="grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
        <ModernSection>
          <ModernSectionHeader title="Talep kuyruğu" description="Cockpit görünümünde seçilen talep detayına bağlanır." />
          <div className="mt-4">
            <ModernDataTable
              items={requests}
              getRowKey={(item) => item.id}
              columns={[
                {
                  key: 'reference',
                  header: 'Talep',
                  cell: (item) => (
                    <div>
                      <p className="font-medium text-slate-900">{item.reference_number}</p>
                      <p className="text-xs text-slate-500">{item.request_type}</p>
                    </div>
                  ),
                },
                {
                  key: 'subject',
                  header: 'Özne',
                  cell: (item) => item.verified_customer_name || item.subject_name || item.subject_email || 'Doğrulama bekliyor',
                },
                {
                  key: 'due',
                  header: 'Süre',
                  cell: (item) => (item.due_at ? formatRelativeTime(item.due_at) : '—'),
                },
                {
                  key: 'status',
                  header: 'Durum',
                  align: 'right',
                  cell: (item) => <ModernBadge tone={toneForText(item.status)}>{item.status}</ModernBadge>,
                },
              ]}
            />
          </div>
        </ModernSection>

        <div className="space-y-5">
          <DetailGrid
            title="Seçili talep"
            description="Completion yalnız tüm kopya görevleri bitince açılmalıdır."
            items={
              selectedRequest
                ? [
                    { label: 'Referans', value: selectedRequest.reference_number, accent: true },
                    { label: 'Durum', value: selectedRequest.status, accent: true },
                    { label: 'Kanal', value: selectedRequest.channel },
                    { label: 'Gönderim', value: formatDate(selectedRequest.submitted_at) },
                    { label: 'Eşleşen aday', value: selectedRequest.match_candidates.length },
                    { label: 'Son iş', value: selectedRequest.latest_job?.status || '—' },
                    { label: 'Export', value: selectedRequest.export_download_path || 'Henüz yok' },
                  ]
                : [{ label: 'Durum', value: 'Seçili talep yok', accent: true }]
            }
          />
          <AvailabilityBanner
            availability={{
              state: 'readonly',
              title: 'Completion burada kapalı tutuldu.',
              description:
                'PDF, Excel, backup ve dış sistem kopyaları tamamlanmadan talebi başarıyla bitti gibi göstermek yerine blokaj görünür bırakılır.',
            }}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ModernSection>
          <ModernSectionHeader title="Processor kayıtları" />
          <div className="mt-4 space-y-3">
            {processors.map((processor) => (
              <ModernCard key={processor.id} className="bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{processor.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{processor.system_name}</p>
                  </div>
                  <ModernBadge tone={processor.configured ? toneForText(processor.status) : 'warning'}>
                    {processor.configured ? processor.status : 'Konfigürasyon bekliyor'}
                  </ModernBadge>
                </div>
              </ModernCard>
            ))}
          </div>
        </ModernSection>

        <ModernSection>
          <ModernSectionHeader title="Retention ve işler" />
          <div className="mt-4 space-y-3">
            {retentionPolicies.map((policy) => (
              <ModernCard key={policy.id} className="bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{policy.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{policy.description || policy.applies_to}</p>
                  </div>
                  <ModernBadge tone={policy.is_enabled ? 'success' : 'warning'}>
                    {policy.retention_days} gün
                  </ModernBadge>
                </div>
              </ModernCard>
            ))}
            {jobs.slice(0, 4).map((job) => (
              <ModernCard key={job.id} className="bg-slate-50/70">
                <p className="text-sm font-medium text-slate-900">{job.job_type}</p>
                <p className="mt-1 text-sm text-slate-500">{job.request_reference_number || 'İstek bağlanmamış'}</p>
                <div className="mt-3">
                  <ModernBadge tone={toneForText(job.status)}>{job.status}</ModernBadge>
                </div>
              </ModernCard>
            ))}
          </div>
        </ModernSection>
      </div>
    </ModernPage>
  );
}

function PublicWrapper({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <ModernPage className="mx-auto max-w-4xl">
      <ModernSection>
        <ModernSectionHeader eyebrow="GDPR public" title={title} description={description} />
        <div className="mt-5">{children}</div>
      </ModernSection>
    </ModernPage>
  );
}

export function ModernGdprPublicPrivacyPage({ site, bridge }: ModernGdprPublicPrivacyPageProps) {
  return (
    <PublicWrapper
      title={`${site.company_name} gizlilik görünümü`}
      description="Public bridge DTO değişmeden daha açık bir light yüzeye taşınır."
    >
      <DetailGrid
        title="Şirket ve irtibat"
        items={[
          { label: 'Şirket', value: site.company_name, accent: true },
          { label: 'E-posta', value: site.company_email || site.privacy_email || '—' },
          { label: 'Telefon', value: site.company_phone || '—' },
          { label: 'Adres', value: site.company_address || '—' },
          { label: 'Website', value: site.website_url || '—' },
          { label: 'Bridge versiyonu', value: bridge?.version || '—' },
        ]}
      />
    </PublicWrapper>
  );
}

export function ModernGdprPublicCookiesPage({ site, cookies }: ModernGdprPublicCookiesPageProps) {
  return (
    <PublicWrapper title="Çerez kategorileri" description={`${site.company_name} için public cookie kategorileri ve gerekli açıklamalar.`}>
      <div className="space-y-3">
        {cookies.categories.map((category) => (
          <ModernCard key={category.key} className="bg-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{category.title}</p>
                <p className="mt-1 text-sm text-slate-500">{category.description}</p>
              </div>
              <ModernBadge tone={category.required ? 'success' : 'neutral'}>
                {category.required ? 'Gerekli' : 'Opsiyonel'}
              </ModernBadge>
            </div>
          </ModernCard>
        ))}
      </div>
    </PublicWrapper>
  );
}

export function ModernGdprPublicRequestPage({
  site,
  availability,
  latestCreatedRequest,
  helperNote,
}: ModernGdprPublicRequestPageProps) {
  return (
    <PublicWrapper title="Veri talebi başlat" description={`${site.company_name} kamu yüzeyi için request giriş kabuğu.`}>
      <AvailabilityBanner availability={availability} />
      {latestCreatedRequest ? (
        <ModernCard className="mt-4 bg-white">
          <p className="text-sm font-medium text-slate-900">Son oluşturulan talep</p>
          <p className="mt-2 text-sm text-slate-600">{latestCreatedRequest.reference_number}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ModernBadge tone={toneForText(latestCreatedRequest.status)}>{latestCreatedRequest.status}</ModernBadge>
            <ModernBadge tone="info">Bitiş: {formatDate(latestCreatedRequest.due_at)}</ModernBadge>
          </div>
        </ModernCard>
      ) : null}
      <p className="mt-4 text-sm leading-6 text-slate-500">
        {helperNote || 'Gerçek form hook’ları bağlanana kadar bu yüzey request lifecycle ve public kopya metnini taşımak için hazırlanmıştır.'}
      </p>
    </PublicWrapper>
  );
}

export function ModernGdprPublicStatusPage({ site, status }: ModernGdprPublicStatusPageProps) {
  return (
    <PublicWrapper title="Talep durumu" description={`${site.company_name} request tracking görünümü.`}>
      {status ? (
        <DetailGrid
          title="Talep yaşam döngüsü"
          items={[
            { label: 'Referans', value: status.reference_number, accent: true },
            { label: 'Talep tipi', value: status.request_type },
            { label: 'Durum', value: status.status, accent: true },
            { label: 'Gönderim', value: formatDate(status.submitted_at) },
            { label: 'Bitiş tarihi', value: status.due_at ? formatDate(status.due_at) : '—' },
            { label: 'Son mesaj', value: status.last_message || '—' },
          ]}
        />
      ) : (
        <AvailabilityBanner
          availability={{
            state: 'unavailable',
            title: 'Talep bulunamadı.',
            description: 'Tracking token için public status view model bekleniyor.',
          }}
        />
      )}
    </PublicWrapper>
  );
}
