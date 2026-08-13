export type FaturaTipi = 'Salgsfaktura' | 'Kreditnota' | 'Forudbetaling' | 'Rentefaktura';
export type BaglantiDurumu = 'bagli' | 'bagli_degil' | 'yukleniyor' | 'hata';
export type SortKey = 'fakturanummer' | 'fakturadato' | 'total' | 'kunde' | 'konto';
export type SortDir = 'asc' | 'desc';
export type MailFiltre = 'tümü' | 'gonderildi' | 'gonderilmedi';
export type TarihFiltre = 'tümü' | 'bu_ay' | 'son_3ay' | 'bu_yil';
export type AmountDirection = 'income' | 'expense' | 'neutral';

export interface UnicontaKimlik {
  companyId: string;
  username: string;
  password: string;
  env: 'production';
  sendEmailOnFinalize?: boolean;
  sendXmlOnFinalize?: boolean;
}

export interface UnicontaConnectionDraft extends UnicontaKimlik {}

export interface UnicontaConfigResponse {
  companyId: string;
  username: string;
  env: 'production';
  apiUrl: string;
  connectionStatus: BaglantiDurumu;
  configured: boolean;
  passwordConfigured: boolean;
  apiKeyConfigured: boolean;
  lastRefreshedAt?: string | null;
  message?: string | null;
  sendEmailOnFinalize: boolean;
  sendXmlOnFinalize: boolean;
}

export interface UnicontaSyncSummary {
  period_hours: number;
  total: number;
  synced: number;
  failed: number;
  skipped: number;
  pending: number;
  by_error_category: Record<string, number>;
  last_synced_at?: string | null;
  last_failure_at?: string | null;
}

export interface UnicontaFailedSyncRow {
  sequence_no: number;
  document_number?: string | null;
  issued_at?: string | null;
  customer_name?: string | null;
  gross_amount_dkk?: string | null;
  uniconta_sync_status?: string | null;
  uniconta_sync_error?: string | null;
  uniconta_synced_at?: string | null;
}

export interface UnicontaBulkRetry {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped_locked?: number;
  results: Array<{
    sequence_no: number;
    ok: boolean;
    message?: string | null;
    uniconta_sync_status?: string | null;
    uniconta_invoice_number?: string | null;
  }>;
}

export interface UnicontaHealth {
  configured: boolean;
  has_token: boolean;
  access_expires_at?: string | null;
  refresh_expires_at?: string | null;
  last_call_at?: string | null;
  last_call_ok?: boolean | null;
  minutes_to_expiry?: number | null;
}

export interface UnicontaConnectResponse {
  connectionStatus: BaglantiDurumu;
  configured: boolean;
  message: string;
  config: UnicontaConfigResponse;
}

export interface UnicontaInvoicesResponse {
  source: string;
  generatedAt: string;
  invoices: Fatura[];
  skip?: number;
  limit?: number;
  hasMore?: boolean;
  truncated?: boolean;
}

export interface FaturaKalem {
  id: string;
  beskrivelse: string;
  antal: number;
  enhedspris: number;
  rabat: number;
  moms: number;
  liniepris: number;
}

export interface Fatura {
  id: string;
  fakturanummer: string;
  ordrenummer?: string;
  type: FaturaTipi;
  fakturadato: string;
  konto: string;
  mailSendt?: string;
  eFakturaSendt?: string;
  kunde: {
    id: string;
    navn: string;
    email?: string;
    telefon?: string;
    adresse?: string;
    postnr?: string;
    cvr?: string;
  };
  kalemler: FaturaKalem[];
  subtotal: number;
  momsTotal: number;
  total: number;
  signedTotalAmount: number;
  amountDirection: AmountDirection;
  valuta: 'DKK' | 'EUR' | 'USD';
  note?: string;
  wooOrderId?: string;
  unicontaRef?: string;
}

export interface UseUnicontaMakeStateResult {
  config: UnicontaConfigResponse | null;
  kimlik: UnicontaKimlik;
  setKimlik: Dispatch<SetStateAction<UnicontaKimlik>>;
  ayarlarAcik: boolean;
  setAyarlarAcik: Dispatch<SetStateAction<boolean>>;
  secilenFatura: Fatura | null;
  setSecilenFatura: Dispatch<SetStateAction<Fatura | null>>;
  aramaQ: string;
  setAramaQ: Dispatch<SetStateAction<string>>;
  tipFiltre: FaturaTipi | 'Tümü';
  setTipFiltre: Dispatch<SetStateAction<FaturaTipi | 'Tümü'>>;
  mailFiltre: MailFiltre;
  setMailFiltre: Dispatch<SetStateAction<MailFiltre>>;
  eFaturaFiltre: MailFiltre;
  setEFaturaFiltre: Dispatch<SetStateAction<MailFiltre>>;
  tarihFiltre: TarihFiltre;
  setTarihFiltre: Dispatch<SetStateAction<TarihFiltre>>;
  sortKey: SortKey;
  sortDir: SortDir;
  filtrePanelAcik: boolean;
  setFiltrePanelAcik: Dispatch<SetStateAction<boolean>>;
  faturalar: Fatura[];
  filtrelenmis: Fatura[];
  invoicesLoading: boolean;
  invoicesError: string | null;
  invoicesTruncated: boolean;
  baglantiDurumu: BaglantiDurumu;
  yukleniyor: boolean;
  sonYenileme: Date | null;
  stats: {
    toplam: number;
    toplamKredit: number;
    mailGonderildi: number;
    eFakturaGonderildi: number;
  };
  activeFilters: number;
  baglan: (draft?: UnicontaConnectionDraft) => void;
  yenile: () => void;
  sort: (key: SortKey) => void;
  // Yeni (U7-U11)
  syncSummary: UnicontaSyncSummary | null;
  syncSummaryLoading: boolean;
  failedSyncs: UnicontaFailedSyncRow[];
  failedSyncsLoading: boolean;
  pendingSyncCount: number;
  onRetryAll: () => void;
  retryingAll: boolean;
  lastBulkRetryResult: UnicontaBulkRetry | null;
  health: UnicontaHealth | null;
  healthLoading: boolean;
  onRetryFailed: (sequenceNo: number) => void;
  retryingSingleSeq: number | null;
}
import type { Dispatch, SetStateAction } from 'react';
