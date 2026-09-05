import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '@/components/ConfirmDialog';
import { ToastProvider } from '@/lib/toast';
import type { AlisPageProps } from '@/make/alis/AlisPage';
import type { PosSavedPurchaseListItem, PosWorkspace } from '@/types';

// Node 26 + jsdom kurulumunda window.localStorage tanımsız geliyor
// (opaque origin / --localstorage-file); hook mount'undaki legacy
// temizlik etkisi bunu kullanıyor. Basit in-memory Storage taklağı.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  get length() {
    return this.store.size;
  }
}

beforeAll(() => {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (typeof window[name] === 'undefined') {
      Object.defineProperty(window, name, {
        value: new MemoryStorage(),
        configurable: true,
        writable: false,
      });
    }
  }
});

const apiRequestMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiRequest: (...args: Parameters<typeof import('@/lib/api').apiRequest>) => apiRequestMock(...args),
  };
});

import { AlisPage } from '../AlisPage';
import { useAlisMakeState } from '../useAlisMakeState';

const EMPTY_CUSTOMER = {
  name: '',
  email: '',
  phone: '',
  address: '',
  postal_code: '',
  city: '',
  cpr_number: '',
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: '',
};

const EMPTY_MARKET_RATES = {
  eur_dkk_fx: '7.46',
  gold_rates_dkk: {},
  silver_rates_dkk: {},
  gold_24k_dkk: '1000',
  silver_dkk: '12',
  gold_matrix: [],
  silver_matrix: [],
};

function mountMocks() {
  apiRequestMock.mockImplementation((url: unknown) => {
    const path = String(url);
    if (path.includes('/api/v2/alis/workspace/open-draft')) return Promise.resolve(null);
    if (path.includes('/api/customers?page_size=100')) {
      return Promise.resolve({ items: [], page: 1, page_size: 100, total: 0, total_pages: 0 });
    }
    if (path.includes('/api/v2/alis/list')) return Promise.resolve([]);
    return Promise.reject(new Error(`Beklenmeyen istek: ${path}`));
  });
}

beforeEach(() => {
  mountMocks();
});

