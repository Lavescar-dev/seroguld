'use client';

import { useEffect, useState } from 'react';

import { CalendarView } from '@/components/CalendarView';
import { DashboardChartsPanel } from '@/components/DashboardCharts';
import { StockValueCard } from '@/components/StockValueCard';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import {
  DashboardAICost,
  DashboardCalendar,
  DashboardCharts,
  DashboardIntegrations,
  DashboardOps,
  DashboardProfit,
  DashboardStock,
  DashboardSummary,
  WooManualSyncResult,
} from '@/types';

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [stock, setStock] = useState<DashboardStock | null>(null);
  const [profit, setProfit] = useState<DashboardProfit | null>(null);
  const [calendar, setCalendar] = useState<DashboardCalendar | null>(null);
  const [aiCost, setAiCost] = useState<DashboardAICost | null>(null);
  const [ops, setOps] = useState<DashboardOps | null>(null);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [integrations, setIntegrations] = useState<DashboardIntegrations | null>(null);
  const [syncingWoo, setSyncingWoo] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [error, setError] = useState('');

  async function loadDashboard() {
    setError('');
    try {
      const [summaryData, stockData, profitData, calendarData, aiCostData, opsData, chartData, integrationsData] =
        await Promise.all([
          apiRequest<DashboardSummary>('/api/dashboard/summary'),
          apiRequest<DashboardStock>('/api/dashboard/stock-value'),
          apiRequest<DashboardProfit>('/api/dashboard/profit'),
          apiRequest<DashboardCalendar>('/api/dashboard/calendar'),
          apiRequest<DashboardAICost>('/api/dashboard/ai-cost'),
          apiRequest<DashboardOps>('/api/dashboard/ops'),
          apiRequest<DashboardCharts>('/api/dashboard/charts'),
          apiRequest<DashboardIntegrations>('/api/dashboard/integrations'),
        ]);
      setSummary(summaryData);
      setStock(stockData);
      setProfit(profitData);
      setCalendar(calendarData);
      setAiCost(aiCostData);
      setOps(opsData);
      setCharts(chartData);
      setIntegrations(integrationsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Panel verileri alınamadı');
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function syncWooOrders() {
    setSyncMessage('');
    setSyncingWoo(true);
    try {
      const result = await apiRequest<WooManualSyncResult>('/api/webhooks/woocommerce/sync-recent?days=30&per_page=100', {
        method: 'POST',
      });
      setSyncMessage(
        `Senkron tamamlandı · Sipariş: ${result.orders_scanned}, Satır: ${result.line_items_scanned}, İşlenen: ${result.processed}, Atlanan: ${result.ignored}`,
      );
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WooCommerce senkronizasyonu başarısız');
    } finally {
      setSyncingWoo(false);
    }
  }

  const integrationBadge = (ok: boolean) =>
    ok
      ? 'inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800'
      : 'inline-flex rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800';

  const nullableBadge = (ok: boolean | null | undefined) => {
    if (ok === null || ok === undefined) {
      return 'inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700';
    }
    return integrationBadge(ok);
  };

  const photoCoveragePercent = Number(ops?.photo_coverage_percent ?? '0');
  const photoCoverageWidth = `${Math.max(0, Math.min(100, Number.isFinite(photoCoveragePercent) ? photoCoveragePercent : 0))}%`;
  const publishReadyCount = (ops?.pending_publish ?? 0) + (ops?.pending_ai_approval ?? 0) + (ops?.pending_ai_description ?? 0);

  return (
    <div className="space-y-5">
      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      {syncMessage && <p className="text-sm font-semibold text-emerald-700">{syncMessage}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StockValueCard data={stock} />

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Toplam Ürün</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{summary?.total_products ?? '-'}</p>
          <p className="mt-2 text-sm text-brand-700">Kilitli: {summary?.locked_products ?? '-'} · Serbest: {summary?.free_products ?? '-'}</p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Bu Ay Satış</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{summary?.sold_this_month ?? '-'}</p>
          <p className="mt-2 text-sm text-brand-700">Eritilen: {summary?.melted_this_month ?? '-'}</p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Aylık Kâr</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{profit?.monthly_profit_dkk ?? '-'} DKK</p>
          <p className="mt-2 text-sm text-brand-700">En iyi kategori: {profit?.top_category ?? '-'}</p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">AI Maliyeti</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{aiCost?.total_cost_usd ?? '-'} USD</p>
          <p className="mt-2 text-sm text-brand-700">Bu ay: {aiCost?.this_month_cost_usd ?? '-'} USD</p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Operasyon Alarmı</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{ops?.urgent_action_count ?? '-'}</p>
          <p className="mt-2 text-sm text-brand-700">Acil takip: foto, AI, yayın ve GDPR kilit</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <CalendarView data={calendar} />
        <div className="card p-4">
          <h3 className="text-base font-semibold text-brand-900">Özet Metrikler</h3>
          <ul className="mt-3 space-y-2 text-sm text-brand-700">
            <li>Satışta: {summary?.for_sale_products ?? '-'}</li>
            <li>En iyi kategori kârı: {profit?.top_category_profit_dkk ?? '-'} DKK</li>
            <li>Eritme oranı: {profit?.melted_ratio_percent ?? '-'}%</li>
            <li>AI çağrısı: {aiCost?.total_requests ?? '-'}</li>
            <li>Son AI çağrısı: {aiCost?.last_call_at ? new Date(aiCost.last_call_at).toLocaleString('tr-TR') : '-'}</li>
          </ul>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-brand-900">Operasyon Takibi</h3>
            <p className="mt-1 text-xs text-brand-600">Fotoğraf, AI açıklama ve yayın süreçlerinin canlı durumu</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Aktif Ürün</p>
            <p className="mt-1 text-xl font-bold text-brand-900">{ops?.active_products ?? '-'}</p>
            <p className="mt-1 text-xs text-brand-700">Satışa hazır: {ops?.ready_for_sale ?? '-'}</p>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Foto Kapsama</p>
            <p className="mt-1 text-xl font-bold text-brand-900">{ops?.photo_coverage_percent ?? '-'}%</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100">
              <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: photoCoverageWidth }} />
            </div>
            <p className="mt-1 text-xs text-brand-700">
              Eksik foto: {ops?.products_without_photo ?? '-'} · Satışta foto eksik: {ops?.for_sale_without_photo ?? '-'}
            </p>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">AI + Yayın Kuyruğu</p>
            <p className="mt-1 text-xl font-bold text-brand-900">{publishReadyCount}</p>
            <p className="mt-1 text-xs text-brand-700">Açıklama bekleyen: {ops?.pending_ai_description ?? '-'}</p>
            <p className="text-xs text-brand-700">Onay bekleyen: {ops?.pending_ai_approval ?? '-'}</p>
            <p className="text-xs text-brand-700">Yayın bekleyen: {ops?.pending_publish ?? '-'}</p>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Bakım & Yaş</p>
            <p className="mt-1 text-xl font-bold text-brand-900">{ops?.needs_cleaning_queue ?? '-'}</p>
            <p className="mt-1 text-xs text-brand-700">Temizlik kuyruğu</p>
            <p className="text-xs text-brand-700">Ortalama stok yaşı: {ops?.avg_active_age_days ?? '-'} gün</p>
            <p className="text-xs text-brand-700">Stale GDPR kilit: {ops?.stale_gdpr_lock ?? '-'}</p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-brand-900">E-Ticaret Entegrasyon Durumu</h3>
            <p className="mt-1 text-xs text-brand-600">WooCommerce ve WordPress bağlantı sağlığı</p>
          </div>
          <Button onClick={syncWooOrders} disabled={syncingWoo || !integrations?.woocommerce_configured}>
            {syncingWoo ? 'Senkronize Ediliyor...' : 'Siparişleri Senkronize Et'}
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">OpenAI</p>
            <span className={integrationBadge(Boolean(integrations?.openai_configured))}>
              {integrations?.openai_configured ? 'Bağlı' : 'Eksik'}
            </span>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">WooCommerce API</p>
            <span className={integrationBadge(Boolean(integrations?.woocommerce_configured))}>
              {integrations?.woocommerce_configured ? 'Bağlı' : 'Eksik'}
            </span>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">WP Media Upload</p>
            <span className={integrationBadge(Boolean(integrations?.wordpress_media_configured))}>
              {integrations?.wordpress_media_configured ? 'Bağlı' : 'Eksik'}
            </span>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Webhook Secret</p>
            <span className={integrationBadge(Boolean(integrations?.webhook_secret_set))}>
              {integrations?.webhook_secret_set ? 'Tanımlı' : 'Eksik'}
            </span>
          </div>
        </div>

        <ul className="mt-3 grid gap-2 text-sm text-brand-700 md:grid-cols-2 xl:grid-cols-4">
          <li>Yayındaki ürün: {integrations?.total_published_products ?? '-'}</li>
          <li>24s başarılı sync: {integrations?.sync_success_24h ?? '-'}</li>
          <li>24s hatalı sync: {integrations?.sync_failed_24h ?? '-'}</li>
          <li>Son sync: {integrations?.last_sync_at ? new Date(integrations.last_sync_at).toLocaleString('tr-TR') : '-'}</li>
        </ul>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-brand-900">Backup Sağlık Durumu</h3>
            <p className="mt-1 text-xs text-brand-600">Lokal backup, offsite sync ve restore tatbikatı izleme</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Lokal Backup</p>
            <span className={integrationBadge(Boolean(integrations?.backup_recent_ok))}>
              {integrations?.backup_recent_ok ? 'Güncel' : 'Eski / Eksik'}
            </span>
            <p className="mt-2 text-xs text-brand-700">
              Son: {integrations?.backup_latest_at ? new Date(integrations.backup_latest_at).toLocaleString('tr-TR') : '-'}
            </p>
            <p className="text-xs text-brand-700">Yaş: {integrations?.backup_age_minutes ?? '-'} dk</p>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Offsite Sync</p>
            <span className={nullableBadge(integrations?.offsite_recent_ok)}>
              {!integrations?.offsite_enabled
                ? 'Pasif'
                : integrations?.offsite_recent_ok
                  ? 'Güncel'
                  : 'Eski / Eksik'}
            </span>
            <p className="mt-2 text-xs text-brand-700">
              Son: {integrations?.offsite_last_sync_at ? new Date(integrations.offsite_last_sync_at).toLocaleString('tr-TR') : '-'}
            </p>
            <p className="text-xs text-brand-700">Yaş: {integrations?.offsite_age_minutes ?? '-'} dk</p>
          </div>

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
            <p className="text-xs text-brand-600">Restore Tatbikatı</p>
            <span className={integrationBadge(Boolean(integrations?.restore_drill_recent_ok))}>
              {integrations?.restore_drill_recent_ok ? 'Güncel' : 'Eski / Eksik'}
            </span>
            <p className="mt-2 text-xs text-brand-700">
              Son:{' '}
              {integrations?.restore_drill_last_at
                ? new Date(integrations.restore_drill_last_at).toLocaleString('tr-TR')
                : '-'}
            </p>
            <p className="text-xs text-brand-700">Yaş: {integrations?.restore_drill_age_hours ?? '-'} saat</p>
          </div>
        </div>
      </div>

      <DashboardChartsPanel data={charts} />
    </div>
  );
}
