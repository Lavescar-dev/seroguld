import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { ApiError, apiRequest } from '@/lib/api';
import { getDesktopStartupState } from '@/lib/desktop';
import { useToast } from '@/lib/toast';

import type {
  DashboardEndpointBundle,
  DashboardLegacyScreen,
  DashboardMarketConfirmationResponse,
  DashboardOverviewContract,
  DashboardPeriod,
  DashboardTrendPoint,
  ModernDashboardViewModel,
} from './types';

export type DashboardData = DashboardLegacyScreen;

const EMPTY_DASHBOARD_DATA: DashboardLegacyScreen = {
  alisSayisi: 0,
  alisToplamKr: 0,
  sonAlislar: [],
  aylikAlis: [],
  musteriSayisi: 0,
  sonMusteriler: [],
  depoToplamItem: 0,
  depoSpotDeger: 0,
  depoAlisDeger: 0,
  depoByCat: [],
  wooHazir: 0,
  wooFoto: 0,
  wooLisitlendi: 0,
  logSayisi: 0,
  ayirmaSayisi: 0,
  eritmeSayisi: 0,
  eritmeToplamHasAltin: 0,
  eritmeToplamPayout: 0,
  goldPrice: 0,
  silverPrice: 0,
  platinPrice: 0,
  palladyumPrice: 0,
  opmcYuksek: 0,
  opmcOrta: 0,
  opmcDusuk: 0,
  opmcBelirsiz: 0,
  opmcManuel: 0,
  faturaAdedi: 0,
  faturaToplamKr: 0,
};

export const dashboardQueryKeys = {
  root: ['dashboard-management'] as const,
  overview: (period: DashboardPeriod) => ['dashboard-management', 'overview', period] as const,
};

const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  '7d': '7 günlük',
  '30d': '30 günlük',
  '90d': '90 günlük',
  '12m': '12 aylık',
};

function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return `${new Intl.NumberFormat(document.documentElement.lang || 'tr-TR', {
    maximumFractionDigits: 0,
  }).format(value)} DKK`;
}

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function sliceTrend(points: DashboardTrendPoint[], period: DashboardPeriod) {
  if (period === '7d') return points.slice(-7);
  if (period === '30d') return points.slice(-30);
  if (period === '90d') return points.slice(-90);
  return points.slice(-12);
}

function modernActivities(legacy: DashboardLegacyScreen): ModernDashboardViewModel['activities'] {
  return [
    ...legacy.sonAlislar.map((item) => ({ id: `purchase-${item.id}`, title: `${item.afregningsnr} · ${item.musteri}`, description: `${money(item.total)} · ${item.paymentMethod || 'Ödeme yöntemi belirtilmedi'}`, occurredAt: item.dato, route: '/log', kind: 'purchase' as const })),
    ...legacy.sonMusteriler.map((item) => ({ id: `customer-${item.id}`, title: item.navn, description: 'Müşteri kaydı oluşturuldu', occurredAt: item.kayitTarihi, route: '/musteriler', kind: 'customer' as const })),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 8);
}

function chartTrends(charts: DashboardEndpointBundle['charts'], legacy: DashboardLegacyScreen): ModernDashboardViewModel['trend'] {
  const dailyTrend: DashboardTrendPoint[] = charts.stock_flow_30d.map((point) => ({
    key: point.day,
    label: new Date(`${point.day}T12:00:00`).toLocaleDateString(document.documentElement.lang || 'tr-TR', { day: '2-digit', month: 'short' }),
    primary: numberValue(point.purchases_dkk),
    secondary: numberValue(point.removals_dkk),
  }));
  const monthlyTrend: DashboardTrendPoint[] = charts.monthly_profit_12m.map((point) => ({
    key: point.month,
    label: point.month,
    primary: numberValue(point.profit_dkk),
    secondary: point.sold_count,
  }));
  return {
    '7d': sliceTrend(dailyTrend, '7d'),
    '30d': dailyTrend,
    '90d': [],
    '12m': monthlyTrend.length > 0 ? monthlyTrend : legacy.aylikAlis.map((point) => ({ key: point.ay, label: point.ay, primary: point.kr, secondary: point.adet })),
  };
}

