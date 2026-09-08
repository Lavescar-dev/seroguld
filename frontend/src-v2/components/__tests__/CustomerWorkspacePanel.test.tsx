import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomerWorkspacePanel } from '../CustomerWorkspacePanel';

const apiRequest = vi.fn();

vi.mock('@/lib/api', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  fetchAuthedPdfBlob: vi.fn(),
  localizeApiError: (error: unknown) => (error instanceof Error && error.message.trim() ? error.message : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'),
}));

vi.mock('@/lib/toast', () => ({
  useToast: () => ({ show: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/CustomerNotesPanel', () => ({
  CustomerNotesPanel: () => <div data-testid="notes-panel-stub" />,
}));

vi.mock('@/components/PdfViewerModal', () => ({
  PdfViewerModal: () => <div data-testid="pdf-viewer-stub" />,
}));

// Tamamen sentetik müşteri verisi (saha verisi değil).
const workspacePayload = {
  purchase_count: 1,
  purchase_amount_dkk: '1000.00',
  sale_count: 0,
  sale_amount_dkk: '0.00',
  total_gold_grams: '10.50',
  total_silver_grams: '0',
  total_platinum_grams: '0',
  total_palladium_grams: '0',
  knife_count: '0',
  knife_total_weight_grams: '0',
  document_count: 2,
  note_count: 1,
  last_transaction_at: null,
  customer: { gdpr_status: 'active', risk: { level: 'low', score: 0, warnings: [] } },
};

const documentRow = (sequenceNo: number, documentNumber: string) => ({
  sequence_no: sequenceNo,
  session_id: `sess-${sequenceNo}`,
  document_number: documentNumber,
  document_title: 'Afregningsbilag',
  document_type: 'purchase_receipt',
  gross_amount_dkk: '1250.00',
  vat_rate_percent: '25.00',
  total_weight_grams: '10.50',
  issued_at: '2026-09-01T10:00:00Z',
  historical_imported_at: null,
  uniconta_invoice_number: null,
});

function mockRoutes(documents: readonly unknown[] | Error) {
  apiRequest.mockImplementation((url: string) => {
    if (url.includes('/workspace')) return Promise.resolve(workspacePayload);
    if (url.includes('/transactions')) return Promise.resolve({ items: [], total: 0 });
    if (url.includes('/documents')) {
      return documents instanceof Error ? Promise.reject(documents) : Promise.resolve(documents);
    }
    return Promise.reject(new Error(`beklenmeyen url: ${url}`));
  });
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomerWorkspacePanel customerId="11111111-1111-4111-8111-111111111111" customerName="Testove TESTSEN" />
    </QueryClientProvider>,
  );
}

describe('CustomerWorkspacePanel — belge listesi ve hata durumları', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('başarılı sorguda belge satırlarını gösterir, sayaç liste uzunluğunu yansıtır', async () => {
    mockRoutes([documentRow(1, 'AFG-1001'), documentRow(2, 'AFG-1002')]);
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Belgeler (2)' })).toBeInTheDocument();
    expect(screen.queryByText(/Belge yok/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Belgeler (2)' }));
    expect(await screen.findByText('AFG-1001')).toBeInTheDocument();
    expect(screen.getByText('AFG-1002')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AFG-1001 PDF aç/ })).toBeInTheDocument();
  });

  it('boş listede net "Belge yok" metni çıkar', async () => {
    mockRoutes([]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Belgeler (0)' }));
    expect(await screen.findByText(/Belge yok/)).toBeInTheDocument();
  });

  it('belge sorgusu hata verirsek kırmızı bant + sekme sayacında "!" gösterir', async () => {
    mockRoutes(new Error('belge servisi yanıt vermiyor'));
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Belgeler (!)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Belgeler (!)' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Belgeler yüklenemedi');
    expect(alert).toHaveTextContent('belge servisi yanıt vermiyor');
    expect(screen.queryByText(/Belge yok/)).not.toBeInTheDocument();
  });

  it('"Tekrar dene" sorguyu yeniden çalıştırır ve başarıda satırları basar', async () => {
    let documentCalls = 0;
    apiRequest.mockImplementation((url: string) => {
      if (url.includes('/workspace')) return Promise.resolve(workspacePayload);
      if (url.includes('/transactions')) return Promise.resolve({ items: [], total: 0 });
      if (url.includes('/documents')) {
        documentCalls += 1;
        if (documentCalls === 1) return Promise.reject(new Error('belge servisi yanıt vermiyor'));
        return Promise.resolve([documentRow(7, 'AFG-1007')]);
      }
      return Promise.reject(new Error(`beklenmeyen url: ${url}`));
    });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Belgeler (!)' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tekrar dene/ }));

    expect(await screen.findByText('AFG-1007')).toBeInTheDocument();
    expect(documentCalls).toBe(2);
    // Hata bantı temizlenir, sayaç gerçek sayıya döner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Belgeler (1)' })).toBeInTheDocument();
  });

  it('workspace sorgusu hata verirsek genel bakış bandı ve "!" sayaçları görünür', async () => {
    apiRequest.mockImplementation((url: string) => {
      if (url.includes('/workspace')) return Promise.reject(new Error('workspace servisi yanıt vermiyor'));
      if (url.includes('/transactions')) return Promise.resolve({ items: [], total: 0 });
      if (url.includes('/documents')) return Promise.resolve([]);
      return Promise.reject(new Error(`beklenmeyen url: ${url}`));
    });
    renderPanel();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Müşteri dosyası yüklenemedi');
    expect(screen.getByRole('button', { name: 'Genel bakış (!)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notlar (!)' })).toBeInTheDocument();
  });
});
