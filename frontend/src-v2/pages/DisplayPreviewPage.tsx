import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ensureCustomerDisplayWindow,
  getDesktopMonitorSetup,
  isDesktopDisplayRouteMatch,
  type DesktopDisplayWindowState,
} from '@/lib/desktop';
import { MakeDisplayPreviewPage } from '@/make/display/DisplayPreviewPage';
import { useDisplayPreviewMakeState } from '@/make/display/useDisplayPreviewMakeState';

export function DisplayPreviewPage() {
  const state = useDisplayPreviewMakeState();
  const [desktopDisplayState, setDesktopDisplayState] = useState<DesktopDisplayWindowState | null>(null);
  const expectedDisplayRoute = useMemo(() => (state.token ? `/display/${state.token}` : null), [state.token]);

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
