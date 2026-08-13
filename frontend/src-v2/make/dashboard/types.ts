export type DashboardPeriod = '7d' | '30d' | '90d' | '12m';

export interface DashboardLegacyScreen {
  alisSayisi: number;
  alisToplamKr: number;
  sonAlislar: Array<{
    id: string;
    afregningsnr: string;
    dato: string;
    musteri: string;
    total: number;
    paymentMethod?: string;
  }>;
  aylikAlis: Array<{ ay: string; adet: number; kr: number }>;
  musteriSayisi: number;
  sonMusteriler: Array<{ id: string; navn: string; kayitTarihi: string }>;
  depoToplamItem: number;
  depoSpotDeger: number;
  depoAlisDeger: number;
  depoByCat: Array<{ name: string; gram: number; spot: number; color: string }>;
  wooHazir: number;
  wooFoto: number;
  wooLisitlendi: number;
  logSayisi: number;
  ayirmaSayisi: number;
  eritmeSayisi: number;
  eritmeToplamHasAltin: number;
  eritmeToplamPayout: number;
  goldPrice: number;
  silverPrice: number;
  platinPrice: number;
  palladyumPrice: number;
  opmcYuksek: number;
  opmcOrta: number;
  opmcDusuk: number;
  opmcBelirsiz: number;
  opmcManuel: number;
  faturaAdedi: number;
  faturaToplamKr: number;
}

export interface DashboardSummaryContract {
  total_products: number;
  locked_products: number;
  free_products: number;
  for_sale_products: number;
  sold_this_month: number;
  melted_this_month: number;
}

export interface DashboardStockValueContract {
  total_stock_value_dkk: string;
  today_change_dkk: string;
}

export interface DashboardOpsContract {
  active_products: number;
  products_with_photo: number;
  products_without_photo: number;
  photo_coverage_percent: string;
  for_sale_without_photo: number;
  needs_cleaning_queue: number;
  pending_ai_description: number;
  pending_ai_approval: number;
  pending_publish: number;
  stale_gdpr_lock: number;
  ready_for_sale: number;
  avg_active_age_days: string;
  urgent_action_count: number;
}

export interface DashboardChartsContract {
  stock_flow_30d: Array<{
    day: string;
    stock_value_dkk: string;
    purchases_dkk: string;
    removals_dkk: string;
    net_change_dkk: string;
  }>;
  monthly_profit_12m: Array<{
    month: string;
    profit_dkk: string;
    sold_count: number;
  }>;
}

export interface DashboardIntegrationsContract {
  openai_configured: boolean;
  woocommerce_configured: boolean;
  wordpress_media_configured: boolean;
  webhook_secret_set: boolean;
  total_published_products: number;
  sync_success_24h: number;
  sync_failed_24h: number;
  last_sync_at: string | null;
  backup_latest_at: string | null;
  backup_recent_ok: boolean;
  backup_age_minutes: number | null;
  offsite_enabled: boolean;
  offsite_last_sync_at: string | null;
  offsite_recent_ok: boolean | null;
  offsite_age_minutes: number | null;
  restore_drill_last_at: string | null;
  restore_drill_recent_ok: boolean;
  restore_drill_age_hours: number | null;
}

export interface DashboardMarketProfileContract {
  eur_dkk_fx: string;
  gold_24k_dkk: string;
  silver_dkk: string;
  platinum_dkk: string;
  palladium_dkk: string;
  live_enabled: boolean;
  source: string;
  updated_at?: string | null;
  last_updated_at?: string | null;
  confirmed_for_date?: string | null;
  confirmed_today?: boolean;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  confirmed_by_name?: string | null;
}

export interface DashboardEndpointBundle {
  legacy: DashboardLegacyScreen;
  summary: DashboardSummaryContract;
  stock: DashboardStockValueContract;
  ops: DashboardOpsContract;
  charts: DashboardChartsContract;
  integrations: DashboardIntegrationsContract;
  market: DashboardMarketProfileContract;
}

export interface DashboardMarketRate {
  key: 'gold' | 'silver' | 'eur_dkk' | 'platinum' | 'palladium';
  label: string;
  value: number;
  unit: string;
}

export interface DashboardMarketViewModel {
  rates: DashboardMarketRate[];
  sourceLabel: string;
  lastUpdatedAt: string | null;
  confirmedToday: boolean;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}

export interface DashboardInboxRow {
  id: string;
  title: string;
  description: string;
  count: number;
  route: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}

export interface DashboardTrendPoint {
  key: string;
  label: string;
  primary: number;
  secondary: number;
}

export interface DashboardActivityRow {
  id: string;
  title: string;
  description: string;
  occurredAt: string;
  route: string;
  kind: 'purchase' | 'customer';
}

export interface DashboardHealthCard {
  id: 'backup' | 'woocommerce' | 'wordpress' | 'uniconta' | 'market';
  label: string;
  statusLabel: string;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  updatedAt: string | null;
  route: string;
}

export interface ModernDashboardViewModel {
  market: DashboardMarketViewModel;
  kpis: DashboardKpi[];
  inbox: DashboardInboxRow[];
  trend: Record<DashboardPeriod, DashboardTrendPoint[]>;
  activities: DashboardActivityRow[];
  health: DashboardHealthCard[];
}

export interface DashboardOverviewContract {
  generatedAt: string;
  timezone: string;
  periods: Array<{
    period: DashboardPeriod;
    startsAt: string;
    endsAtExclusive: string;
    purchaseCount: number;
    purchaseNetDkk: string;
    purchaseVatDkk: string;
    purchaseGrossDkk: string;
    newActiveCustomerCount: number;
  }>;
  activeCustomerCount: number;
  inventory: {
    activeItemCount: number;
    totalPurchaseValueDkk: string;
    totalSpotValueDkk: string;
    totalPureMetalGrams: string;
    totalFineSilverGrams: string;
    totalGoldRelatedGrams: string;
  };
  wooCatalogTasks: {
    activeCatalogItemCount: number;
    inactiveCatalogItemCount: number;
    manualReviewCount: number;
    photoMissingCount: number;
    unlinkedCount: number;
    catalogRevision: number;
    remotePublishedCount: number;
    lastSyncedAt: string | null;
  };
  unicontaQueue: {
    pendingCount: number;
    failedCount: number;
    skippedCount: number;
    syncedCount: number;
    historicalCount: number;
    lastSyncedAt: string | null;
    lastFailureAt: string | null;
  };
  backupHealth: {
    latestLocalBackupAt: string | null;
    localBackupAgeMinutes: number | null;
    localBackupRecent: boolean;
    offsiteEnabled: boolean;
    lastOffsiteSyncAt: string | null;
    offsiteAgeMinutes: number | null;
    offsiteRecent: boolean | null;
    lastRestoreDrillAt: string | null;
    restoreDrillAgeHours: number | null;
    restoreDrillRecent: boolean;
  };
  marketRateConfirmation: DashboardMarketConfirmationResponse;
  financialCoverage: {
    companyRevenueDkk: string | null;
    companyProfitDkk: string | null;
    complete: boolean;
    reason: string;
  };
}

export interface DashboardMarketConfirmationResponse {
  businessDate: string;
  timezone: string;
  recorded: boolean;
  confirmed: boolean;
  confirmationMode: 'saved' | 'unchanged' | null;
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  confirmedRates: {
    goldDkk: string;
    silverDkk: string;
    platinumDkk: string;
    palladiumDkk: string;
  } | null;
  currentRates: {
    goldDkk: string;
    silverDkk: string;
    platinumDkk: string;
    palladiumDkk: string;
  };
  matchesCurrentRates: boolean | null;
}
