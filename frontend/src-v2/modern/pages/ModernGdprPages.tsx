import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clock3, Database, Download, FileClock, FileKey2, LockKeyhole, Plus, RefreshCw, ShieldCheck, ShieldEllipsis, ShieldX, UsersRound, Workflow } from 'lucide-react';

import { downloadAuthedDocument, localizeApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';

import { useGdprCreateRequest } from '@/make/gdpr/useGdprCreateRequest';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernDialog,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernStat,
  ModernTextInput,
  ModernUnavailableState,
} from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, formatDate, formatRelativeTime, toneForText } from './shared';
import type {
  ModernGdprCockpitPageProps,
  ModernGdprPublicCookiesPageProps,
  ModernGdprPublicPrivacyPageProps,
  ModernGdprPublicRequestPageProps,
  ModernGdprPublicStatusPageProps,
} from './types';

type GdprTab = 'requests' | 'tasks' | 'retention' | 'processors' | 'audit';

const tabs: Array<{ id: GdprTab; label: string }> = [
  { id: 'requests', label: 'Talepler' },
  { id: 'tasks', label: 'Kopya görevleri' },
  { id: 'retention', label: 'Retention' },
  { id: 'processors', label: 'Processorlar' },
  { id: 'audit', label: 'Audit Trail' },
];

const copyScopes = [
  { key: 'database', label: 'Customer master / DB', description: 'Ana müşteri kaydı ve pseudonymization', icon: Database, match: ['db', 'database', 'customer', 'pseudonym'] },
  { key: 'document', label: 'AFG / PDF snapshot', description: 'Belge, AFG ve PDF artefaktları', icon: FileKey2, match: ['afg', 'pdf', 'document', 'export'] },
  { key: 'workbook', label: 'Workbook artefaktları', description: 'Excel çalışma sayfası kopyaları', icon: Workflow, match: ['excel', 'workbook', 'office', 'xlsx'] },
  { key: 'media', label: 'Medya / kimlik dosyaları', description: 'Media ve identity referansları', icon: Archive, match: ['media', 'identity', 'photo', 'file'] },
  { key: 'woo', label: 'Woo / WordPress', description: 'Dış sistem pseudonymization sonucu', icon: UsersRound, match: ['woo', 'woocommerce', 'wordpress'] },
  { key: 'backup', label: 'Backup / restore tombstone', description: 'Yerel ve offsite yedek yaşam döngüsü', icon: LockKeyhole, match: ['backup', 'restore', 'tombstone'] },
] as const;

function jobForScope(scope: (typeof copyScopes)[number], jobs: ModernGdprCockpitPageProps['jobs']) {
  return jobs.find((job) => {
    const haystack = `${job.job_type} ${JSON.stringify(job.payload_json)} ${JSON.stringify(job.result_json)}`.toLocaleLowerCase();
    return scope.match.some((term) => haystack.includes(term));
  });
}

function completionState(jobs: ModernGdprCockpitPageProps['jobs']): { label: string; tone: 'success' | 'warning' | 'info'; allowed: boolean } {
  if (jobs.length === 0) return { label: 'DISCOVERY', tone: 'info', allowed: false };
  const terminal = jobs.every((job) => ['completed', 'completed_with_warnings', 'skipped'].includes(job.status));
  return terminal ? { label: 'PASS', tone: 'success', allowed: true } : { label: 'LOCKED', tone: 'warning', allowed: false };
}

