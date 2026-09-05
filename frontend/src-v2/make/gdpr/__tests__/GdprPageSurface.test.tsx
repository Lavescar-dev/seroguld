import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// ApiError gerçek sınıf kalsın (404 guard testi instanceof kullanır), yalnız
// ağa dokunan fonksiyonlar mock'lanır.
const { downloadAuthedDocumentMock } = vi.hoisted(() => ({ downloadAuthedDocumentMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    downloadAuthedDocument: downloadAuthedDocumentMock,
  };
});

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/lib/toast';

import { MakeGdprPage } from '../GdprPage';
import type { GdprCopyTask, GdprRequestDetail, GdprRequestListItem } from '../types';

const FAILED_TASK: GdprCopyTask = {
  id: 'task-1',
  request_id: 'req-1',
  task_key: 'db_master',
  system_name: 'CRM DB',
  copy_scope: 'customer master + identity',
  applicable: true,
  status: 'failed',
  is_terminal: true,
  completion_eligible: false,
  reason: 'Woo eşleşmesi belirsiz',
  metadata_json: {},
  resolved_at: null,
  created_at: '2026-09-01T10:05:00Z',
  updated_at: '2026-09-01T10:06:00Z',
};

const RETAINED_TASK: GdprCopyTask = {
  id: 'task-2',
  request_id: 'req-1',
  task_key: 'pos_docs',
  system_name: 'POS ledger',
  copy_scope: 'muhasebe kayıtları',
  applicable: true,
  status: 'legally_retained',
  is_terminal: true,
  completion_eligible: true,
  reason: null,
  metadata_json: {},
  resolved_at: '2026-09-01T11:00:00Z',
  created_at: '2026-09-01T10:05:00Z',
  updated_at: '2026-09-01T11:00:00Z',
};

const REQUEST_ITEM: GdprRequestListItem = {
  id: 'req-1',
  reference_number: 'GDPR-2026-0001',
  request_type: 'erasure_pseudonymize',
  status: 'approved',
  channel: 'public_page',
  subject_name: 'Ayşe Yılmaz',
  subject_email: 'ayse@example.dk',
  subject_phone: null,
  verified_customer_id: 'c-7',
  verified_customer_name: 'Ayşe Yılmaz (C-7)',
  due_at: null,
  submitted_at: '2026-09-01T10:00:00Z',
  completed_at: null,
};

const REQUEST_DETAIL: GdprRequestDetail = {
  ...REQUEST_ITEM,
  message: 'Lütfen verilerimi silin.',
  decision_reason: null,
  request_meta: {},
  match_candidates: [],
  events: [],
  latest_job: null,
  export_download_path: null,
  copy_tasks: [FAILED_TASK, RETAINED_TASK],
};

const OVERVIEW = {
  open_request_count: 1,
  due_soon_count: 0,
  overdue_count: 0,
  completed_30d_count: 0,
  eligible_pseudonymize_count: 0,
  locked_product_count: 0,
  processor_warning_count: 0,
  queued_job_count: 0,
  failed_job_count: 0,
  last_scan_at: null,
  last_run_at: null,
  readiness_checks: [],
};