export function mapDashboardOverview(
  payload: DashboardOverviewContract,
  legacy: DashboardLegacyScreen,
  marketProfile: DashboardEndpointBundle['market'],
  charts: DashboardEndpointBundle['charts'],
  selectedPeriod: DashboardPeriod = '30d',
): ModernDashboardViewModel {
  const confirmation = payload.marketRateConfirmation;
  const market = confirmation.currentRates;
  const currentPeriod = payload.periods.find((item) => item.period === selectedPeriod) ?? payload.periods[0];
  const periodLabel = PERIOD_LABELS[selectedPeriod];
  const wooActionCount = payload.wooCatalogTasks.manualReviewCount + payload.wooCatalogTasks.photoMissingCount + payload.wooCatalogTasks.unlinkedCount;
  const unicontaActionCount = payload.unicontaQueue.pendingCount + payload.unicontaQueue.failedCount;
  return {
    market: {
      rates: [
        { key: 'gold', label: 'Altın 24K', value: numberValue(market.goldDkk), unit: 'DKK/g' },
        { key: 'silver', label: 'Gümüş Ag 999', value: numberValue(market.silverDkk), unit: 'DKK/g' },
        { key: 'eur_dkk', label: 'EUR / DKK', value: numberValue(marketProfile.eur_dkk_fx), unit: 'kur' },
        { key: 'platinum', label: 'Platin', value: numberValue(market.platinumDkk), unit: 'DKK/g' },
        { key: 'palladium', label: 'Palladyum', value: numberValue(market.palladiumDkk), unit: 'DKK/g' },
      ],
      sourceLabel: marketProfile.source === 'manual' ? 'Manuel oran profili' : 'Yerel oran profili',
      lastUpdatedAt: marketProfile.updated_at ?? marketProfile.last_updated_at ?? payload.generatedAt,
      confirmedToday: confirmation.confirmed,
      confirmedAt: confirmation.confirmedAt,
      confirmedByName: null,
    },
    kpis: [
      { id: 'purchase', label: `${periodLabel} alış`, value: money(numberValue(currentPeriod?.purchaseGrossDkk)), detail: `${currentPeriod?.purchaseCount ?? 0} AFG · KDV dahil`, tone: 'primary' },
      { id: 'stock', label: 'Stok spot değeri', value: money(numberValue(payload.inventory.totalSpotValueDkk)), detail: `${payload.inventory.activeItemCount} aktif ürün`, tone: 'success' },
      { id: 'customers', label: 'Aktif müşteri', value: String(payload.activeCustomerCount), detail: `${currentPeriod?.newActiveCustomerCount ?? 0} yeni müşteri / ${periodLabel}`, tone: 'info' },
      { id: 'operations', label: 'Aksiyon bekleyen', value: String(wooActionCount + unicontaActionCount), detail: `${wooActionCount} Woo · ${unicontaActionCount} Uniconta`, tone: wooActionCount + unicontaActionCount ? 'warning' : 'success' },
    ],
    inbox: [
      { id: 'woo-review', title: 'Woo manuel inceleme', description: 'Katalog eşleştirmesi veya veri kontrolü bekleyenler', count: payload.wooCatalogTasks.manualReviewCount, route: '/woocommerce', tone: payload.wooCatalogTasks.manualReviewCount ? 'warning' : 'success' },
      { id: 'woo-photo', title: 'Woo fotoğraf eksikleri', description: 'Yayın öncesi görseli tamamlanacak katalog kayıtları', count: payload.wooCatalogTasks.photoMissingCount, route: '/woocommerce', tone: payload.wooCatalogTasks.photoMissingCount ? 'warning' : 'success' },
      { id: 'woo-link', title: 'CRM bağlantısı eksik', description: 'Yerel ürünle henüz eşleştirilmemiş Woo kayıtları', count: payload.wooCatalogTasks.unlinkedCount, route: '/woocommerce', tone: payload.wooCatalogTasks.unlinkedCount ? 'warning' : 'success' },
      { id: 'uniconta', title: 'Uniconta kuyruğu', description: `${payload.unicontaQueue.failedCount} hata · ${payload.unicontaQueue.pendingCount} bekleyen`, count: unicontaActionCount, route: '/uniconta', tone: payload.unicontaQueue.failedCount ? 'danger' : unicontaActionCount ? 'warning' : 'success' },
    ],
    trend: chartTrends(charts, legacy),
    activities: modernActivities(legacy),
    health: [
      { id: 'backup', label: 'Yerel yedek', statusLabel: payload.backupHealth.localBackupRecent ? 'Güncel' : 'Kontrol gerekli', description: payload.backupHealth.localBackupAgeMinutes == null ? 'Henüz yedek zamanı alınamadı' : `Son yedek ${payload.backupHealth.localBackupAgeMinutes} dakika önce`, tone: payload.backupHealth.localBackupRecent ? 'success' : 'danger', updatedAt: payload.backupHealth.latestLocalBackupAt, route: '/settings' },
      { id: 'woocommerce', label: 'Woo yerel katalog', statusLabel: payload.wooCatalogTasks.lastSyncedAt ? 'Senkronize' : 'Senkron bekliyor', description: `${payload.wooCatalogTasks.activeCatalogItemCount} aktif · revizyon ${payload.wooCatalogTasks.catalogRevision}`, tone: payload.wooCatalogTasks.lastSyncedAt ? (payload.wooCatalogTasks.manualReviewCount ? 'warning' : 'success') : 'warning', updatedAt: payload.wooCatalogTasks.lastSyncedAt, route: '/woocommerce' },
      { id: 'uniconta', label: 'Uniconta kuyruğu', statusLabel: payload.unicontaQueue.failedCount ? 'Hata var' : payload.unicontaQueue.pendingCount ? 'Bekliyor' : 'Temiz', description: `${payload.unicontaQueue.syncedCount} senkron · ${payload.unicontaQueue.failedCount} hata`, tone: payload.unicontaQueue.failedCount ? 'danger' : payload.unicontaQueue.pendingCount ? 'warning' : 'success', updatedAt: payload.unicontaQueue.lastSyncedAt, route: '/uniconta' },
      { id: 'market', label: 'Piyasa kontrolü', statusLabel: confirmation.confirmed ? 'Bugün onaylandı' : 'Onay bekliyor', description: confirmation.confirmed ? 'Güncel oran snapshot’ı doğrulandı' : 'Oranlar işleme başlamadan önce kontrol edilmeli', tone: confirmation.confirmed ? 'success' : 'warning', updatedAt: confirmation.confirmedAt, route: '/dashboard' },
    ],
  };
}

