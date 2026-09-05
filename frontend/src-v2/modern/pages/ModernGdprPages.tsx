import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, Clock3, Database, Download, FileClock, FileKey2, LockKeyhole, Plus, RefreshCw, ShieldCheck, ShieldEllipsis, ShieldX, UsersRound, Workflow } from 'lucide-react';

import { ApiError, downloadAuthedDocument, localizeApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';

import { useGdprCopyTaskUpdate } from '@/make/gdpr/useGdprCopyTaskUpdate';
import { useGdprCreateRequest } from '@/make/gdpr/useGdprCreateRequest';
import {
  GDPR_COPY_COMPLETION_STATES,
  GDPR_COPY_REASON_REQUIRED_STATES,
  gdprCopyTaskStatusLabel,
  gdprRequestStatusLabel,
  gdprRequestTypeLabel,
} from '@/make/gdpr/types';
import type { GdprCopyTask, GdprRequestDetail } from '@/make/gdpr/types';

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

type ExecuteRejectKind = 'execute' | 'reject';

type ConfirmActionState = { kind: ExecuteRejectKind; request: GdprRequestDetail };

const COPY_TASK_TARGET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'Yeniden kuyruğa al (pending)' },
  { value: 'pseudonymized', label: 'Pseudonymize edildi' },
  { value: 'deleted', label: 'Silindi' },
  { value: 'legally_retained', label: 'Yasal saklamada' },
  { value: 'manual_action_required', label: 'Manuel aksiyon gerekli' },
  { value: 'failed', label: 'Başarısız' },
];

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
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);
  const [confirmRefInput, setConfirmRefInput] = useState('');
  const toast = useToast();
  const createRequestMutation = useGdprCreateRequest();
  const hasDecisionActions = Boolean(onApprove || onReject || onEnqueue || onExecute || onVerify);
  const relatedJobs = useMemo(() => {
    if (!selectedRequest) return [];
    const scoped = jobs.filter((job) => job.request_id === selectedRequest.id);
    if (scoped.length > 0) return scoped;
    return selectedRequest.latest_job ? [selectedRequest.latest_job] : [];
  }, [jobs, selectedRequest]);
  // Completion gate önce gerçek copy_tasks'a, satır yoksa job heuristiğine bakar.
  // Backend kuralı (gdpr_service._reconcile_copy_task_completion) ile aynıdır:
  // applicable tüm görevler deleted/pseudonymized/legally_retained olmadan
  // tamamlama açılmaz; override edilen görev gate'i otomatik çözer.
  const gate = useMemo(() => {
    const tasks = (selectedRequest?.copy_tasks || []).filter((task) => task.applicable);
    if (tasks.length > 0) {
      if (tasks.every((task) => GDPR_COPY_COMPLETION_STATES.includes(task.status))) {
        return { label: 'PASS', tone: 'success' as const, allowed: true, source: 'copy_tasks' as const, taskCount: tasks.length };
      }
      const failed = tasks.some((task) => task.status === 'failed');
      return {
        label: failed ? 'FAILED' : 'LOCKED',
        tone: failed ? ('danger' as const) : ('warning' as const),
        allowed: false,
        source: 'copy_tasks' as const,
        taskCount: tasks.length,
      };
    }
    return { ...completionState(relatedJobs), source: 'jobs' as const, taskCount: 0 };
  }, [relatedJobs, selectedRequest]);

  // Classic varyanttaki runAction deseni: mutasyon hatası sessizce yutulmaz,
  // toast ile yüzeye çıkar; aksiyon sürerken butonlar kilitli kalır.
  const runAction = async (key: string, action: () => unknown) => {
    setPendingAction(key);
    try {
      await action();
    } catch (error) {
      toast.error('İşlem başarısız', localizeApiError(error));
    } finally {
      setPendingAction(null);
    }
  };

  // Execute/Reject tek tıkla gitmez: önce onay diyaloğu açılır, istek yalnızca
  // diyaloğun onay butonuyla gönderilir. İki execute yolu da (Çalıştır ve
  // Completion gate'teki "Talebi tamamla") bu diyaloğa bağlanır.
  const openConfirm = (kind: ExecuteRejectKind) => {
    if (!selectedRequest) return;
    setConfirmRefInput('');
    setConfirmAction({ kind, request: selectedRequest });
  };

  const confirmReferenceRequired =
    confirmAction?.kind === 'execute' && confirmAction.request.request_type === 'erasure_pseudonymize';
  const confirmDisabled =
    Boolean(confirmAction) && confirmReferenceRequired && confirmRefInput.trim() !== confirmAction?.request.reference_number;

  const confirmAndRun = async () => {
    if (!confirmAction) return;
    const { kind, request } = confirmAction;
    setConfirmAction(null);
    setConfirmRefInput('');
    await runAction(kind, () =>
      kind === 'execute' ? onExecute?.(request.id) : onReject?.(request.id, decisionReason),
    );
  };

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
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-sg-text">{request.reference_number} · {gdprRequestTypeLabel(request.request_type)}</p><p className="mt-1 text-xs text-sg-text-soft">{request.subject_name || 'Konu adı yok'} · {request.channel}</p><p className="text-xs text-sg-text-soft">{request.subject_email || request.subject_phone || 'İletişim bilgisi yok'}{request.verified_customer_name ? ` · Eşleşen: ${request.verified_customer_name}` : ''}</p></div><ModernBadge tone={toneForText(request.status)}>{gdprRequestStatusLabel(request.status)}</ModernBadge></div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-sg-text-soft"><span>{request.due_at ? formatRelativeTime(request.due_at) : 'SLA yok'}</span><span>{request.submitted_at ? formatDate(request.submitted_at) : '—'}</span></div>
                </button>;
              }) : <ModernUnavailableState title="Talep kuyruğu boş" description="Gerçek GDPR request satırı dönmedi; boş durum başarı olarak boyanmaz." detail="NO REQUESTS" />}
            </div>
          </ModernSection>

          <div className="space-y-5">
            <DetailGrid title={selected ? `Aktif talep · ${selected.reference_number}` : 'Aktif talep'} description="Completion gate yalnız gerçek job state terminal olduğunda açılabilir." items={selected ? [
              { label: 'Talep sahibi', value: selected.subject_name || 'Konu adı yok', accent: true },
              { label: 'E-posta', value: selected.subject_email || '—' },
              { label: 'Telefon', value: selected.subject_phone || '—' },
              { label: 'Eşleşen müşteri', value: selected.verified_customer_name || selected.verified_customer_id || 'Henüz eşleşmedi' },
              { label: 'Talep türü', value: gdprRequestTypeLabel(selected.request_type), accent: true },
              { label: 'Durum', value: gdprRequestStatusLabel(selected.status), accent: true },
              { label: 'Kanal', value: selected.channel },
              { label: 'Gönderim', value: formatDate(selected.submitted_at) },
              { label: 'Son iş', value: selected.latest_job?.status || '—' },
              { label: 'Export', value: selected.export_download_path || 'Henüz yok' },
            ] : [{ label: 'Durum', value: 'Talep seçimi bekleniyor', accent: true }]} />
            {selected?.message ? (
              <ModernSection>
                <ModernSectionHeader title="Talep metni" description="Talep sahibinin kendi ifadesi; doğrulama ve kararda referanstır." />
                <div className="mt-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3 text-sm leading-6 text-sg-text">{selected.message}</div>
              </ModernSection>
            ) : null}
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
                            disabled={activeMutation || pendingAction !== null}
                            onClick={() => void runAction(`verify:${candidate.id}`, () => onVerify(selected.id, candidate.id))}
                            className="flex items-center justify-between rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-left transition hover:border-sg-accent disabled:opacity-60"
                          >
                            <div>
                              <p className="text-sm font-semibold text-sg-text">{candidate.name}</p>
                              <p className="text-xs text-sg-text-soft">{candidate.email || candidate.phone || candidate.cpr_number_masked || '—'}</p>
                            </div>
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-sg-accent">{pendingAction === `verify:${candidate.id}` ? 'İşleniyor…' : 'Doğrula'}</span>
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
                    {onApprove ? <ModernButton tone="primary" icon={ShieldCheck} disabled={activeMutation || pendingAction !== null} onClick={() => void runAction('approve', () => onApprove(selected.id, decisionReason))}>{pendingAction === 'approve' ? 'İşleniyor…' : 'Onayla'}</ModernButton> : null}
                    {onReject ? <ModernButton tone="danger" icon={ShieldX} disabled={activeMutation || pendingAction !== null} onClick={() => openConfirm('reject')}>Reddet</ModernButton> : null}
                    {onEnqueue ? <ModernButton tone="ghost" icon={Clock3} disabled={activeMutation || pendingAction !== null} onClick={() => void runAction('enqueue', () => onEnqueue(selected.id))}>{pendingAction === 'enqueue' ? 'İşleniyor…' : 'Kuyruğa al'}</ModernButton> : null}
                    {onExecute ? <ModernButton tone="success" icon={CheckCircle2} disabled={activeMutation || pendingAction !== null} onClick={() => openConfirm('execute')}>{pendingAction === 'execute' ? 'İşleniyor…' : 'Çalıştır'}</ModernButton> : null}
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
              <div className="mt-4 flex items-center justify-between gap-3 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3"><div><p className="text-sm font-semibold text-sg-text">B5 terminal gate</p><p className="mt-1 text-xs text-sg-text-soft">{gate.source === 'copy_tasks' ? `${gate.taskCount} gerçek copy-task satırı değerlendirildi.` : relatedJobs.length > 0 ? `${relatedJobs.length} gerçek job satırı değerlendirildi.` : "Copy-task kapsamı bu DTO'da eksik."}</p></div><ModernButton tone="primary" disabled={!gate.allowed || activeMutation || pendingAction !== null || !onExecute} title={gate.allowed ? undefined : gate.source === 'copy_tasks' ? 'Açık, başarısız veya manuel aksiyon bekleyen copy-task varken tamamlanamaz; görevi gerekçeyle override edin' : relatedJobs.length === 0 ? "Copy-task kapsamı bu DTO'da eksik; tamamlama kilitli" : 'Açık veya sürmekte olan copy-task varken tamamlanamaz'} onClick={() => openConfirm('execute')}>Talebi tamamla</ModernButton></div>
            </ModernSection>
            {selected && (selected.copy_tasks || []).length > 0 ? <CopyTaskResolutionPanel request={selected} disabled={activeMutation || pendingAction !== null} /> : null}
            <CopyTaskGrid jobs={relatedJobs} />
          </div>
        </div>
      ) : null}

      {activeTab === 'tasks' ? (
        <div className="space-y-5">
          {selected && (selected.copy_tasks || []).length > 0 ? <CopyTaskResolutionPanel request={selected} disabled={activeMutation || pendingAction !== null} /> : null}
          <CopyTaskGrid jobs={relatedJobs} />
        </div>
      ) : null}

      {activeTab === 'retention' ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <ModernSection>
            <ModernSectionHeader title="Retention politikaları" description="Veri sınıfı, süre ve legal action gerçek policy endpoint'inden gelir." />
            <div className="mt-4 space-y-3">{retentionPolicies.length > 0 ? retentionPolicies.map((policy) => (
              <RetentionPolicyCard key={policy.id} policy={policy} disabled={activeMutation || pendingAction !== null} onSave={(payload) => runAction(`policy:${policy.policy_key}`, () => onUpdatePolicy?.(payload))} />
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

      <ModernDialog
        open={Boolean(confirmAction)}
        onClose={() => { if (pendingAction === null) setConfirmAction(null); }}
        title={confirmAction?.kind === 'execute' ? 'Talebi çalıştır: son onay' : 'Talebi reddet: son onay'}
        description="Bu işlem geri alınamaz; talep bilgilerini doğrulamadan onaylamayın."
        footer={(
          <div className="flex items-center justify-end gap-2">
            <ModernButton tone="ghost" disabled={pendingAction !== null} onClick={() => setConfirmAction(null)}>Vazgeç</ModernButton>
            <ModernButton
              tone={confirmAction?.kind === 'execute' ? 'success' : 'danger'}
              icon={confirmAction?.kind === 'execute' ? CheckCircle2 : ShieldX}
              disabled={confirmDisabled || pendingAction !== null}
              onClick={() => void confirmAndRun()}
            >
              {confirmAction?.kind === 'execute' ? 'Evet, çalıştır' : 'Evet, reddet'}
            </ModernButton>
          </div>
        )}
      >
        {confirmAction ? (
          <div className="space-y-3 text-sm text-sg-text">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-sg-text-soft">Talep tipi</dt>
                <dd className="mt-0.5 font-semibold">{gdprRequestTypeLabel(confirmAction.request.request_type)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-sg-text-soft">Konu</dt>
                <dd className="mt-0.5 font-semibold">{confirmAction.request.subject_name || 'Konu adı yok'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-sg-text-soft">İletişim</dt>
                <dd className="mt-0.5">{confirmAction.request.subject_email || confirmAction.request.subject_phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-sg-text-soft">Eşleşen müşteri</dt>
                <dd className="mt-0.5">{confirmAction.request.verified_customer_name || 'Yok (doğrulanmadı)'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-sg-text-soft">Referans</dt>
                <dd className="mt-0.5 font-mono text-xs">{confirmAction.request.reference_number}</dd>
              </div>
              {confirmAction.kind === 'reject' ? (
                <div>
                  <dt className="text-xs font-semibold text-sg-text-soft">Gönderilecek gerekçe</dt>
                  <dd className="mt-0.5">{decisionReason.trim() || 'gerekçe yok'}</dd>
                </div>
              ) : null}
            </dl>
            <p className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2 text-xs font-semibold text-sg-text">
              {confirmAction.kind === 'execute'
                ? 'Yürütme geri alınamaz: müşteri verisi silinir/pseudonymize edilir ve dış sistemlere (Woo/WordPress) privacy sync gönderilir.'
                : 'Red kararı geri alınamaz; talep kapatılır ve gerekçe kayda geçer.'}
            </p>
            {confirmReferenceRequired ? (
              <label className="block text-xs font-semibold text-sg-text-soft">
                Silme/pseudonymize işlemini onaylamak için talep referans numarasını yazın: <span className="font-mono">{confirmAction.request.reference_number}</span>
                <input
                  type="text"
                  value={confirmRefInput}
                  onChange={(event) => setConfirmRefInput(event.target.value)}
                  placeholder={confirmAction.request.reference_number}
                  aria-label="Talep referans numarası"
                  className="mt-1 block w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent"
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </ModernDialog>
    </ModernPage>
  );
}

function CopyTaskResolutionPanel({ request, disabled }: { request: GdprRequestDetail; disabled?: boolean }) {
  const toast = useToast();
  const updateTask = useGdprCopyTaskUpdate();
  const [drafts, setDrafts] = useState<Record<string, { status: string; reason: string }>>({});
  const tasks: GdprCopyTask[] = request.copy_tasks || [];

  const draftFor = (task: GdprCopyTask) => drafts[task.id] || { status: '', reason: '' };
  // Completion durumundaki görevler backend'de terminaldir; override yalnız
  // kurtarılabilir (pending/running/failed/manual_action_required) görevlere açık.
  const overrideable = (task: GdprCopyTask) => task.applicable && !GDPR_COPY_COMPLETION_STATES.includes(task.status);

  const runUpdate = async (task: GdprCopyTask, status: string, reason: string) => {
    try {
      await updateTask.mutateAsync({ requestId: request.id, taskId: task.id, status, reason });
      toast.success('Görev güncellendi', `${task.task_key} → ${gdprCopyTaskStatusLabel(status)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        toast.error('Uç hazır değil', 'Copy task güncelleme ucu bulunamadı (404); backend dağıtımını kontrol edin.');
      } else {
        toast.error('İşlem başarısız', localizeApiError(error));
      }
    }
  };

  return (
    <ModernSection>
      <ModernSectionHeader title="Copy-task kurtarma" description="Manuel aksiyon / hata / takılmış görevler gerekçeli override ile kurtarılır; tamamlanmış görevler kilitlidir." />
      <div className="mt-4 grid gap-3">
        {tasks.map((task) => {
          const draft = draftFor(task);
          const reasonRequired = GDPR_COPY_REASON_REQUIRED_STATES.includes(draft.status);
          const canSave = Boolean(draft.status) && (!reasonRequired || draft.reason.trim().length >= 3);
          const busy = updateTask.isPending;
          return (
            <ModernCard key={task.id} className="bg-sg-surface-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-sg-text">{task.task_key} · {task.system_name}</p>
                  <p className="mt-1 text-xs text-sg-text-soft">{task.copy_scope}</p>
                  {task.reason ? <p className="mt-1 text-xs text-sg-text-soft">Gerekçe: {task.reason}</p> : null}
                  <p className="mt-1 text-xs text-sg-text-soft">{task.resolved_at ? `Çözüm: ${formatDate(task.resolved_at)} · ` : ''}Güncelleme: {formatDate(task.updated_at)}</p>
                </div>
                <ModernBadge tone={toneForText(task.status)}>{gdprCopyTaskStatusLabel(task.status)}</ModernBadge>
              </div>
              {overrideable(task) ? (
                <div className="mt-3 grid gap-2 border-t border-sg-border-soft pt-3">
                  <label className="text-[11px] font-semibold text-sg-text-soft">
                    Hedef durum
                    <select
                      value={draft.status}
                      disabled={disabled || busy}
                      aria-label={`Hedef durum · ${task.task_key}`}
                      onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, status: event.target.value } }))}
                      className="mt-1 block w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent"
                    >
                      <option value="">Seçin…</option>
                      {COPY_TASK_TARGET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] font-semibold text-sg-text-soft">
                    {reasonRequired ? 'Gerekçe (zorunlu)' : 'Gerekçe (opsiyonel)'}
                    <input
                      type="text"
                      value={draft.reason}
                      disabled={disabled || busy}
                      aria-label={`Gerekçe · ${task.task_key}`}
                      placeholder={reasonRequired ? 'En az 3 karakter' : 'Not'}
                      onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, reason: event.target.value } }))}
                      className="mt-1 block w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent"
                    />
                  </label>
                  <ModernButton tone="primary" size="sm" disabled={disabled || busy || !canSave} onClick={() => void runUpdate(task, draft.status, draft.reason.trim())}>
                    Görevi güncelle
                  </ModernButton>
                </div>
              ) : null}
            </ModernCard>
          );
        })}
      </div>
    </ModernSection>
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