function renderPage(overrides: Partial<Parameters<typeof MakeGdprPage>[0]> = {}) {
  const props: Parameters<typeof MakeGdprPage>[0] = {
    overview: OVERVIEW,
    requests: [REQUEST_ITEM],
    jobs: [],
    selectedRequestId: 'req-1',
    setSelectedRequestId: vi.fn(),
    selectedRequest: REQUEST_ITEM,
    requestDetail: REQUEST_DETAIL,
    retentionPolicies: [],
    processors: [],
    publicConfig: null,
    bridgeConfig: null,
    statusFilter: 'all',
    customerFilter: null,
    setStatusFilter: vi.fn(),
    clearCustomerFilter: vi.fn(),
    isLoading: false,
    isRefreshing: false,
    activeMutation: false,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onVerify: vi.fn().mockResolvedValue({}),
    onApprove: vi.fn().mockResolvedValue({}),
    onReject: vi.fn().mockResolvedValue({}),
    onEnqueue: vi.fn().mockResolvedValue({}),
    onExecute: vi.fn().mockResolvedValue({}),
    onUpdatePolicy: vi.fn().mockResolvedValue({}),
    onUpdateCopyTask: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  const Wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;
  render(<MakeGdprPage {...props} />, { wrapper: Wrapper });
  return props;
}

describe('MakeGdprPage execute/reject onay diyaloğu', () => {
  it('Execute tek tıkla istek göndermez; erasure talebinde referans yazma onayı zorunludur', async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    expect(props.onExecute).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Evet, çalıştır' })).not.toBeNull();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Talep çalıştırılsın mı?')).toBeInTheDocument();
    // Diyalog talep tipini, konu adını ve eşleşen müşteriyi gösterir.
    expect(within(dialog).getByText('Silme / Pseudonymize')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Ayşe Yılmaz/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/geri alınamaz/i)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Evet, çalıştır' }) as HTMLButtonElement;
    // erasure_pseudonymize → referans numarası yazılmadan onay kapalı.
    expect(confirm).toBeDisabled();
    const refInput = within(dialog).getByPlaceholderText('GDPR-2026-0001');
    fireEvent.change(refInput, { target: { value: 'GDPR-2026-9999' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(refInput, { target: { value: 'GDPR-2026-0001' } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(props.onExecute).toHaveBeenCalledTimes(1));
    expect(props.onExecute).toHaveBeenCalledWith('req-1');
  });

  it('Reject onay diyaloğu olmadan gitmez; onay ile gerekçe gönderilir', async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(props.onReject).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Talep reddedilsin mi?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Evet, reddet' }));

    await waitFor(() => expect(props.onReject).toHaveBeenCalledTimes(1));
    expect(props.onReject).toHaveBeenCalledWith('req-1', '');
  });

  it('Vazgeç diyaloğu kapatır ve istek göndermez', async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Vazgeç' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(props.onExecute).not.toHaveBeenCalled();
  });
});