export function mapDashboardFallback(bundle: DashboardEndpointBundle): ModernDashboardViewModel {
  const { legacy, summary, stock, ops, charts, integrations, market } = bundle;
  const confirmationDate = market.confirmed_for_date;

  return {
    market: {
      rates: [
        { key: 'gold', label: 'Altın 24K', value: numberValue(market.gold_24k_dkk || legacy.goldPrice), unit: 'DKK/g' },
        { key: 'silver', label: 'Gümüş Ag 999', value: numberValue(market.silver_dkk || legacy.silverPrice), unit: 'DKK/g' },
        { key: 'eur_dkk', label: 'EUR / DKK', value: numberValue(market.eur_dkk_fx), unit: 'kur' },
        { key: 'platinum', label: 'Platin', value: numberValue(market.platinum_dkk || legacy.platinPrice), unit: 'DKK/g' },
        { key: 'palladium', label: 'Palladyum', value: numberValue(market.palladium_dkk || legacy.palladyumPrice), unit: 'DKK/g' },
      ],
      sourceLabel: market.source === 'manual' ? 'Manuel oran profili' : 'Yerel oran profili',
      lastUpdatedAt: market.updated_at ?? market.last_updated_at ?? null,
      confirmedToday: market.confirmed_today ?? confirmationDate === todayIso(),
      confirmedAt: market.confirmed_at ?? null,
      confirmedByName: market.confirmed_by ?? market.confirmed_by_name ?? null,
    },
    kpis: [
      { id: 'purchase', label: 'Toplam alış', value: money(legacy.alisToplamKr), detail: `${legacy.alisSayisi} AFG kaydı`, tone: 'primary' },
      { id: 'stock', label: 'Stok değeri', value: money(numberValue(stock.total_stock_value_dkk) || legacy.depoSpotDeger), detail: `${summary.for_sale_products} satışa hazır`, tone: 'success' },
      { id: 'customers', label: 'Aktif müşteri', value: String(legacy.musteriSayisi), detail: `${legacy.sonMusteriler.length} son hareket`, tone: 'info' },
      { id: 'operations', label: 'Aksiyon bekleyen', value: String(ops.urgent_action_count), detail: `${ops.pending_publish} yayın · ${legacy.opmcManuel} risk`, tone: ops.urgent_action_count ? 'warning' : 'success' },
    ],
    inbox: [
      { id: 'risk', title: 'Risk incelemesi', description: 'Manuel karar bekleyen OPMC kayıtları', count: legacy.opmcManuel, route: '/opmc', tone: legacy.opmcManuel ? 'danger' : 'success' },
      { id: 'publish', title: 'Yayın hazırlığı', description: 'WooCommerce yayını bekleyen ürünler', count: ops.pending_publish || legacy.wooHazir, route: '/woocommerce', tone: (ops.pending_publish || legacy.wooHazir) ? 'warning' : 'success' },
      { id: 'photo', title: 'Fotoğraf eksikleri', description: 'Satış öncesi görseli tamamlanacak ürünler', count: ops.products_without_photo || legacy.wooFoto, route: '/depolama', tone: (ops.products_without_photo || legacy.wooFoto) ? 'warning' : 'success' },
      { id: 'routing', title: 'AFG yönlendirme', description: 'Ayırma veya eritme kararı bekleyen satırlar', count: legacy.ayirmaSayisi, route: '/log', tone: legacy.ayirmaSayisi ? 'warning' : 'success' },
    ],
    trend: chartTrends(charts, legacy),
    activities: modernActivities(legacy),
    health: [
      { id: 'backup', label: 'Yerel yedek', statusLabel: integrations.backup_recent_ok ? 'Güncel' : 'Kontrol gerekli', description: integrations.backup_age_minutes == null ? 'Henüz yedek zamanı alınamadı' : `Son yedek ${integrations.backup_age_minutes} dakika önce`, tone: integrations.backup_recent_ok ? 'success' : 'danger', updatedAt: integrations.backup_latest_at, route: '/settings' },
      { id: 'woocommerce', label: 'WooCommerce', statusLabel: integrations.woocommerce_configured ? (integrations.sync_failed_24h ? 'Hata var' : 'Bağlı') : 'Yapılandırılmadı', description: `${integrations.total_published_products} yayındaki ürün · ${integrations.sync_success_24h} başarılı senkron`, tone: !integrations.woocommerce_configured ? 'warning' : integrations.sync_failed_24h ? 'danger' : 'success', updatedAt: integrations.last_sync_at, route: '/woocommerce' },
      { id: 'wordpress', label: 'WordPress medya', statusLabel: integrations.wordpress_media_configured ? 'Yapılandırıldı' : 'Eksik', description: integrations.webhook_secret_set ? 'Medya ve webhook ayarları hazır' : 'Webhook anahtarı kontrol edilmeli', tone: integrations.wordpress_media_configured && integrations.webhook_secret_set ? 'success' : 'warning', updatedAt: integrations.last_sync_at, route: '/woocommerce' },
      { id: 'uniconta', label: 'Uniconta', statusLabel: legacy.faturaAdedi >= 0 ? 'İzleniyor' : 'Kontrol gerekli', description: `${legacy.faturaAdedi} yerel fatura · ${money(legacy.faturaToplamKr)}`, tone: 'neutral', updatedAt: null, route: '/uniconta' },
    ],
  };
}

