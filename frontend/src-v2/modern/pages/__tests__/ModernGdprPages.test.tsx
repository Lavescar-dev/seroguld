import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiRequest: (path: string, options?: Parameters<typeof import('@/lib/api').apiRequest>[1]) =>
      apiRequestMock(path, options),
    downloadAuthedDocument: vi.fn(),
  };
});

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/lib/toast';
import type { GdprCopyTask, GdprRequestDetail, GdprRequestListItem } from '@/make/gdpr/types';

import { ModernGdprCockpitPage } from '../ModernGdprPages';

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
  ...FAILED_TASK,
  id: 'task-2',
  task_key: 'pos_docs',
  system_name: 'POS ledger',
  copy_scope: 'muhasebe kayıtları',
  status: 'legally_retained',
  completion_eligible: true,
  reason: null,
  resolved_at: '2026-09-01T11:00:00Z',
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

function renderCockpit(overrides: Partial<ComponentProps<typeof ModernGdprCockpitPage>> = {}) {
  const props: ComponentProps<typeof ModernGdprCockpitPage> = {
    overview: OVERVIEW,
    requests: [REQUEST_ITEM],
    jobs: [],
    processors: [],
    retentionPolicies: [],
    selectedRequest: REQUEST_DETAIL,
    isLoading: false,
    isRefreshing: false,
    onRefresh: vi.fn(),
    onSelectRequest: vi.fn(),
    activeMutation: false,
    onVerify: vi.fn().mockResolvedValue({}),
    onApprove: vi.fn().mockResolvedValue({}),
    onReject: vi.fn().mockResolvedValue({}),
    onEnqueue: vi.fn().mockResolvedValue({}),
    onExecute: vi.fn().mockResolvedValue({}),
    onUpdatePolicy: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  render(<ModernGdprCockpitPage {...props} />, { wrapper: Wrapper });
  return props;
}

describe('ModernGdprCockpitPage hata yüzeyi', () => {
  it('runAction hata üretirse toast ile yüzeye çıkar; sessizce yutulmaz', async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error('backend reddetti'));
    renderCockpit({ onApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));

    await waitFor(() => expect(screen.getByText('İşlem başarısız')).toBeInTheDocument());
    expect(screen.getByText('backend reddetti')).toBeInTheDocument();
    expect(onApprove).toHaveBeenCalledWith('req-1', '');
  });
});

describe('ModernGdprCockpitPage talep sahibi görünürlüğü', () => {
  it('kartta talep sahibi adı ve iletişim bilgisi görünür; ham UUID yerine eşleşen müşteri gösterilir', () => {
    renderCockpit();

    // Kuyruk kartı: konu adı + iletişim.
    expect(screen.getByText('Ayşe Yılmaz · public_page')).toBeInTheDocument();
    expect(screen.getByText('ayse@example.dk · Eşleşen: Ayşe Yılmaz (C-7)')).toBeInTheDocument();
    // Detay grid: talep sahibi + e-posta + eşleşen müşteri (UUID değil).
    expect(screen.getByText('Talep sahibi')).toBeInTheDocument();
    expect(screen.getByText('ayse@example.dk')).toBeInTheDocument();
    expect(screen.getByText('Ayşe Yılmaz (C-7)')).toBeInTheDocument();
    expect(screen.queryByText('c-7')).not.toBeInTheDocument();
    // Talep metni bloğu.
    expect(screen.getByText('Lütfen verilerimi silin.')).toBeInTheDocument();
  });
});

describe('ModernGdprCockpitPage execute onay diyaloğu', () => {
  it('Çalıştır tek tıkla gitmez; erasure talebinde referans yazma onayı zorunludur', async () => {
    const props = renderCockpit();

    fireEvent.click(screen.getByRole('button', { name: 'Çalıştır' }));
    expect(props.onExecute).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Silme / Pseudonymize')).toBeInTheDocument();
    // Diyalog başlığındaki "geri alınamaz" + execute uyarısı — en az bir kez.
    expect(within(dialog).getAllByText(/geri alınamaz/i).length).toBeGreaterThan(0);

    const confirm = within(dialog).getByRole('button', { name: 'Evet, çalıştır' }) as HTMLButtonElement;
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Talep referans numarası'), {
      target: { value: 'GDPR-2026-0001' },
    });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(props.onExecute).toHaveBeenCalledTimes(1));
    expect(props.onExecute).toHaveBeenCalledWith('req-1');
  });

  it('İkinci execute yolu (Talebi tamamla) da aynı onay diyaloğuna bağlanır', async () => {
    const props = renderCockpit({
      // copy_tasks'taki tek applicable görev terminal (legally_retained) → gate açık.
      selectedRequest: { ...REQUEST_DETAIL, copy_tasks: [RETAINED_TASK] },
    });

    const complete = screen.getByRole('button', { name: 'Talebi tamamla' });
    expect(complete).not.toBeDisabled();
    fireEvent.click(complete);

    expect(props.onExecute).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    // Erasure talebi → referans yazma onayı bu yolda da zorunlu.
    const confirm = within(dialog).getByRole('button', { name: 'Evet, çalıştır' }) as HTMLButtonElement;
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Talep referans numarası'), {
      target: { value: 'GDPR-2026-0001' },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(props.onExecute).toHaveBeenCalledWith('req-1'));
  });
});

describe('ModernGdprCockpitPage copy-task hattı', () => {
  it('Copy-task kurtarma paneli PATCH ucunu gerekçeyle çağırır', async () => {
    apiRequestMock.mockResolvedValue(REQUEST_DETAIL);
    renderCockpit();

    expect(screen.getByText('Copy-task kurtarma')).toBeInTheDocument();
    expect(screen.getAllByText('Başarısız').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Hedef durum · db_master'), { target: { value: 'pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Görevi güncelle' }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith(
        '/api/v2/gdpr/requests/req-1/copy-tasks/task-1',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const call = apiRequestMock.mock.calls.find((entry) => String(entry[0]).includes('/copy-tasks/'));
    expect(String(call?.[1]?.body)).toContain('"status":"pending"');
  });

  it('PATCH ucu 404 dönerse "uç hazır değil" toastı gösterilir', async () => {
    apiRequestMock.mockRejectedValue(new ApiError(404, 'Not Found'));
    renderCockpit();

    fireEvent.change(screen.getByLabelText('Hedef durum · db_master'), { target: { value: 'pseudonymized' } });
    fireEvent.click(screen.getByRole('button', { name: 'Görevi güncelle' }));

    await waitFor(() => expect(screen.getByText('Uç hazır değil')).toBeInTheDocument());
  });
});