export function ModernGdprCockpitPage({
  overview,
  requests,
  jobs,
  processors,
  retentionPolicies,
  selectedRequest,
  isLoading = false,
  isRefreshing = false,
  onRefresh,
  onSelectRequest,
  activeMutation = false,
  onVerify,
  onApprove,
  onReject,
  onEnqueue,
  onExecute,
  onUpdatePolicy,
}: ModernGdprCockpitPageProps) {
  const [activeTab, setActiveTab] = useState<GdprTab>('requests');
  const [decisionReason, setDecisionReason] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState('access_export');
  const [createSubjectName, setCreateSubjectName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const toast = useToast();
  const createRequestMutation = useGdprCreateRequest();
  const hasDecisionActions = Boolean(onApprove || onReject || onEnqueue || onExecute || onVerify);
  const relatedJobs = useMemo(() => {
    if (!selectedRequest) return [];
    const scoped = jobs.filter((job) => job.request_id === selectedRequest.id);
    if (scoped.length > 0) return scoped;
    return selectedRequest.latest_job ? [selectedRequest.latest_job] : [];
  }, [jobs, selectedRequest]);
  const gate = completionState(relatedJobs);

  // md1: "Yeni talep" — backend'de admin POST /api/v2/gdpr/requests ucu yok;
  // tek oluşturma yolu public request endpoint'idir (channel="public_page").
  async function submitCreateRequest() {
    const subjectName = createSubjectName.trim();
    if (subjectName.length < 2) {
      setCreateError('Konu adı en az 2 karakter olmalı.');
      return;
    }
    setCreateError(null);
    try {
      const created = await createRequestMutation.mutateAsync({ request_type: createType, subject_name: subjectName });
      toast.success('Talep oluşturuldu', `${created.reference_number} · durum: identity_pending`);
      setCreateOpen(false);
      setCreateSubjectName('');
    } catch (error) {
      toast.error('Talep oluşturulamadı', localizeApiError(error));
    }
  }

  if (isLoading && !overview) {
    return (
      <ModernPage>
        <ModernSection>
          <ModernSectionHeader eyebrow="Uyum ve veri hakları" title="GDPR Merkezi" description="Gerçek request ve completion state'i bekleniyor." />
          <div className="mt-5"><ModernUnavailableState title="GDPR çalışma alanı hazırlanıyor" description="Talep, copy-task, processor ve retention verisi gelmeden sahte KPI gösterilmez." detail="READ-ONLY RUNTIME" /></div>
        </ModernSection>
      </ModernPage>
    );
  }

  if (!overview) {
    return <ModernPage><ModernUnavailableState title="GDPR özeti alınamadı" description="Overview endpoint'i gerçek veri döndürmedi; completion başarı gibi gösterilmiyor." detail="ERROR / UNAVAILABLE" /></ModernPage>;
  }

  const selected = selectedRequest;

  return (
    <ModernPage>
      <ModernSection className="bg-sg-surface-soft">
        <ModernSectionHeader
          eyebrow="Uyum ve veri hakları"
          title="GDPR Merkezi"
          description="Talep, kopya görevleri, saklama, veri işleyen ve denetim yükümlülüklerini tek gizlilik çalışma alanında yönetir."
          action={<div className="flex flex-wrap gap-2"><ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh} disabled={!onRefresh || isRefreshing}>Yenile</ModernButton><ModernButton tone="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Yeni talep</ModernButton></div>}
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ModernStat label="Açık talepler" value={overview.open_request_count} meta={`${overview.due_soon_count} süre yaklaşıyor`} icon={ShieldCheck} tone="primary" />
          <ModernStat label="Açık kopya görevi" value={overview.queued_job_count} meta={`${overview.failed_job_count} başarısız`} icon={Workflow} tone={overview.failed_job_count > 0 ? 'danger' : 'info'} />
          <ModernStat label="Retention politikası" value={retentionPolicies.length} meta={`${overview.locked_product_count} kilitli ürün`} icon={FileClock} tone="info" />
          <ModernStat label="Processor review" value={overview.processor_warning_count} meta="Uyarı gerektiren kayıt" icon={ShieldEllipsis} tone={overview.processor_warning_count > 0 ? 'warning' : 'success'} />
        </div>
      </ModernSection>

      <div className="flex flex-wrap gap-1 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-1">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={activeTab === tab.id ? 'rounded-sg-md bg-sg-surface px-4 py-2 text-xs font-semibold text-sg-accent shadow-sg-sm' : 'rounded-sg-md px-4 py-2 text-xs font-semibold text-sg-text-soft hover:bg-sg-surface'}>{tab.label}</button>
        ))}
      </div>

      {activeTab === 'requests' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader title="Talep kuyruğu" description="SLA, request type ve terminal copy state görünürlüğü." />
            <div className="mt-4 space-y-3">
              {requests.length > 0 ? requests.map((request) => {
                const active = selected?.id === request.id;
                return <button key={request.id} type="button" onClick={() => onSelectRequest?.(request.id)} className={`block w-full rounded-sg-md border p-4 text-left transition ${active ? 'border-sg-accent bg-sg-accent-soft shadow-sg-sm' : 'border-sg-border bg-sg-surface-soft hover:border-sg-accent'}`}>
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-sg-text">{request.reference_number} · {request.request_type}</p><p className="mt-1 text-xs text-sg-text-soft">{request.verified_customer_id || 'Pseudonymous subject'} · {request.channel}</p></div><ModernBadge tone={toneForText(request.status)}>{request.status}</ModernBadge></div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-sg-text-soft"><span>{request.due_at ? formatRelativeTime(request.due_at) : 'SLA yok'}</span><span>{request.submitted_at ? formatDate(request.submitted_at) : '—'}</span></div>
                </button>;
              }) : <ModernUnavailableState title="Talep kuyruğu boş" description="Gerçek GDPR request satırı dönmedi; boş durum başarı olarak boyanmaz." detail="NO REQUESTS" />}
            </div>
          </ModernSection>

          <div className="space-y-5">
            <DetailGrid title={selected ? `Aktif talep · ${selected.reference_number}` : 'Aktif talep'} description="Completion gate yalnız gerçek job state terminal olduğunda açılabilir." items={selected ? [
              { label: 'Talep türü', value: selected.request_type, accent: true },
              { label: 'Durum', value: selected.status, accent: true },
              { label: 'Kanal', value: selected.channel },
              { label: 'Gönderim', value: formatDate(selected.submitted_at) },
              { label: 'Son iş', value: selected.latest_job?.status || '—' },
              { label: 'Export', value: selected.export_download_path || 'Henüz yok' },
            ] : [{ label: 'Durum', value: 'Talep seçimi bekleniyor', accent: true }]} />
            {selected && hasDecisionActions ? (
              <ModernSection>
                <ModernSectionHeader title="Doğrulama ve karar" description="Aday müşteri eşleştirme, karar gerekçesi ve talep yaşam döngüsü aksiyonları." />
                <div className="mt-4 space-y-4">
                  <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                    {selected.verified_customer_name ? (
                      <p className="text-sm font-semibold text-sg-green-strong">Eşleşen müşteri: {selected.verified_customer_name}</p>
                    ) : (
                      <p className="text-sm text-sg-text-soft">Henüz doğrulanmış müşteri seçilmedi.</p>
                    )}
                    {onVerify && selected.match_candidates.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {selected.match_candidates.map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            disabled={activeMutation}
                            onClick={() => void onVerify(selected.id, candidate.id)}
                            className="flex items-center justify-between rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-left transition hover:border-sg-accent disabled:opacity-60"
                          >
                            <div>
                              <p className="text-sm font-semibold text-sg-text">{candidate.name}</p>
                              <p className="text-xs text-sg-text-soft">{candidate.email || candidate.phone || candidate.cpr_number_masked || '—'}</p>
                            </div>
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-sg-accent">Doğrula</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <label className="block text-xs font-semibold text-sg-text-soft">
                    Karar gerekçesi / operatör notu
                    <textarea
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                      className="mt-1 min-h-24 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent"
                      placeholder="Karar gerekçesi veya not"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {onApprove ? <ModernButton tone="primary" icon={ShieldCheck} disabled={activeMutation} onClick={() => void onApprove(selected.id, decisionReason)}>Onayla</ModernButton> : null}
                    {onReject ? <ModernButton tone="danger" icon={ShieldX} disabled={activeMutation} onClick={() => void onReject(selected.id, decisionReason)}>Reddet</ModernButton> : null}
                    {onEnqueue ? <ModernButton tone="ghost" icon={Clock3} disabled={activeMutation} onClick={() => void onEnqueue(selected.id)}>Kuyruğa al</ModernButton> : null}
                    {onExecute ? <ModernButton tone="success" icon={CheckCircle2} disabled={activeMutation} onClick={() => void onExecute(selected.id)}>Çalıştır</ModernButton> : null}
                    {selected.export_download_path ? (
                      <ModernButton tone="ghost" icon={Download} onClick={() => void downloadAuthedDocument(selected.export_download_path!, `${selected.reference_number}.zip`)}>
                        Export indir
                      </ModernButton>
                    ) : null}
                  </div>
                </div>
              </ModernSection>
            ) : null}
            <ModernSection>
              <ModernSectionHeader title="Completion gate" description="Açık/manual/queued görev varken tamamla aksiyonu kapalı kalır." action={<ModernBadge tone={gate.tone}>{gate.label}</ModernBadge>} />
              <div className="mt-4 flex items-center justify-between gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3"><div><p className="text-sm font-semibold text-sg-text">B5 terminal gate</p><p className="mt-1 text-xs text-sg-text-soft">{relatedJobs.length > 0 ? `${relatedJobs.length} gerçek job satırı değerlendirildi.` : "Copy-task kapsamı bu DTO'da eksik."}</p></div><ModernButton tone="primary" disabled={!gate.allowed || activeMutation || !onExecute} title={gate.allowed ? undefined : relatedJobs.length === 0 ? "Copy-task kapsamı bu DTO'da eksik; tamamlama kilitli" : 'Açık veya sürmekte olan copy-task varken tamamlanamaz'} onClick={() => { if (selected && onExecute) void onExecute(selected.id); }}>Talebi tamamla</ModernButton></div>
            </ModernSection>
            <CopyTaskGrid jobs={relatedJobs} />
          </div>
        </div>
      ) : null}

      {activeTab === 'tasks' ? <CopyTaskGrid jobs={relatedJobs} /> : null}

      {activeTab === 'retention' ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <ModernSection>
            <ModernSectionHeader title="Retention politikaları" description="Veri sınıfı, süre ve legal action gerçek policy endpoint'inden gelir." />
            <div className="mt-4 space-y-3">{retentionPolicies.length > 0 ? retentionPolicies.map((policy) => (
              <RetentionPolicyCard key={policy.id} policy={policy} disabled={activeMutation} onSave={onUpdatePolicy} />
            )) : <ModernUnavailableState title="Retention politikası yok" description="Backend gerçek policy döndürmedi." detail="NO POLICIES" />}</div>
          </ModernSection>
          <ModernSection>
            <ModernSectionHeader title="Kuyruk işleri" description="Job status'leri terminal olmayan işleri görünür tutar." />
            <div className="mt-4 space-y-3">{jobs.slice(0, 8).map((job) => <ModernCard key={job.id} className="bg-sg-surface-soft"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-sg-text">{job.job_type}</p><p className="mt-1 text-xs text-sg-text-soft">{job.request_reference_number || 'Request bağlanmamış'}</p></div><ModernBadge tone={toneForText(job.status)}>{job.status}</ModernBadge></div></ModernCard>)}</div>
          </ModernSection>
        </div>
      ) : null}

      {activeTab === 'processors' ? (
        <ModernSection>
          <ModernSectionHeader title="Processor envanteri" description="DPA, location, encryption ve review status gerçek processor kayıtlarından okunur." />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{processors.length > 0 ? processors.map((processor) => <ModernCard key={processor.id} className="bg-sg-surface-soft"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-sg-text">{processor.title}</p><p className="mt-1 text-xs text-sg-text-soft">{processor.system_name} · {processor.category}</p></div><ModernBadge tone={processor.configured ? toneForText(processor.status) : 'warning'}>{processor.configured ? processor.status : 'Konfigürasyon bekliyor'}</ModernBadge></div>{processor.detail ? <p className="mt-3 text-xs text-sg-text-soft">{processor.detail}</p> : null}</ModernCard>) : <ModernUnavailableState title="Processor kaydı yok" description="Backend processor endpoint'i gerçek satır döndürmedi." detail="NO PROCESSORS" />}</div>
        </ModernSection>
      ) : null}

      {activeTab === 'audit' ? <AuditTrail selectedRequest={selected} jobs={jobs} /> : null}

      <ModernDialog
        open={createOpen}
        onClose={() => { if (!createRequestMutation.isPending) setCreateOpen(false); }}
        title="Yeni GDPR talebi"
        description="Talep türü ve konu adı zorunlu; talep public request kanalından identity_pending olarak açılır."
        footer={(
          <div className="flex items-center justify-end gap-2">
            <ModernButton tone="ghost" disabled={createRequestMutation.isPending} onClick={() => setCreateOpen(false)}>Vazgeç</ModernButton>
            <ModernButton tone="primary" icon={CheckCircle2} disabled={createRequestMutation.isPending || createSubjectName.trim().length < 2} onClick={() => void submitCreateRequest()}>
              {createRequestMutation.isPending ? 'Oluşturuluyor…' : 'Talebi oluştur'}
            </ModernButton>
          </div>
        )}
      >
        <div className="space-y-4">
          <label className="block text-xs font-semibold text-sg-text-soft">
            Talep türü
            <select
              value={createType}
              onChange={(event) => setCreateType(event.target.value)}
              className="mt-1 min-h-10 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 text-sm text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent-soft"
            >
              <option value="access_export">Erişim / Export</option>
              <option value="erasure_pseudonymize">Silme / Pseudonymize</option>
              <option value="rectification">Düzeltme (rectification)</option>
              <option value="objection_restriction">İtiraz / Kısıtlama</option>
              <option value="marketing_opt_out">Pazarlama çıkışı</option>
              <option value="cookie_privacy_contact">Çerez / gizlilik iletişimi</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-sg-text-soft">
            Konu adı (zorunlu)
            <ModernTextInput
              value={createSubjectName}
              onChange={(event) => setCreateSubjectName(event.target.value)}
              placeholder="Ad Soyad"
              aria-label="Konu adı"
            />
          </label>
          {createError ? <p className="text-xs font-semibold text-sg-red">{createError}</p> : null}
          <p className="text-xs text-sg-text-soft">Talep public kanalından identity_pending olarak açılır; doğrulama ve karar adımları talep kuyruğundan yürütülür.</p>
        </div>
      </ModernDialog>
    </ModernPage>
  );
}

function RetentionPolicyCard({
  policy,
  disabled,
  onSave,
}: {
  policy: ModernGdprCockpitPageProps['retentionPolicies'][number];
  disabled?: boolean;
  onSave?: ModernGdprCockpitPageProps['onUpdatePolicy'];
}) {
  const [daysInput, setDaysInput] = useState(String(policy.retention_days));
  const [enabled, setEnabled] = useState(policy.is_enabled);
  return (
    <ModernCard className="bg-sg-surface-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sg-text">{policy.title}</p>
          <p className="mt-1 text-xs text-sg-text-soft">{policy.description || policy.applies_to}</p>
        </div>
        <ModernBadge tone={policy.is_enabled ? 'success' : 'warning'}>{policy.retention_days} gün</ModernBadge>
      </div>
      <p className="mt-3 text-xs text-sg-text-soft">Action: {policy.action} · Son güncelleme: {formatDate(policy.updated_at)}</p>
      {onSave ? (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-sg-border-soft pt-3">
          <label className="text-[11px] font-semibold text-sg-text-soft">
            Süre (gün)
            <input
              type="number"
              min={0}
              value={daysInput}
              onChange={(event) => setDaysInput(event.target.value)}
              className="mt-1 block w-24 rounded-sg-md border border-sg-border bg-sg-surface px-2 py-1.5 text-sm text-sg-text outline-none"
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-xs font-semibold text-sg-text-soft">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Aktif
          </label>
          <ModernButton
            tone="primary"
            size="sm"
            disabled={disabled}
            onClick={() => void onSave({
              policyKey: policy.policy_key,
              retention_days: Number.parseInt(daysInput, 10) || policy.retention_days,
              is_enabled: enabled,
            })}
          >
            Kaydet
          </ModernButton>
        </div>
      ) : null}
    </ModernCard>
  );
}

function CopyTaskGrid({ jobs }: { jobs: ModernGdprCockpitPageProps['jobs'] }) {
  return (
    <ModernSection>
      <ModernSectionHeader title="Kopya görevleri" description="DB, AFG/PDF, workbook, media, Woo ve backup kapsamı; expose edilmeyen durumlar DISCOVERY kalır." />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{copyScopes.map((scope) => { const Icon = scope.icon; const job = jobForScope(scope, jobs); const value = job?.status || 'DISCOVERY'; return <ModernCard key={scope.key} className="bg-sg-surface-soft"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sg-md bg-sg-surface text-sg-accent"><Icon className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-sg-text">{scope.label}</p><p className="mt-1 text-xs text-sg-text-soft">{scope.description}</p></div></div><ModernBadge tone={job ? toneForText(value) : 'info'}>{value}</ModernBadge></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sg-surface">{job ? <div className={value === 'completed' || value === 'completed_with_warnings' ? 'h-full w-full rounded-full bg-sg-green' : 'h-full w-1/2 rounded-full bg-sg-amber'} /> : null}</div></ModernCard>; })}</div>
    </ModernSection>
  );
}

function AuditTrail({ selectedRequest, jobs }: { selectedRequest?: ModernGdprCockpitPageProps['selectedRequest']; jobs: ModernGdprCockpitPageProps['jobs'] }) {
  const events = selectedRequest?.events || [];
  return <ModernSection><ModernSectionHeader title="Audit Trail" description="Hassas payload yerine event metadata, actor ve zaman görünürlüğü." /><div className="mt-4 space-y-3">{events.length > 0 ? events.map((event) => <ModernCard key={event.id} className="bg-sg-surface-soft"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-sg-text">{event.event_type}</p><ModernBadge tone={toneForText(event.actor_type)}>{event.actor_type}</ModernBadge></div><p className="mt-1 text-xs text-sg-text-soft">{event.message || 'Event metadata kaydı'} · {formatDate(event.created_at)}</p></ModernCard>) : jobs.slice(0, 8).map((job) => <ModernCard key={job.id} className="bg-sg-surface-soft"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-sg-text">{job.job_type}</p><ModernBadge tone={toneForText(job.status)}>{job.status}</ModernBadge></div><p className="mt-1 text-xs text-sg-text-soft">{job.request_reference_number || 'Request bağlanmamış'} · {formatDate(job.created_at)}</p></ModernCard>)}{events.length === 0 && jobs.length === 0 ? <ModernUnavailableState title="Audit olayı yok" description="Gerçek event/job metadata dönmedi." detail="NO AUDIT" /> : null}</div></ModernSection>;
}

function PublicWrapper({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <ModernPage className="mx-auto max-w-4xl"><ModernSection><ModernSectionHeader eyebrow="GDPR public" title={title} description={description} /><div className="mt-5">{children}</div></ModernSection></ModernPage>;
}

export function ModernGdprPublicPrivacyPage({ site, bridge }: ModernGdprPublicPrivacyPageProps) {
  return <PublicWrapper title={`${site.company_name} gizlilik görünümü`} description="Public bridge DTO değişmeden daha açık bir light yüzeye taşınır."><DetailGrid title="Şirket ve irtibat" items={[{ label: 'Şirket', value: site.company_name, accent: true }, { label: 'E-posta', value: site.company_email || site.privacy_email || '—' }, { label: 'Telefon', value: site.company_phone || '—' }, { label: 'Adres', value: site.company_address || '—' }, { label: 'Website', value: site.website_url || '—' }, { label: 'Bridge versiyonu', value: bridge?.version || '—' }]} /></PublicWrapper>;
}

export function ModernGdprPublicCookiesPage({ site, cookies }: ModernGdprPublicCookiesPageProps) {
  return <PublicWrapper title="Çerez kategorileri" description={`${site.company_name} için public cookie kategorileri ve gerekli açıklamalar.`}><div className="space-y-3">{cookies.categories.map((category) => <ModernCard key={category.key} className="bg-sg-surface-soft"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-sg-text">{category.title}</p><p className="mt-1 text-sm text-sg-text-soft">{category.description}</p></div><ModernBadge tone={category.required ? 'success' : 'neutral'}>{category.required ? 'Gerekli' : 'Opsiyonel'}</ModernBadge></div></ModernCard>)}</div></PublicWrapper>;
}

export function ModernGdprPublicRequestPage({ site, availability, latestCreatedRequest, helperNote }: ModernGdprPublicRequestPageProps) {
  return <PublicWrapper title="Veri talebi başlat" description={`${site.company_name} kamu yüzeyi için request giriş kabuğu.`}><AvailabilityBanner availability={availability} />{latestCreatedRequest ? <ModernCard className="mt-4 bg-sg-surface-soft"><p className="text-sm font-semibold text-sg-text">Son oluşturulan talep</p><p className="mt-2 text-sm text-sg-text-soft">{latestCreatedRequest.reference_number}</p><div className="mt-3 flex flex-wrap gap-2"><ModernBadge tone={toneForText(latestCreatedRequest.status)}>{latestCreatedRequest.status}</ModernBadge><ModernBadge tone="info">Bitiş: {formatDate(latestCreatedRequest.due_at)}</ModernBadge></div></ModernCard> : null}<p className="mt-4 text-sm leading-6 text-sg-text-soft">{helperNote || 'Gerçek form hook’ları bağlanana kadar bu yüzey request lifecycle ve public kopya metnini taşımak için hazırlanmıştır.'}</p></PublicWrapper>;
}

export function ModernGdprPublicStatusPage({ site, status }: ModernGdprPublicStatusPageProps) {
  return <PublicWrapper title="Talep durumu" description={`${site.company_name} request tracking görünümü.`}>{status ? <DetailGrid title="Talep yaşam döngüsü" items={[{ label: 'Referans', value: status.reference_number, accent: true }, { label: 'Talep tipi', value: status.request_type }, { label: 'Durum', value: status.status, accent: true }, { label: 'Gönderim', value: formatDate(status.submitted_at) }, { label: 'Bitiş tarihi', value: status.due_at ? formatDate(status.due_at) : '—' }, { label: 'Son mesaj', value: status.last_message || '—' }]} /> : <AvailabilityBanner availability={{ state: 'unavailable', title: 'Talep bulunamadı.', description: 'Tracking token için public status view model bekleniyor.' }} />}</PublicWrapper>;
}
