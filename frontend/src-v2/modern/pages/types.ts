import type { ReactNode } from 'react';

import type {
  GdprJob,
  GdprOverview,
  GdprProcessor,
  GdprPublicBridgeConfig,
  GdprPublicCookieConfig,
  GdprPublicRequestCreateOut,
  GdprPublicRequestStatus,
  GdprPublicSiteConfig,
  GdprRequestDetail,
  GdprRequestListItem,
  GdprRetentionPolicy,
} from '@/make/gdpr/types';
import type {
  BaglantiDurumu,
  Fatura,
  FaturaTipi,
  MailFiltre,
  SortDir,
  SortKey,
  TarihFiltre,
  UnicontaConfigResponse,
  UnicontaConnectionDraft,
  UnicontaFailedSyncRow,
  UnicontaHealth,
  UnicontaSyncSummary,
} from '@/make/uniconta/types';
import type {
  AntiFraudOrder,
  AntiFraudOrdersResponse,
  AntiFraudSummary,
  PosDisplaySnapshot,
  ProductOut,
  ReportSummary,
} from '@/types';

import type { ModernTone } from '@/modern/design-system';

export type ModernAvailabilityState = 'available' | 'readonly' | 'unavailable';

export interface ModernAvailability {
  state: ModernAvailabilityState;
  title?: string;
  description?: string;
}

export interface ModernStatusItem {
  label: string;
  value: string;
  tone?: ModernTone;
  detail?: string;
}

