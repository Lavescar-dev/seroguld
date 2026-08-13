import type { ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  ChevronRight,
  CircleDollarSign,
  CloudCog,
  DatabaseBackup,
  Gauge,
  RefreshCw,
  ShieldAlert,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type {
  DashboardHealthCard,
  DashboardKpi,
  DashboardPeriod,
  ModernDashboardViewModel,
} from '@/make/dashboard/types';
import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernNotice,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
} from '@/modern/design-system';

export interface ModernDashboardPageProps {
  view: ModernDashboardViewModel | null;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onOpenMarketRates: () => void;
  onConfirmMarketUnchanged: () => void;
  isRefreshing?: boolean;
  isConfirmingMarket?: boolean;
  errorMessage?: string | null;
}

const PERIOD_OPTIONS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: '7d', label: '7 gün' },
  { value: '30d', label: '30 gün' },
  { value: '90d', label: '90 gün' },
  { value: '12m', label: '12 ay' },
];

const KPI_ICONS: Record<string, typeof Boxes> = {
  purchase: ShoppingBag,
  stock: Boxes,
  customers: UserRound,
  operations: ShieldAlert,
  revenue: CircleDollarSign,
};

const KPI_TONE: Record<DashboardKpi['tone'], string> = {
  primary: 'bg-sg-accent-soft text-sg-accent-dark',
  success: 'bg-sg-green-soft text-sg-green-strong',
  warning: 'bg-sg-amber-soft text-sg-amber',
  danger: 'bg-sg-red-soft text-sg-red',
  info: 'bg-sg-blue-soft text-sg-blue',
  neutral: 'bg-sg-surface-soft text-sg-text-soft',
};

const HEALTH_ICONS: Record<DashboardHealthCard['id'], typeof DatabaseBackup> = {
  backup: DatabaseBackup,
  woocommerce: CloudCog,
  wordpress: CloudCog,
  uniconta: CircleDollarSign,
  market: Gauge,
};