describe('MakeGdprPage karar paneli durum makinesi', () => {
  const IDENTITY_PENDING_ITEM: GdprRequestListItem = { ...REQUEST_ITEM, status: 'identity_pending', verified_customer_id: null, verified_customer_name: null };
  const IDENTITY_PENDING_DETAIL: GdprRequestDetail = {
    ...IDENTITY_PENDING_ITEM,
    message: null,
    decision_reason: null,
    request_meta: {},
    match_candidates: [],
    events: [],
    latest_job: null,
    export_download_path: null,
    copy_tasks: [],
  };

  it('identity_pending talepte Execute/Enqueue/Approve kilitli, neden-disabled title görünür', () => {
    renderPage({
      requests: [IDENTITY_PENDING_ITEM],
      selectedRequest: IDENTITY_PENDING_ITEM,
      requestDetail: IDENTITY_PENDING_DETAIL,
    });

    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enqueue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Execute' })).toHaveAttribute('title', expect.stringContaining('approved/queued'));
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('title', expect.stringContaining('müşteri doğrulanmalı'));
  });

  it('statü rozetleri ham enum yerine etiket haritasını kullanır', () => {
    renderPage({
      requests: [IDENTITY_PENDING_ITEM],
      selectedRequest: IDENTITY_PENDING_ITEM,
      requestDetail: IDENTITY_PENDING_DETAIL,
    });

    expect(screen.getAllByText('Kimlik doğrulaması bekliyor').length).toBeGreaterThan(0);
  });

  it('Pseudonymize Adayı kartı under_review filtresini tetikler', () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Pseudonymize Adayı/ }));
    expect(props.setStatusFilter).toHaveBeenCalledWith('under_review');
  });

  it('statü filtresinde under_review ve manual_action_required seçenekleri var', () => {
    renderPage();

    expect(screen.getByRole('option', { name: 'Under review' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Manual action required' })).toBeInTheDocument();
  });

  it('başarılı karardan sonra decisionReason sıfırlanır', async () => {
    const props = renderPage();

    const reasonBox = screen.getByPlaceholderText('Karar gerekçesi veya operatör notu');
    fireEvent.change(reasonBox, { target: { value: 'müşteri telefonla aradı' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(props.onApprove).toHaveBeenCalledWith('req-1', 'müşteri telefonla aradı'));

    // Reset sonrası reject diyaloğu "gerekçe yok" gösterir.
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(within(screen.getByRole('dialog')).getByText(/gerekçe yok/)).toBeInTheDocument();
  });
});

describe('MakeGdprPage yeni talep paneli ve hata bandı', () => {
  it('Yeni talep paneli açılır, doldurulunca onCreateRequest çağrılır ve form kapanır', async () => {
    const onCreateRequest = vi.fn().mockResolvedValue({ reference_number: 'GDPR-2026-0500' });
    const props = renderPage({ onCreateRequest });

    fireEvent.click(screen.getByRole('button', { name: 'Yeni talep' }));
    fireEvent.change(screen.getByLabelText('Konu adı'), { target: { value: 'Mağaza Müşterisi' } });
    fireEvent.change(screen.getByLabelText('E-posta'), { target: { value: 'magaza@example.dk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Talebi oluştur' }));

    await waitFor(() => expect(onCreateRequest).toHaveBeenCalledWith({
      request_type: 'access_export',
      subject_name: 'Mağaza Müşterisi',
      subject_email: 'magaza@example.dk',
      subject_phone: undefined,
      message: undefined,
    }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Talebi oluştur' })).not.toBeInTheDocument());
    // Liste yenileme tetiklenir.
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalled());
  }, 15000);

  it('Konu adı 2 karakterden kısayken kayıt kilitli', () => {
    renderPage({ onCreateRequest: vi.fn().mockResolvedValue({}) });

    fireEvent.click(screen.getByRole('button', { name: 'Yeni talep' }));
    fireEvent.change(screen.getByLabelText('Konu adı'), { target: { value: 'A' } });
    expect(screen.getByRole('button', { name: 'Talebi oluştur' })).toBeDisabled();
  });

  it('requests sorgusu hata verince hata bandı gösterilir, boş-liste metni değil', () => {
    renderPage({ requests: [], requestsError: new Error('boom') });

    expect(screen.getByText('Request listesi yüklenemedi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
    expect(screen.queryByText('Bu filtrede request yok.')).not.toBeInTheDocument();
  });
});

describe('MakeGdprPage copy-task hattı', () => {
  it('copy_tasks listelenir; failed görev için gerekçeli PATCH yolu çağrılır', async () => {
    const props = renderPage();

    expect(screen.getByText('Kopya görevleri')).toBeInTheDocument();
    // Durum etiketi (badge) + hedef durum select opsiyonu — en az bir kez.
    expect(screen.getAllByText('Başarısız').length).toBeGreaterThan(0);
    expect(screen.getByText('Gerekçe: Woo eşleşmesi belirsiz')).toBeInTheDocument();
    // Terminal (yasal saklamada) görevde override kontrolü yok.
    expect(screen.getAllByRole('button', { name: 'Görevi güncelle' }).length).toBe(1);

    const target = screen.getByLabelText('Hedef durum · db_master');
    const reason = screen.getByLabelText('Gerekçe · db_master');
    const save = screen.getByRole('button', { name: 'Görevi güncelle' }) as HTMLButtonElement;

    // reason-required hedef durum gerekçesiz kilitli.
    fireEvent.change(target, { target: { value: 'manual_action_required' } });
    expect(save).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'Manuel temizlik yapıldı' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(props.onUpdateCopyTask).toHaveBeenCalledWith({
      requestId: 'req-1',
      taskId: 'task-1',
      status: 'manual_action_required',
      reason: 'Manuel temizlik yapıldı',
    }));
  });

  it('copy task ucu 404 dönerse "uç hazır değil" toastı gösterilir', async () => {
    const onUpdateCopyTask = vi.fn().mockRejectedValue(new ApiError(404, 'Not Found'));
    renderPage({ onUpdateCopyTask });

    fireEvent.change(screen.getByLabelText('Hedef durum · db_master'), { target: { value: 'pseudonymized' } });
    fireEvent.click(screen.getByRole('button', { name: 'Görevi güncelle' }));

    await waitFor(() => expect(screen.getByText('Uç hazır değil')).toBeInTheDocument());
  });
});
