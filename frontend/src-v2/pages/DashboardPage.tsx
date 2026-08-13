import { MakeDashboardPage } from '@/make/dashboard/DashboardPage';
import { useDashboardMakeState } from '@/make/dashboard/useDashboardMakeState';
import { ModernDashboardPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function DashboardPage() {
  const { variant } = useUiVariant();
  const state = useDashboardMakeState(variant);
  if (variant === 'classic') return <MakeDashboardPage {...state} />;

  return (
    <ModernDashboardPage
      view={state.modern}
      period={state.period}
      onPeriodChange={state.setPeriod}
      isRefreshing={state.isRefreshing}
      isConfirmingMarket={state.isConfirmingMarket}
      onRefresh={state.onRefresh}
      onNavigate={state.onNavigate}
      onOpenMarketRates={state.onOpenMarketRates}
      onConfirmMarketUnchanged={state.onConfirmMarketUnchanged}
      errorMessage={state.modernError}
    />
  );
}
