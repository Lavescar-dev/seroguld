import type { ReactNode } from 'react';

import type { ApiConfig } from '@/make/settings/types';
import type { DashboardData } from '@/make/dashboard/useDashboardMakeState';
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
  UnicontaConfigResponse,
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
  remember: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
  onRememberChange?: (value: boolean) => void;
  onSubmit?: () => void;
}

export interface ModernLoginPageProps {
  runtime: ModernStatusItem[];
  form: ModernLoginFormModel;
  workInboxPreview?: ModernInboxItem[];
  helperNote?: string;
}

export interface ModernDashboardPageProps {
  summary: DashboardData;
  workInbox: ModernInboxItem[];
  relationHealth: ModernHealthRelation[];
  timeline?: ModernTimelineItem[];
  onNavigate?: (path: string) => void;
  refreshLabel?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export interface ModernSettingsPageProps {
  config: ApiConfig;
  runtime: ModernStatusItem[];
  secretFieldKeys?: Array<keyof ApiConfig>;
  uiVariantSlot?: ReactNode;
  onFieldChange?: (key: keyof ApiConfig, value: string) => void;
  onSave?: () => void;
  onImport?: () => void;
  onExport?: () => void;
  saveAvailability?: ModernAvailability;
  isSaving?: boolean;
  savedLabel?: string;
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
  invoices: Fatura[];
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
  onConnect?: () => void;
  onRefresh?: () => void;
  onSelectInvoice?: (invoice: Fatura) => void;
  onRetryAll?: () => void;
  onRetryFailed?: (sequenceNo: number) => void;
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
