import { useCallback, useEffect, useMemo, useState } from 'react';

import { PdfViewerModal } from '@/components/PdfViewerModal';
import {
  ensureCustomerDisplayWindow,
  getDesktopMonitorSetup,
  isDesktopDisplayRouteMatch,
  type DesktopDisplayWindowState,
  setCustomerDisplayIdle,
} from '@/lib/desktop';
import { AlisPage as MakeAlisPage } from '@/make/alis/AlisPage';
import { useAlisMakeState } from '@/make/alis/useAlisMakeState';

export function PosPage() {
  const alisState = useAlisMakeState();
  const [desktopDisplayState, setDesktopDisplayState] = useState<DesktopDisplayWindowState | null>(null);
  const expectedDisplayRoute = useMemo(
    () => (alisState.workspace?.session.display_token ? `/display/${alisState.workspace.session.display_token}` : null),
    [alisState.workspace?.session.display_token],
  );

  const refreshDesktopDisplayState = useCallback(async () => {
    try {
      const state = await getDesktopMonitorSetup();
      setDesktopDisplayState(state);
    } catch {
      // Best-effort desktop status only.
    }
  }, []);

  const openCustomerDisplay = useCallback(async () => {
    if (!expectedDisplayRoute) return;
    try {
      const state = await ensureCustomerDisplayWindow(expectedDisplayRoute);
      setDesktopDisplayState(state);
    } catch {
      // Best-effort desktop status only.
    }
  }, [expectedDisplayRoute]);

  useEffect(() => {
    async function syncCustomerDisplay() {
      try {
        if (alisState.workspace?.session.display_token) {
          const state = await ensureCustomerDisplayWindow(`/display/${alisState.workspace.session.display_token}`);
          setDesktopDisplayState(state);
          return;
        }
        const state = await setCustomerDisplayIdle();
        setDesktopDisplayState(state);
      } catch {
        // Customer display is best-effort outside the core purchase workflow.
      }
    }

    void syncCustomerDisplay();
  }, [alisState.workspace?.session.display_token]);

  useEffect(() => {
    void refreshDesktopDisplayState();
    const handleFocus = () => {
      void refreshDesktopDisplayState();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshDesktopDisplayState]);

  return (
    <>
      <MakeAlisPage
        {...alisState}
        desktopDisplayState={desktopDisplayState}
        expectedDisplayRoute={expectedDisplayRoute}
        routeMatches={isDesktopDisplayRouteMatch(desktopDisplayState, expectedDisplayRoute)}
        onOpenCustomerDisplay={openCustomerDisplay}
      />
      <PdfViewerModal
        open={Boolean(alisState.pdfState.url)}
        pdfUrl={alisState.pdfState.url}
        filename={alisState.pdfState.filename}
        title="Alış Belgesi PDF"
        onClose={alisState.onClosePdfModal}
      />
      {alisState.pdfState.error ? (
        <div className="fixed bottom-4 right-4 z-[60] max-w-md border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-700 shadow-lg">
          <p className="font-bold uppercase tracking-wider">PDF Hatası</p>
          <p className="mt-1">{alisState.pdfState.error}</p>
        </div>
      ) : null}
    </>
  );
}