const FALLBACK_SUMMARY: DashboardEndpointBundle['summary'] = {
  total_products: 0, locked_products: 0, free_products: 0, for_sale_products: 0,
  sold_this_month: 0, melted_this_month: 0,
};
const FALLBACK_STOCK: DashboardEndpointBundle['stock'] = { total_stock_value_dkk: '0', today_change_dkk: '0' };
const FALLBACK_OPS: DashboardEndpointBundle['ops'] = {
  active_products: 0, products_with_photo: 0, products_without_photo: 0, photo_coverage_percent: '0',
  for_sale_without_photo: 0, needs_cleaning_queue: 0, pending_ai_description: 0, pending_ai_approval: 0,
  pending_publish: 0, stale_gdpr_lock: 0, ready_for_sale: 0, avg_active_age_days: '0', urgent_action_count: 0,
};
const FALLBACK_INTEGRATIONS: DashboardEndpointBundle['integrations'] = {
  openai_configured: false, woocommerce_configured: false, wordpress_media_configured: false,
  webhook_secret_set: false, total_published_products: 0, sync_success_24h: 0, sync_failed_24h: 0,
  last_sync_at: null, backup_latest_at: null, backup_recent_ok: false, backup_age_minutes: null,
  offsite_enabled: false, offsite_last_sync_at: null, offsite_recent_ok: null, offsite_age_minutes: null,
  restore_drill_last_at: null, restore_drill_recent_ok: false, restore_drill_age_hours: null,
};
const FALLBACK_MARKET: DashboardEndpointBundle['market'] = {
  eur_dkk_fx: '0', gold_24k_dkk: '0', silver_dkk: '0', platinum_dkk: '0', palladium_dkk: '0',
  live_enabled: false, source: 'manual', updated_at: null,
};