export interface ModernInboxItem {
  id: string;
  title: string;
  summary: string;
  meta: string;
  tone?: ModernTone;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ModernHealthRelation {
  id: string;
  source: string;
  target: string;
  status: string;
  detail: string;
  tone?: ModernTone;
}

export interface ModernTimelineItem {
  id: string;
  title: string;
  detail?: string;
  timestamp?: string;
  tone?: ModernTone;
}

export interface ModernSalesDiscoveryFinding {
  id: string;
  title: string;
  note: string;
  status: string;
  tone?: ModernTone;
}

export interface ModernActionItem {
  label: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'ghost';
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}

export interface ModernLoginFormModel {
  email: string;
  password: string;
  remember?: boolean;
  isSubmitting: boolean;
  errorMessage?: string | null;
  credentialWarning?: string | null;
  onPasswordChange: (value: string) => void;
  onRememberChange?: (value: boolean) => void;
  onSubmit: () => void;
}

export interface ModernLoginPageProps {
  runtime: ModernStatusItem[];
  form: ModernLoginFormModel;
}

export interface ModernReportCard {
  id: string;
  label: string;
  summary: ReportSummary;
  availability?: ModernAvailability;
  onExport?: () => void;
}

export interface ModernReportsHealthPageProps {
  reports: ModernReportCard[];
  health: ModernHealthRelation[];
  salesDiscovery: {
    availability: ModernAvailability;
    summary: string;
    findings: ModernSalesDiscoveryFinding[];
    lastReviewed?: string;
  };
}

export interface ModernWooListItem {
  id: string;
  title: string;
  sku?: string;
  status: string;
  metal: string;
  weightLabel: string;
  priceLabel: string;
  publishState: string;
  tone?: ModernTone;
}

export interface ModernWooPageProps {
  availability: ModernAvailability;
  items: ModernWooListItem[];
  selectedProduct?: ProductOut | null;
  readiness: ModernStatusItem[];
  syncTimeline?: ModernTimelineItem[];
  isLoading?: boolean;
  onSelectProduct?: (productId: string) => void;
  onSync?: () => void;
}

export interface ModernOpmcListPageProps {
  source?: string | null;
  generatedAt?: string | null;
  summary: AntiFraudSummary;
  items: AntiFraudOrdersResponse['items'];
  availability?: ModernAvailability;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export interface ModernOpmcDetailPageProps {
  requestedId: string;
  detail: AntiFraudOrder | null;
  isLoading?: boolean;
  refreshAvailability?: ModernAvailability;
  onRefresh?: () => void;
  overrideAvailability?: ModernAvailability;
  onOverride?: (level: 'low' | 'medium' | 'high', reason?: string) => void;
}

export interface ModernGdprCockpitPageProps {
  overview: GdprOverview | null;
  requests: GdprRequestListItem[];
  jobs: GdprJob[];
  processors: GdprProcessor[];
  retentionPolicies: GdprRetentionPolicy[];
  selectedRequest?: GdprRequestDetail | null;
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onSelectRequest?: (requestId: string) => void;
}

export interface ModernGdprPublicPrivacyPageProps {
  site: GdprPublicSiteConfig;
  bridge?: GdprPublicBridgeConfig | null;
}

export interface ModernGdprPublicCookiesPageProps {
  site: GdprPublicSiteConfig;
  cookies: GdprPublicCookieConfig;
}

export interface ModernGdprPublicRequestPageProps {
  site: GdprPublicSiteConfig;
  availability: ModernAvailability;
  latestCreatedRequest?: GdprPublicRequestCreateOut | null;
  helperNote?: string;
}

export interface ModernGdprPublicStatusPageProps {
  site: GdprPublicSiteConfig;
  status: GdprPublicRequestStatus | null;
}

export interface ModernUnicontaPageProps {
  connectionStatus: BaglantiDurumu;
  config: UnicontaConfigResponse | null;
  connectionDraft?: UnicontaConnectionDraft;
  connectionSettingsOpen?: boolean;
  loading?: boolean;
  invoices: Fatura[];
  invoicesLoading?: boolean;
  invoicesError?: string | null;
  invoicesTruncated?: boolean;
  syncSummary: UnicontaSyncSummary | null;
  failedSyncs: UnicontaFailedSyncRow[];
  health: UnicontaHealth | null;
  selectedInvoice?: Fatura | null;
  stats?: {
    toplam: number;
    toplamKredit: number;
    mailGonderildi: number;
    eFakturaGonderildi: number;
  };
  connectionInfo?: {
    companyId?: string;
    env?: string;
    sendEmailOnFinalize?: boolean;
    sendXmlOnFinalize?: boolean;
  };
  connectAvailability?: ModernAvailability;
  retryAvailability?: ModernAvailability;
  onConnect?: (draft: UnicontaConnectionDraft) => void;
  onOpenConnectionSettings?: () => void;
  onCloseConnectionSettings?: () => void;
  onSearchChange?: (value: string) => void;
  searchValue?: string;
  typeFilter?: FaturaTipi | 'Tümü';
  onTypeFilterChange?: (value: FaturaTipi | 'Tümü') => void;
  mailFilter?: MailFiltre;
  onMailFilterChange?: (value: MailFiltre) => void;
  eFaturaFilter?: MailFiltre;
  onEFaturaFilterChange?: (value: MailFiltre) => void;
  dateFilter?: TarihFiltre;
  onDateFilterChange?: (value: TarihFiltre) => void;
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSort?: (key: SortKey) => void;
  onRefresh?: () => void;
  onSelectInvoice?: (invoice: Fatura) => void;
  onRetryAll?: () => void;
  onRetryFailed?: (sequenceNo: number) => void;
  retryingSingleSeq?: number | null;
}

export interface ModernCustomerDisplayControlPageProps {
  status: {
    connection: 'connecting' | 'live' | 'offline';
    windowState: 'open' | 'closed' | 'blocked';
    token?: string | null;
    lastHeartbeat?: string | null;
    lastPreviewAt?: string | null;
  };
  snapshot: PosDisplaySnapshot | null;
  runtime: ModernStatusItem[];
  previewAvailability?: ModernAvailability;
  onOpenWindow?: () => void;
  onPreview?: () => void;
  onRevoke?: () => void;
}