function formatRate(value: number) {
  return new Intl.NumberFormat(document.documentElement.lang || 'tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(document.documentElement.lang || 'tr-TR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return 'Henüz bildirilmedi';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(document.documentElement.lang || 'tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusDot({ tone }: { tone: DashboardHealthCard['tone'] }) {
  const color = tone === 'success' ? 'bg-sg-green' : tone === 'danger' ? 'bg-sg-red' : tone === 'warning' ? 'bg-sg-amber' : 'bg-sg-text-soft/50';
  return <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}

function DashboardKpiCard({ item }: { item: DashboardKpi }) {
  const Icon = KPI_ICONS[item.id] || Activity;
  return (
    <ModernCard className="min-h-[142px] bg-sg-surface p-5 shadow-none">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{item.label}</p>
        <span className={`rounded-sg-md p-2.5 ${KPI_TONE[item.tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-sg-text">{item.value}</p>
      <p className="mt-2 text-sm text-sg-text-soft">{item.detail}</p>
    </ModernCard>
  );
}

function EmptyLoadingSurface() {
  return (
    <ModernPage aria-busy="true">
      <div className="h-[248px] animate-pulse rounded-sg-xl border border-sg-border bg-sg-surface" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-[142px] animate-pulse rounded-sg-lg border border-sg-border bg-sg-surface" />)}
      </div>
    </ModernPage>
  );
}

function DashboardPanel({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <ModernSection className="p-0 shadow-none">
      <div className="px-5 pt-5">
        <ModernSectionHeader title={title} description={description} action={action} />
      </div>
      <div className="p-5">{children}</div>
    </ModernSection>
  );
}

export function ModernDashboardPage({
  view,
  period,
  onPeriodChange,
  onNavigate,
  onRefresh,
  onOpenMarketRates,
  onConfirmMarketUnchanged,
  isRefreshing,
  isConfirmingMarket,
  errorMessage,
}: ModernDashboardPageProps) {
  if (!view) {
    return errorMessage ? (
      <ModernPage>
        <ModernNotice
          tone="danger"
          title="Yönetim özeti yüklenemedi"
          description={errorMessage}
          action={<ModernButton icon={RefreshCw} onClick={onRefresh}>Tekrar dene</ModernButton>}
        />
      </ModernPage>
    ) : <EmptyLoadingSurface />;
  }

  const trend = view.trend[period];
  const trendDescription = period === '90d'
    ? '90 günlük özet KPI’larda; günlük seri henüz bu dönem için sağlanmıyor'
    : period === '12m'
      ? 'Aylık sonuçların son 12 aylık görünümü'
      : 'Alış ve çıkış hareketlerinin dönem görünümü';

  return (
    <ModernPage className="gap-4 pb-8">
      {errorMessage ? <ModernNotice tone="warning" title="Bazı yönetim verileri yenilenemedi" description={errorMessage} /> : null}

      <section className="overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-sm">
        <div className="flex flex-col gap-4 border-b border-sg-border-soft px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sg-accent-dark">Günlük piyasa</p>
              <ModernBadge tone={view.market.confirmedToday ? 'success' : 'warning'}>
                {view.market.confirmedToday ? <BadgeCheck className="h-3.5 w-3.5" /> : null}
                {view.market.confirmedToday ? 'Bugün onaylandı' : 'Bugün onay bekliyor'}
              </ModernBadge>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-sg-text">Bugünün referans oranları</h2>
            <p className="mt-1.5 text-sm text-sg-text-soft">
              {view.market.sourceLabel} · Son güncelleme {formatDateTime(view.market.lastUpdatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ModernButton tone="ghost" onClick={onOpenMarketRates}>Oranları kontrol et</ModernButton>
            <ModernButton
              tone={view.market.confirmedToday ? 'ghost' : 'primary'}
              icon={Check}
              disabled={view.market.confirmedToday || isConfirmingMarket}
              onClick={onConfirmMarketUnchanged}
            >
              {isConfirmingMarket ? 'Onaylanıyor…' : view.market.confirmedToday ? 'Bugün onaylandı' : 'Değişmedi olarak onayla'}
            </ModernButton>
          </div>
        </div>

        <div className="grid divide-y divide-sg-border-soft sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
          {view.market.rates.map((rate) => (
            <div key={rate.key} className="px-5 py-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sg-text-soft">{rate.label}</p>
              <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-sg-text">{formatRate(rate.value)}</p>
              <p className="mt-1 text-xs text-sg-text-soft">{rate.unit}</p>
            </div>
          ))}
        </div>

        {view.market.confirmedToday && view.market.confirmedAt ? (
          <div className="border-t border-sg-border-soft bg-sg-surface-soft/55 px-5 py-3 text-xs text-sg-text-soft">
            {formatDateTime(view.market.confirmedAt)} tarihinde {view.market.confirmedByName || 'yetkili kullanıcı'} tarafından kontrol edildi.
          </div>
        ) : null}
      </section>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sg-text">Yönetim özeti</p>
          <p className="mt-0.5 text-xs text-sg-text-soft">Öncelikli finansal ve operasyonel göstergeler</p>
        </div>
        <ModernButton tone="ghost" size="sm" icon={RefreshCw} disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? 'Yenileniyor…' : 'Yenile'}
        </ModernButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {view.kpis.map((item) => <DashboardKpiCard key={item.id} item={item} />)}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[0.72fr_1.28fr]">
        <DashboardPanel title="Operasyon iş kutusu" description="Bugün ele alınması gereken kayıtlar">
          <div className="space-y-2">
            {view.inbox.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.route)}
                className="group flex w-full items-center gap-4 rounded-sg-md border border-transparent px-3 py-3 text-left transition hover:border-sg-border hover:bg-sg-surface-soft"
              >
                <span className={`flex h-10 min-w-10 items-center justify-center rounded-sg-md text-sm font-semibold ${item.count ? (item.tone === 'danger' ? 'bg-sg-red-soft text-sg-red' : 'bg-sg-amber-soft text-sg-amber') : 'bg-sg-green-soft text-sg-green-strong'}`}>
                  {item.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-sg-text">{item.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-sg-text-soft">{item.description}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-sg-text-soft transition group-hover:translate-x-0.5 group-hover:text-sg-accent" />
              </button>
            ))}
          </div>
        </DashboardPanel>

        <DashboardPanel
          title="İşlem trendi"
          description={trendDescription}
          action={
            <div className="flex rounded-sg-md border border-sg-border bg-sg-surface-soft p-1" role="group" aria-label="Trend dönemi">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={period === option.value}
                  onClick={() => onPeriodChange(option.value)}
                  className={`rounded-sg-sm px-3 py-1.5 text-xs font-medium transition ${period === option.value ? 'bg-sg-surface text-sg-accent-dark shadow-sg-sm' : 'text-sg-text-soft hover:text-sg-text'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-[258px] w-full" data-testid="dashboard-trend-chart">
            {trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardPrimary" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="rgb(var(--sg-accent-rgb))" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="rgb(var(--sg-accent-rgb))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgb(var(--sg-border-soft-rgb))" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'rgb(var(--sg-text-soft-rgb))', fontSize: 11 }} minTickGap={20} />
                  <YAxis axisLine={false} tickLine={false} tickFormatter={formatCompact} tick={{ fill: 'rgb(var(--sg-text-soft-rgb))', fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => formatCompact(value)} contentStyle={{ borderRadius: 12, borderColor: 'rgb(var(--sg-border-rgb))', boxShadow: 'var(--sg-shadow-md)' }} />
                  <Area type="monotone" dataKey="primary" name="Giriş" stroke="rgb(var(--sg-accent-rgb))" strokeWidth={2.2} fill="url(#dashboardPrimary)" />
                  <Area type="monotone" dataKey="secondary" name="Çıkış" stroke="rgb(var(--sg-text-soft-rgb))" strokeWidth={1.5} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-6 text-sg-text-soft">{period === '90d' ? '90 günlük toplamlar yönetim KPI’larında gösteriliyor. Günlük 90 gün serisi henüz raporlanmıyor.' : 'Bu dönem için hareket bulunmuyor.'}</div>}
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardPanel title="Son hareketler" description="AFG ve müşteri kayıtlarındaki yakın değişiklikler">
          <div className="divide-y divide-sg-border-soft">
            {view.activities.length ? view.activities.map((activity) => (
              <button key={activity.id} type="button" onClick={() => onNavigate(activity.route)} className="group flex w-full items-center gap-4 py-3 text-left first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sg-surface-soft text-sg-accent-dark">
                  {activity.kind === 'purchase' ? <ShoppingBag className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-sg-text">{activity.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-sg-text-soft">{activity.description}</span>
                </span>
                <span className="text-xs text-sg-text-soft">{formatDateTime(activity.occurredAt)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-sg-text-soft transition group-hover:translate-x-0.5" />
              </button>
            )) : <p className="py-10 text-center text-sm text-sg-text-soft">Henüz hareket kaydı yok.</p>}
          </div>
        </DashboardPanel>

        <DashboardPanel title="Sistem sağlığı" description="Yedekleme ve dış servislerin yönetim görünümü">
          <div className="grid gap-3 sm:grid-cols-2">
            {view.health.map((item) => {
              const Icon = HEALTH_ICONS[item.id];
              return (
                <button key={item.id} type="button" onClick={() => onNavigate(item.route)} className="rounded-sg-md border border-sg-border bg-sg-surface-soft/60 p-4 text-left transition hover:border-sg-accent/30 hover:bg-sg-surface">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-sg-md bg-sg-surface text-sg-text-soft"><Icon className="h-4 w-4" /></span>
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-sg-text-soft"><StatusDot tone={item.tone} />{item.statusLabel}</span>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-sg-text">{item.label}</p>
                  <p className="mt-1 min-h-10 text-xs leading-5 text-sg-text-soft">{item.description}</p>
                </button>
              );
            })}
          </div>
        </DashboardPanel>
      </div>
    </ModernPage>
  );
}