async function fetchFallbackBundle(): Promise<DashboardEndpointBundle> {
  // Tek uç noktanın 404/500'ü tüm panoyu boşaltmasın: legacy zorunlu, kalanı
  // yumuşak varsayılana düşer (allSettled). Legacy hatası olduğu gibi fırlatılır
  // ki ApiError.url + status sürüm tanısında görünsün.
  const [legacyResult, summary, stock, ops, charts, integrations, market] = await Promise.allSettled([
    apiRequest<DashboardLegacyScreen>('/api/v2/dashboard'),
    apiRequest<DashboardEndpointBundle['summary']>('/api/dashboard/summary'),
    apiRequest<DashboardEndpointBundle['stock']>('/api/dashboard/stock-value'),
    apiRequest<DashboardEndpointBundle['ops']>('/api/dashboard/ops'),
    apiRequest<DashboardEndpointBundle['charts']>('/api/dashboard/charts'),
    apiRequest<DashboardEndpointBundle['integrations']>('/api/dashboard/integrations'),
    apiRequest<DashboardEndpointBundle['market']>('/api/v2/market-rates/defaults'),
  ]);
  if (legacyResult.status === 'rejected') throw legacyResult.reason;
  return {
    legacy: legacyResult.value,
    summary: summary.status === 'fulfilled' ? summary.value : FALLBACK_SUMMARY,
    stock: stock.status === 'fulfilled' ? stock.value : FALLBACK_STOCK,
    ops: ops.status === 'fulfilled' ? ops.value : FALLBACK_OPS,
    charts: charts.status === 'fulfilled' ? charts.value : { stock_flow_30d: [], monthly_profit_12m: [] },
    integrations: integrations.status === 'fulfilled' ? integrations.value : FALLBACK_INTEGRATIONS,
    market: market.status === 'fulfilled' ? market.value : FALLBACK_MARKET,
  };
}

export async function fetchModernOverview(period: DashboardPeriod) {
  try {
    const overview = await apiRequest<DashboardOverviewContract>(`/api/v2/dashboard/overview?period=${period}`);
    const [legacyResult, marketResult, chartsResult] = await Promise.allSettled([
      apiRequest<DashboardLegacyScreen>('/api/v2/dashboard'),
      apiRequest<DashboardEndpointBundle['market']>('/api/v2/market-rates/defaults'),
      apiRequest<DashboardEndpointBundle['charts']>('/api/dashboard/charts'),
    ]);
    const legacy = legacyResult.status === 'fulfilled' ? legacyResult.value : EMPTY_DASHBOARD_DATA;
    const currentRates = overview.marketRateConfirmation.currentRates;
    const market: DashboardEndpointBundle['market'] = marketResult.status === 'fulfilled'
      ? marketResult.value
      : {
          eur_dkk_fx: '0',
          gold_24k_dkk: currentRates.goldDkk,
          silver_dkk: currentRates.silverDkk,
          platinum_dkk: currentRates.platinumDkk,
          palladium_dkk: currentRates.palladiumDkk,
          live_enabled: false,
          source: 'manual',
          updated_at: overview.generatedAt,
        };
    const charts: DashboardEndpointBundle['charts'] = chartsResult.status === 'fulfilled'
      ? chartsResult.value
      : { stock_flow_30d: [], monthly_profit_12m: [] };
    return { view: mapDashboardOverview(overview, legacy, market, charts, period), legacy };
  } catch (error) {
    if (!(error instanceof ApiError) || ![404, 405, 422].includes(error.status)) throw error;
    const bundle = await fetchFallbackBundle();
    return { view: mapDashboardFallback(bundle), legacy: bundle.legacy };
  }
}

