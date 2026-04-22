import { MakeDashboardPage } from '@/make/dashboard/DashboardPage';
import { useDashboardMakeState } from '@/make/dashboard/useDashboardMakeState';

export function DashboardPage() {
  const state = useDashboardMakeState();
  return <MakeDashboardPage {...state} />;
}
