// M3 medium fixleri — classic pano yüzeyi.
//
// Kapsam:
// - Ödeme yöntemi etiketi: sabit 'Banka' / ham 'bank' enum'u değil,
//   labelPaymentMethod (nakit alışta doğru finansal bilgi)
// - Tek kategorili depo pasta grafiği görünür (SVG tam daire iki yarımyay)
// - Ölü satırlar: son alışlar → /log, son müşteriler → /musteriler
// - GDPR serbest bırakma kartı (backend /api/dashboard/calendar artık yüzeyli)
// - Modern modelde oran ucu düştüyse kaynağa dürüst etiket
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@testing-library/react';

import type { DashboardLegacyScreen, DashboardOverviewContract } from '../types';
import { MakeDashboardPage } from '../DashboardPage';
import { mapDashboardFallback, mapDashboardOverview } from '../useDashboardMakeState';

const BASE_SCREEN: DashboardLegacyScreen = {
  alisSayisi: 2,
  alisToplamKr: 3000,
  sonAlislar: [
    { id: '1', afregningsnr: 'AFG-1', dato: '2026-09-01T08:00:00Z', musteri: 'Recai', total: 1500, paymentMethod: 'cash' },
    { id: '2', afregningsnr: 'AFG-2', dato: '2026-09-02T08:00:00Z', musteri: 'Ada', total: 1500, paymentMethod: 'bank' },
    { id: '3', afregningsnr: 'AFG-3', dato: '2026-09-03T08:00:00Z', musteri: 'Efe', total: 1500 },
  ],
  aylikAlis: [],
  musteriSayisi: 1,
  sonMusteriler: [{ id: '9', navn: 'Ada Yılmaz', kayitTarihi: '2026-09-01T08:00:00Z' }],
  depoToplamItem: 4,
  depoSpotDeger: 9000,
  depoAlisDeger: 7000,
  depoByCat: [],
  wooHazir: 0,
  wooFoto: 0,
  wooLisitlendi: 0,
  logSayisi: 1,
  ayirmaSayisi: 0,
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
  opmcManuel: 0,
  faturaAdedi: 0,
  faturaToplamKr: 0,
};

function renderPage(overrides: Partial<Parameters<typeof MakeDashboardPage>[0]> = {}) {
  const onNavigate = vi.fn();
  render(
    <MakeDashboardPage
      data={BASE_SCREEN}
      lastRefresh={new Date('2026-09-05T10:00:00Z')}
      isRefreshing={false}
      onRefresh={() => {}}
      onNavigate={onNavigate}
      errorMessage={null}
      hasServerData
      {...overrides}
    />,
  );
  return { onNavigate };
}

describe('ödeme yöntemi etiketi', () => {
  it('tablo hücresi sabit Banka değil: nakit → Nakit, bank → Banka, yok → Belirtilmedi', () => {
    renderPage();
    expect(screen.getByText('Nakit')).toBeInTheDocument();
    expect(screen.getByText('Banka')).toBeInTheDocument();
    expect(screen.getByText('Belirtilmedi')).toBeInTheDocument();
  });
});

describe('tek kategorili depo pasta grafiği', () => {
  it('tek dilim tam daire olarak çizilir (arc çakışması grafiği silmez)', () => {
    renderPage({
      data: {
        ...BASE_SCREEN,
        depoByCat: [{ name: 'Guld', gram: 10, spot: 5000, color: '#c9a227' }],
      },
    });
    const donut = Array.from(document.querySelectorAll('svg path'))
      .map((path) => path.getAttribute('d') ?? '')
      .find((d) => d.includes('A 65 65'));
    expect(donut).toBeTruthy();
    // İki 180° dış yay: büyük-yay bayraklı çift arc tam daireyi oluşturur
    expect(donut!.match(/A 65 65 0 1 1/g)).toHaveLength(2);
    expect(donut!.match(/A 30 30 0 1 0/g)).toHaveLength(2);
  });
});

describe('navigasyon boşlukları', () => {
  it('son alış satırı AFG listesine (/log) gider', () => {
    const { onNavigate } = renderPage();
    fireEvent.click(screen.getByText('AFG-1'));
    expect(onNavigate).toHaveBeenCalledWith('/log');
  });

  it('son müşteri satırı müşteri listesine gider', () => {
    const { onNavigate } = renderPage();
    fireEvent.click(screen.getByText('Ada Yılmaz'));
    expect(onNavigate).toHaveBeenCalledWith('/musteriler');
  });

  it('Alış Sayısı KPI ve Tümü butonu /log hedefler (POS ekranı değil)', () => {
    const { onNavigate } = renderPage();
    fireEvent.click(screen.getByText('Alış Sayısı'));
    expect(onNavigate).toHaveBeenCalledWith('/log');
    // 'Tümü' iki bölümde de var; ilki Son Alışlar başlığıdır
    fireEvent.click(screen.getAllByText('Tümü')[0]);
    expect(onNavigate).toHaveBeenCalledWith('/log');
  });
});

