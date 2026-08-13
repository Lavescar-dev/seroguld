import { describe, expect, it } from 'vitest';

import type { DashboardEndpointBundle, DashboardOverviewContract } from '../types';
import { mapDashboardFallback, mapDashboardOverview } from '../useDashboardMakeState';

const bundle: DashboardEndpointBundle = {
  legacy: {
    alisSayisi: 3,
    alisToplamKr: 4500,
    sonAlislar: [{ id: '1', afregningsnr: 'AFG-1', dato: '2026-08-13T08:00:00Z', musteri: 'Recai', total: 1500 }],
    aylikAlis: [],
    musteriSayisi: 7,
    sonMusteriler: [],
    depoToplamItem: 12,
    depoSpotDeger: 9000,
    depoAlisDeger: 7000,
    depoByCat: [],
    wooHazir: 4,
    wooFoto: 2,
    wooLisitlendi: 6,
    logSayisi: 3,
    ayirmaSayisi: 1,
    eritmeSayisi: 0,
    eritmeToplamHasAltin: 0,
    eritmeToplamPayout: 0,
    goldPrice: 615.5,
    silverPrice: 7.8,
    platinPrice: 280,
    palladyumPrice: 335,
    opmcYuksek: 0,
    opmcOrta: 0,
    opmcDusuk: 0,
    opmcBelirsiz: 0,
    opmcManuel: 2,
    faturaAdedi: 1,
    faturaToplamKr: 1500,
  },
  summary: { total_products: 12, locked_products: 0, free_products: 12, for_sale_products: 6, sold_this_month: 1, melted_this_month: 0 },
  stock: { total_stock_value_dkk: '9000', today_change_dkk: '200' },
  ops: { active_products: 12, products_with_photo: 10, products_without_photo: 2, photo_coverage_percent: '83.3', for_sale_without_photo: 2, needs_cleaning_queue: 0, pending_ai_description: 0, pending_ai_approval: 0, pending_publish: 4, stale_gdpr_lock: 0, ready_for_sale: 6, avg_active_age_days: '3', urgent_action_count: 6 },
  charts: { stock_flow_30d: [{ day: '2026-08-13', stock_value_dkk: '9000', purchases_dkk: '1500', removals_dkk: '0', net_change_dkk: '1500' }], monthly_profit_12m: [] },
  integrations: { openai_configured: true, woocommerce_configured: true, wordpress_media_configured: true, webhook_secret_set: true, total_published_products: 466, sync_success_24h: 1, sync_failed_24h: 0, last_sync_at: '2026-08-13T08:00:00Z', backup_latest_at: '2026-08-13T08:00:00Z', backup_recent_ok: true, backup_age_minutes: 5, offsite_enabled: false, offsite_last_sync_at: null, offsite_recent_ok: null, offsite_age_minutes: null, restore_drill_last_at: null, restore_drill_recent_ok: false, restore_drill_age_hours: null },
  market: { eur_dkk_fx: '7.45', gold_24k_dkk: '615.5', silver_dkk: '7.8', platinum_dkk: '280', palladium_dkk: '335', live_enabled: true, source: 'live', confirmed_today: true },
};

describe('dashboard legacy adapter', () => {
  it('builds the modern management model without changing the classic payload', () => {
    const result = mapDashboardFallback(bundle);

    expect(result.market.rates).toHaveLength(5);
    expect(result.market.confirmedToday).toBe(true);
    expect(result.kpis.map((item) => item.id)).toEqual(['purchase', 'stock', 'customers', 'operations']);
    expect(result.inbox.find((item) => item.id === 'risk')?.count).toBe(2);
    expect(result.health.find((item) => item.id === 'woocommerce')?.statusLabel).toBe('Bağlı');
    expect(result.trend['30d'][0]?.primary).toBe(1500);
    expect(bundle.legacy.alisSayisi).toBe(3);
  });

  it('maps the exact overview contract without presenting missing profit as revenue', () => {
    const overview: DashboardOverviewContract = {
      generatedAt: '2026-08-13T08:00:00Z',
      timezone: 'Europe/Copenhagen',
      periods: [{ period: '30d', startsAt: '2026-07-15T00:00:00Z', endsAtExclusive: '2026-08-14T00:00:00Z', purchaseCount: 3, purchaseNetDkk: '3600', purchaseVatDkk: '900', purchaseGrossDkk: '4500', newActiveCustomerCount: 2 }],
      activeCustomerCount: 7,
      inventory: { activeItemCount: 12, totalPurchaseValueDkk: '7000', totalSpotValueDkk: '9000', totalPureMetalGrams: '15', totalFineSilverGrams: '5', totalGoldRelatedGrams: '10' },
      wooCatalogTasks: { activeCatalogItemCount: 466, inactiveCatalogItemCount: 1, manualReviewCount: 2, photoMissingCount: 4, unlinkedCount: 6, catalogRevision: 3, remotePublishedCount: 466, lastSyncedAt: '2026-08-13T07:30:00Z' },
      unicontaQueue: { pendingCount: 1, failedCount: 2, skippedCount: 0, syncedCount: 5, historicalCount: 0, lastSyncedAt: '2026-08-13T07:00:00Z', lastFailureAt: '2026-08-13T07:15:00Z' },
      backupHealth: { latestLocalBackupAt: '2026-08-13T07:55:00Z', localBackupAgeMinutes: 5, localBackupRecent: true, offsiteEnabled: false, lastOffsiteSyncAt: null, offsiteAgeMinutes: null, offsiteRecent: null, lastRestoreDrillAt: null, restoreDrillAgeHours: null, restoreDrillRecent: false },
      marketRateConfirmation: { businessDate: '2026-08-13', timezone: 'Europe/Copenhagen', recorded: true, confirmed: true, confirmationMode: 'unchanged', confirmedAt: '2026-08-13T07:45:00Z', confirmedByUserId: 'user-1', confirmedRates: { goldDkk: '615.5', silverDkk: '7.8', platinumDkk: '280', palladiumDkk: '335' }, currentRates: { goldDkk: '615.5', silverDkk: '7.8', platinumDkk: '280', palladiumDkk: '335' }, matchesCurrentRates: true },
      financialCoverage: { companyRevenueDkk: null, companyProfitDkk: null, complete: false, reason: 'local_purchase_costs_only_remote_uniconta_financials_excluded' },
    };

    const result = mapDashboardOverview(overview, bundle.legacy, bundle.market, bundle.charts);

    expect(result.market.confirmedToday).toBe(true);
    expect(result.market.rates.find((item) => item.key === 'eur_dkk')?.value).toBe(7.45);
    expect(result.kpis[0]).toMatchObject({ id: 'purchase', label: '30 günlük alış' });
    expect(result.kpis.some((item) => item.label.toLocaleLowerCase().includes('kâr'))).toBe(false);
    expect(result.inbox.find((item) => item.id === 'uniconta')?.count).toBe(3);
    expect(result.health.find((item) => item.id === 'backup')?.tone).toBe('success');
  });
});