// Pano hatasını tek biçimde kullanıcıya okunur satırlara dönüştürür: mesaj +
// (ApiError ise) uç nokta/status + (tanı varsa) sürüm uyuşmazlığı uyarısı.
// Hem modern hem classic yüzey aynı üreticiyi kullanır; hata yutulmaz.
function buildDashboardErrorParts(
  error: Error | null,
  diag: { appVersion: string | null; runtimeVersion: string | null } | undefined,
): string | null {
  if (!(error instanceof Error)) return null;
  const parts = [error.message];
  if (error instanceof ApiError && error.url) {
    parts.push(`Uç nokta: ${error.url} → HTTP ${error.status}.`);
  }
  if (diag?.appVersion && diag?.runtimeVersion && diag.appVersion !== diag.runtimeVersion) {
    parts.push(`Sürüm uyuşmazlığı: uygulama v${diag.appVersion}, çalışma zamanı v${diag.runtimeVersion} — runtime güncellenmemiş olabilir.`);
  }
  return parts.join(' ');
}

export function useDashboardMakeState(mode: 'classic' | 'modern' = 'modern') {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const dashboardQuery = useQuery({
    queryKey: dashboardQueryKeys.overview(period),
    queryFn: () => fetchModernOverview(period),
    enabled: mode === 'modern',
    refetchInterval: 60_000,
  });

  const legacyQuery = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: () => apiRequest<DashboardLegacyScreen>('/api/v2/dashboard'),
    enabled: mode === 'classic',
    refetchInterval: 60_000,
  });

  const activeQuery = mode === 'modern' ? dashboardQuery : legacyQuery;

  // Pano yüklenemediğinde uygulama/runtime sürümlerini karşılaştırıp
  // "eski runtime + yeni arayüz" kaymasını hatanın içinde görünür kılar.
  const versionDiagQuery = useQuery({
    queryKey: ['runtime-version-diagnostic'],
    enabled: Boolean(dashboardQuery.error || legacyQuery.error),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const [health, startup] = await Promise.allSettled([
        apiRequest<{ status: string; version?: string }>('/health', { auth: false }),
        getDesktopStartupState(),
      ]);
      return {
        runtimeVersion: health.status === 'fulfilled' ? health.value.version ?? null : null,
        appVersion: startup.status === 'fulfilled' ? startup.value?.app_version ?? null : null,
      };
    },
  });

  const confirmationMutation = useMutation({
    mutationFn: () => apiRequest<DashboardMarketConfirmationResponse>('/api/v2/dashboard/market-rate-confirmation', {
      method: 'POST',
      body: JSON.stringify({ mode: 'unchanged' }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.root });
      toast.success('Bugünün piyasa oranları değişmedi olarak onaylandı.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Piyasa onayı kaydedilemedi.'),
  });

  const data = dashboardQuery.data?.legacy ?? legacyQuery.data ?? EMPTY_DASHBOARD_DATA;

  const modernError = buildDashboardErrorParts(dashboardQuery.error ?? null, versionDiagQuery.data);
  // Classic yüzey hatası: legacyQuery.isError'ı yutmak yerine yüzeye çıkar.
  const classicError = buildDashboardErrorParts(legacyQuery.error ?? null, versionDiagQuery.data);
  // "Sunucudan hiç veri geldi mi?" ayrımı: ilk yükleme hatası (sıfır dolu sahte
  // pano yerine ayrı hata durumu) ile bayat-veri-yenilenemedi şeridini ayırır.
  const hasServerData = Boolean(dashboardQuery.data || legacyQuery.data);

  return useMemo(() => ({
    data,
    modern: dashboardQuery.data?.view ?? null,
    modernError,
    errorMessage: classicError,
    hasServerData,
    period,
    setPeriod,
    // Sahte saat yok: son yenileme, aktif sorgunun veri aldığı andır; veri hiç
    // gelmediyse null döner ve yüzey "—" gösterir.
    lastRefresh: activeQuery.dataUpdatedAt ? new Date(activeQuery.dataUpdatedAt) : null,
    isRefreshing: dashboardQuery.isFetching || legacyQuery.isFetching,
    isConfirmingMarket: confirmationMutation.isPending,
    onConfirmMarketUnchanged: () => confirmationMutation.mutate(),
    onOpenMarketRates: () => window.dispatchEvent(new CustomEvent('seroguld:open-market-rates')),
    onRefresh: () => {
      if (mode === 'modern') void dashboardQuery.refetch();
      if (mode === 'classic') void legacyQuery.refetch();
    },
    onNavigate: (path: string) => navigate(path),
  }), [
    activeQuery,
    classicError,
    confirmationMutation.isPending,
    dashboardQuery,
    data,
    hasServerData,
    legacyQuery,
    mode,
    modernError,
    navigate,
    period,
  ]);
}

export type DashboardMakeState = ReturnType<typeof useDashboardMakeState>;