describe('GDPR serbest bırakma kartı', () => {
  it('kilit süresi dolan ürünleri gün sayısıyla listeler ve /depolama bağlar', () => {
    const { onNavigate } = renderPage({
      gdprReleases: {
        state: 'ready',
        items: [{ productId: 'p1', productNumber: '0123', releaseDate: '2026-09-10T00:00:00Z', daysRemaining: 5 }],
      },
    });
    expect(screen.getByText('Yaklaşan GDPR serbest bırakma (14 gün)')).toBeInTheDocument();
    expect(screen.getByText('0123')).toBeInTheDocument();
    expect(screen.getByText('5 gün')).toBeInTheDocument();
    fireEvent.click(screen.getByText('0123'));
    expect(onNavigate).toHaveBeenCalledWith('/depolama');
  });

  it('beslenmeyen yüzeyde kart çizilmez', () => {
    renderPage();
    expect(screen.queryByText(/GDPR serbest bırakma/)).not.toBeInTheDocument();
  });
});

describe('modern model — düşen oran ucu dürüstçe etiketlenir', () => {
  const market = {
    eur_dkk_fx: '',
    gold_24k_dkk: '615.5',
    silver_dkk: '7.8',
    platinum_dkk: '280',
    palladium_dkk: '335',
    live_enabled: false,
    source: 'manual' as const,
    updated_at: null,
  };
  const bundle = {
    legacy: BASE_SCREEN,
    summary: { total_products: 4, locked_products: 0, free_products: 4, for_sale_products: 2, sold_this_month: 0, melted_this_month: 0 },
    stock: { total_stock_value_dkk: '9000', today_change_dkk: '0' },
    ops: { active_products: 4, products_with_photo: 0, products_without_photo: 4, photo_coverage_percent: '0', for_sale_without_photo: 0, needs_cleaning_queue: 0, pending_ai_description: 0, pending_ai_approval: 0, pending_publish: 0, stale_gdpr_lock: 0, ready_for_sale: 2, avg_active_age_days: '1', urgent_action_count: 0 },
    charts: { stock_flow_30d: [], monthly_profit_12m: [] },
    integrations: { openai_configured: false, woocommerce_configured: false, wordpress_media_configured: false, webhook_secret_set: false, total_published_products: 0, sync_success_24h: 0, sync_failed_24h: 0, last_sync_at: null, backup_latest_at: null, backup_recent_ok: false, backup_age_minutes: null, offsite_enabled: false, offsite_last_sync_at: null, offsite_recent_ok: null, offsite_age_minutes: null, restore_drill_last_at: null, restore_drill_recent_ok: false, restore_drill_age_hours: null },
    market,
  };

  it('mapDashboardFallback market düşüşünde kaynağı düşüş olarak yazar', () => {
    const view = mapDashboardFallback(bundle, { market: true, charts: false });
    expect(view.market.sourceLabel).toBe('Oran verisi alınamadı');
  });

  it('modernActivities ham enum yerine Türkçe etiket kullanır', () => {
    const overview: DashboardOverviewContract = {
      generatedAt: '2026-09-05T10:00:00Z',
      timezone: 'Europe/Copenhagen',
      periods: [{ period: '30d', startsAt: '2026-08-06T00:00:00Z', endsAtExclusive: '2026-09-05T00:00:00Z', purchaseCount: 2, purchaseNetDkk: '2400', purchaseVatDkk: '600', purchaseGrossDkk: '3000', newActiveCustomerCount: 0 }],
      activeCustomerCount: 1,
      inventory: { activeItemCount: 4, totalPurchaseValueDkk: '7000', totalSpotValueDkk: '9000', totalPureMetalGrams: '10', totalFineSilverGrams: '10', totalGoldRelatedGrams: '0' },
      wooCatalogTasks: { activeCatalogItemCount: 0, inactiveCatalogItemCount: 0, manualReviewCount: 0, photoMissingCount: 0, unlinkedCount: 0, catalogRevision: 0, remotePublishedCount: 0, lastSyncedAt: null },
      unicontaQueue: { pendingCount: 0, failedCount: 0, skippedCount: 0, syncedCount: 0, historicalCount: 0, lastSyncedAt: null, lastFailureAt: null },
      backupHealth: { latestLocalBackupAt: null, localBackupAgeMinutes: null, localBackupRecent: false, offsiteEnabled: false, lastOffsiteSyncAt: null, offsiteAgeMinutes: null, offsiteRecent: null, lastRestoreDrillAt: null, restoreDrillAgeHours: null, restoreDrillRecent: false },
      marketRateConfirmation: {
        businessDate: '2026-09-05',
        timezone: 'Europe/Copenhagen',
        recorded: true,
        confirmed: true,
        confirmationMode: 'unchanged' as const,
        confirmedAt: '2026-09-05T08:00:00Z',
        confirmedByUserId: 'u1',
        confirmedRates: { goldDkk: '615.5', silverDkk: '7.8', platinumDkk: '280', palladiumDkk: '335' },
        currentRates: { goldDkk: '615.5', silverDkk: '7.8', platinumDkk: '280', palladiumDkk: '335' },
        matchesCurrentRates: true,
      },
      financialCoverage: { companyRevenueDkk: null, companyProfitDkk: null, complete: false, reason: 'x' },
    };
    const view = mapDashboardOverview(overview, BASE_SCREEN, market, bundle.charts, '30d', true);
    const purchase = view.activities.find((item) => item.id === 'purchase-1');
    expect(purchase?.description).toContain('Nakit');
    expect(purchase?.description).not.toMatch(/\bbank\b|\bcash\b/);
    expect(view.market.sourceLabel).toBe('Oran verisi alınamadı');
  });
});
