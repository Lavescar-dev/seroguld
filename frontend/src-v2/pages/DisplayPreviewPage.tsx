import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ensureCustomerDisplayWindow,
  getDesktopMonitorSetup,
  isDesktopDisplayRouteMatch,
  type DesktopDisplayWindowState,
} from '@/lib/desktop';
import { MakeDisplayPreviewPage } from '@/make/display/DisplayPreviewPage';
import { useDisplayPreviewMakeState } from '@/make/display/useDisplayPreviewMakeState';
import { ModernCustomerDisplayControlPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function DisplayPreviewPage() {
  const state = useDisplayPreviewMakeState();
  const { variant } = useUiVariant();
  const [desktopDisplayState, setDesktopDisplayState] = useState<DesktopDisplayWindowState | null>(null);
  const expectedDisplayRoute = useMemo(() => (state.token ? `/display/${state.token}?ui=${variant}` : null), [state.token, variant]);

  const refreshDesktopDisplayState = useCallback(async () => {
    try {
      const nextState = await getDesktopMonitorSetup();
      setDesktopDisplayState(nextState);
    } catch {
      // Best-effort desktop status only.
    }
  }, []);

  const openCustomerDisplay = useCallback(async () => {
    if (!expectedDisplayRoute) return;
    try {
      const nextState = await ensureCustomerDisplayWindow(expectedDisplayRoute);
      setDesktopDisplayState(nextState);
    } catch {
      // Best-effort desktop status only.
    }
  }, [expectedDisplayRoute]);

  useEffect(() => {
    void refreshDesktopDisplayState();
    const handleFocus = () => {
      void refreshDesktopDisplayState();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshDesktopDisplayState]);

  if (variant === 'modern') {
    return (
      <ModernCustomerDisplayControlPage
        status={{
          connection: state.connection,
          windowState: desktopDisplayState?.window_open ? 'open' : desktopDisplayState?.has_secondary_monitor === false ? 'blocked' : 'closed',
          token: state.token,
          lastPreviewAt: state.snapshot?.updated_at,
        }}
        snapshot={state.snapshot}
        runtime={[
          { label: 'İkinci monitör', value: desktopDisplayState?.has_secondary_monitor ? 'Algılandı' : 'Algılanmadı', tone: desktopDisplayState?.has_secondary_monitor ? 'success' : 'warning' },
          { label: 'Route', value: desktopDisplayState?.active_route || '—', tone: 'info' },
        ]}
        previewAvailability={{ state: state.token ? 'available' : 'readonly', title: state.token ? undefined : 'Aktif display token bekleniyor' }}
        onOpenWindow={openCustomerDisplay}
        onPreview={refreshDesktopDisplayState}
      />
    );
  }

  return (
    <MakeDisplayPreviewPage
      {...state}
      desktopDisplayState={desktopDisplayState}
      expectedDisplayRoute={expectedDisplayRoute}
      routeMatches={isDesktopDisplayRouteMatch(desktopDisplayState, expectedDisplayRoute)}
      onOpenCustomerDisplay={openCustomerDisplay}
    />
  );
}