function renderAlisPage(overrides: Partial<AlisPageProps>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    pdfState: { url: null, filename: '', loading: false, error: null },
    onClosePdfModal: () => undefined,
    detailPurchase: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    onRetryDetail: () => undefined,
    onCloseDetail: () => undefined,
    onEditDetail: () => undefined,
    onDeleteDetail: () => undefined,
    onExportDetail: () => undefined,
    onPrintDetail: () => undefined,
    onOpenDetailExcelPreview: () => undefined,
    detailActionPending: false,
    workspace: null,
    draftWorkspace: null,
    onResumeDraft: () => undefined,
    documents: [],
    purchaseSearchTerm: '',
    setPurchaseSearchTerm: () => undefined,
    purchaseDate: '',
    setPurchaseDate: () => undefined,
    onOpenCustomer: () => undefined,
    onViewDocument: () => undefined,
    onOpenDocumentExcelPreview: () => undefined,
    onExportDocument: () => undefined,
    onPrintDocument: () => undefined,
    onStartFromCustomer: () => undefined,
    onEditDocument: () => undefined,
    onDeleteDocument: () => undefined,
    onRetryUnicontaSync: () => undefined,
    retryPendingSequenceNo: null,
    onCancelUnicontaInvoice: () => undefined,
    cancelPendingSequenceNo: null,
    listLoading: false,
    listError: null,
    onRetryDocuments: () => undefined,
    actionPendingSequenceNo: null,
    customerMode: null,
    setCustomerMode: () => undefined,
    customerSearchTerm: '',
    setCustomerSearchTerm: () => undefined,
    candidateCustomers: [],
    newCustomer: { ...EMPTY_CUSTOMER },
    setNewCustomer: () => undefined,
    customerForm: { ...EMPTY_CUSTOMER },
    setCustomerForm: () => undefined,
    onSelectExistingCustomer: () => undefined,
    onCreateNewCustomer: () => undefined,
    onDetachCustomer: () => undefined,
    detachCustomerPending: false,
    onCustomerBlur: () => undefined,
    goldRows: [],
    silverRows: [],
    barRows: [],
    ptpdRows: [],
    extraRows: [],
    onUpdateGoldRow: () => undefined,
    onUpdateSilverRow: () => undefined,
    onUpdateBarRow: () => undefined,
    onUpdatePtPdRow: () => undefined,
    onUpdateExtraRow: () => undefined,
    onDeleteExtraRow: () => undefined,
    onAddExtraRows: () => undefined,
    onApplyGoldCalculatorTarget: () => undefined,
    activeWorkspaceView: 'system' as const,
    setActiveWorkspaceView: () => undefined,
    numbering: { afregnings_number_next: '', invoice_number_next: '' },
    setNumbering: () => undefined,
    onUpdateNumbering: () => undefined,
    invoiceGoldMode: 'auto' as const,
    invoiceGoldRows: [],
    invoiceGoldFooterLines: [],
    onUpdateInvoiceGoldRow: () => undefined,
    onUpdateInvoiceGoldFooterLine: () => undefined,
    onResetInvoiceGoldToAuto: () => undefined,
    invoiceMiscMode: 'auto' as const,
    invoiceMiscRows: [],
    onUpdateInvoiceMiscRow: () => undefined,
    onResetInvoiceMiscToAuto: () => undefined,
    bankInfo: { reg_number: '', account_number: '' },
    setBankInfo: () => undefined,
    marketRates: { ...EMPTY_MARKET_RATES },
    setMarketRates: () => undefined,
    afgNote: '',
    setAfgNote: () => undefined,
    purchaseVatEnabled: false,
    setPurchaseVatEnabled: () => undefined,
    calculators: { gold_rows: [], silver_rows: [] },
    setCalculators: () => undefined,
    paymentMethod: 'bank' as const,
    setPaymentMethod: () => undefined,
    onPrintWorkspace: () => undefined,
    onOpenWorkspaceExcelPreview: () => undefined,
    onCancelWorkspace: () => undefined,
    onFinalizeWorkspace: () => undefined,
    customerPending: false,
    customerSelecting: false,
    finalizePending: false,
    cancelPending: false,
    onStartBlankWorkspace: () => undefined,
    startPending: false,
    priceOpen: false,
    setPriceOpen: () => undefined,
    ...overrides,
  } as unknown as AlisPageProps;

  return render(
    <MemoryRouter initialEntries={['/pos']}>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <AlisPage {...props} />
        </ConfirmProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('AlisPage hata durumları (klasik varyant)', () => {
  it('listError varken boş-durum ("Henüz kayıtlı alış yok") yerine hata satırı + Tekrar dene gösterir', () => {
    const onRetryDocuments = vi.fn();
    renderAlisPage({ listError: 'Sunucuya ulaşılamadı', onRetryDocuments });

    expect(screen.getByText('Alış listesi yüklenemedi')).toBeInTheDocument();
    expect(screen.getByText('Sunucuya ulaşılamadı')).toBeInTheDocument();
    expect(screen.queryByText('Henüz kayıtlı alış yok')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    expect(onRetryDocuments).toHaveBeenCalledTimes(1);
  });

  it('detailError varken "yükleniyor" yerine ayrı hata dalı + Tekrar dene gösterir', () => {
    const onRetryDetail = vi.fn();
    const detailPurchase = {
      sequence_no: 7,
      session_id: 's-7',
      session_code: 'S-7',
      document_number: 'AFG-7',
      issued_at: '2026-09-05T10:00:00Z',
      customer_name: 'Ada Yılmaz',
      gross_amount_dkk: '1000',
      line_count: 1,
      gold_preview_items: [],
      silver_preview_items: [],
      can_edit: true,
      can_delete: true,
    } as unknown as PosSavedPurchaseListItem;

    renderAlisPage({ detailPurchase, detailError: 'Belge sunucuda bulunamadı', onRetryDetail });

    expect(screen.getByText('Belge detayları yüklenemedi')).toBeInTheDocument();
    expect(screen.getByText('Belge sunucuda bulunamadı')).toBeInTheDocument();
    expect(screen.queryByText('Belge detayları yükleniyor...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tekrar dene/ }));
    expect(onRetryDetail).toHaveBeenCalledTimes(1);
  });

  it('hata olmadığında boş-durum ve yükleniyor metinleri aynen korunur', () => {
    renderAlisPage({ listError: null, documents: [] });
    expect(screen.getByText('Henüz kayıtlı alış yok')).toBeInTheDocument();

    renderAlisPage({ detailPurchase: { sequence_no: 1 } as unknown as PosSavedPurchaseListItem, detail: null, detailError: null });
    expect(screen.getByText('Belge detayları yükleniyor...')).toBeInTheDocument();
  });
});

// --- useAlisMakeState: openWorkspace onError + cancelWorkspaceWithConfirm ---

function renderAlisState() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest: ReturnType<typeof useAlisMakeState> | null = null;
  function Harness() {
    latest = useAlisMakeState();
    return null;
  }
  render(
    <MemoryRouter initialEntries={['/pos']}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <Harness />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return {
    get state() {
      return latest!;
    },
  };
}

const WORKSPACE_RESPONSE = {
  workspace_revision: 1,
  needs_price_repair: false,
  artifact_sync_state: 'synced',
  session: {
    id: 's-1',
    session_code: 'S-1',
    display_token: 'tok',
    trade_side: 'buy_from_customer',
    rate_source: 'live',
    margin_percent_internal: '0',
    status: 'draft',
    created_at: '2026-09-05T10:00:00Z',
    updated_at: '2026-09-05T10:00:00Z',
  },
  customer: { customer_id: null, name: '' },
  bank_info: { reg_number: '', account_number: '' },
  payment_method: 'bank',
  market_rates: { ...EMPTY_MARKET_RATES },
  afg_note: null,
  purchase_vat_enabled: false,
  purchase_vat_rate_percent: '0',
  calculators: { gold_rows: [], silver_rows: [] },
  numbering_preview: { product_number_next: '1', reference_number_next: '1', afregnings_number_next: '1001', invoice_number_next: '1' },
  invoice_gold_mode: 'auto',
  gold_rows: [],
  silver_rows: [],
  bar_rows: [],
  ptpd_rows: [],
  extra_rows: [],
  invoice_gold: { rows: [], footer_lines: [], total_grams: '0', total_amount_dkk: '0' },
  invoice_misc_mode: 'auto',
  invoice_misc: { rows: [], total_amount_dkk: '0' },
  quick_mode_editable: true,
  summary: {
    active_line_count: 0,
    total_weight_grams: '0',
    total_pure_gold_grams: '0',
    gold_weight_grams: '0',
    silver_weight_grams: '0',
    total_amount_dkk: '0',
    net_amount_dkk: '0',
    vat_rate_percent: '0',
    vat_amount_dkk: '0',
    gross_amount_dkk: '0',
  },
} as unknown as PosWorkspace;

function cancelCalls() {
  return apiRequestMock.mock.calls.filter(([url]) => String(url).includes('/cancel'));
}

describe('useAlisMakeState — Yeni Alış Başlat hata bildirimi', () => {
  it('workspace açılışı başarısız olunca "Alış başlatılamadı" toastı gösterilir', async () => {
    apiRequestMock.mockImplementation((url: unknown, init?: { method?: string }) => {
      const path = String(url);
      if (path === '/api/v2/alis/workspace' && init?.method === 'POST') {
        return Promise.reject(new Error('sunucu yanıt vermiyor'));
      }
      if (path.includes('/api/v2/alis/workspace/open-draft')) return Promise.resolve(null);
      if (path.includes('/api/customers?page_size=100')) {
        return Promise.resolve({ items: [], page: 1, page_size: 100, total: 0, total_pages: 0 });
      }
      if (path.includes('/api/v2/alis/list')) return Promise.resolve([]);
      return Promise.reject(new Error(`Beklenmeyen istek: ${path}`));
    });

    const harness = renderAlisState();

    harness.state.onStartBlankWorkspace();

    expect(await screen.findByText('Alış başlatılamadı')).toBeInTheDocument();
    expect(await screen.findByText('sunucu yanıt vermiyor')).toBeInTheDocument();
    expect(harness.state.workspace).toBeNull();
  });
});

describe('useAlisMakeState — taslak iptali tek onay kaynağı', () => {
  it('onCancelWorkspace onay diyaloğu açar; onaylamadan cancel isteği atılmaz, Vazgeç isteği de iptal eder', async () => {
    apiRequestMock.mockImplementation((url: unknown, init?: { method?: string }) => {
      const path = String(url);
      if (path === '/api/v2/alis/workspace' && init?.method === 'POST') return Promise.resolve(WORKSPACE_RESPONSE);
      if (path.includes('/cancel')) return Promise.resolve(WORKSPACE_RESPONSE);
      if (path.includes('/api/v2/alis/workspace/open-draft')) return Promise.resolve(null);
      if (path.includes('/api/customers?page_size=100')) {
        return Promise.resolve({ items: [], page: 1, page_size: 100, total: 0, total_pages: 0 });
      }
      if (path.includes('/api/v2/alis/list')) return Promise.resolve([]);
      // Diğer yollar (ör. autosave rows PUT ack'i) workspace state'ini günceller —
      // ack session taşımalı, bomboş bir nesne workspace'i ezmesin.
      return Promise.resolve(WORKSPACE_RESPONSE);
    });

    const harness = renderAlisState();

    harness.state.onStartBlankWorkspace();
    await waitFor(() => expect(harness.state.workspace?.session.id).toBe('s-1'));

    harness.state.onCancelWorkspace();

    // Onay diyaloğu açık, cancel isteği henüz yok
    expect(await screen.findByText('Taslak iptal edilsin mi?')).toBeInTheDocument();
    expect(cancelCalls()).toHaveLength(0);

    // Vazgeç → taslak durur, istek atılmaz
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => expect(screen.queryByText('Taslak iptal edilsin mi?')).not.toBeInTheDocument());
    expect(cancelCalls()).toHaveLength(0);
    expect(harness.state.workspace?.session.id).toBe('s-1');

    // Tekrar dene → onayla → cancel isteği
    harness.state.onCancelWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Taslağı iptal et' }));
    await waitFor(() => expect(cancelCalls()).toHaveLength(1));
    expect(String(cancelCalls()[0][0])).toBe('/api/v2/alis/workspace/s-1/cancel');
  });
});
