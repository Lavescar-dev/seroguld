import { useCallback, useEffect, useMemo, useState } from 'react';

import { PdfViewerModal } from '@/components/PdfViewerModal';
import {
  closeCustomerDisplayWindow,
  ensureCustomerDisplayWindow,
  getDesktopMonitorSetup,
  isDesktopDisplayRouteMatch,
  openCustomerDisplayWindow,
  type DesktopDisplayWindowState,
  setCustomerDisplayIdle,
} from '@/lib/desktop';
import { AlisPage as MakeAlisPage } from '@/make/alis/AlisPage';
import { useAlisMakeState } from '@/make/alis/useAlisMakeState';
import { createModernAlisViewModel } from '@/modern/adapters';
import { ModernAlisModule } from '@/modern/modules';
import { uiVariantTransitionRegistry, useUiVariant } from '@/ui-variants';
import { useAppLocale, withDisplayLocale } from '@/i18n';
import { DockableCustomerNotesPanel } from '@/components/DockableCustomerNotesPanel';

export function PosPage() {
  const alisState = useAlisMakeState();
  const { variant } = useUiVariant();
  const { displayLocale } = useAppLocale();
  const modernViewModel = createModernAlisViewModel(alisState);

  useEffect(() => uiVariantTransitionRegistry.register({
    id: 'alis-workspace',
    evaluate: () => {
      const blockingReasons = modernViewModel.blocker?.reasons || [];
      if (blockingReasons.length > 0) {
        return { status: 'blocked', reason: blockingReasons.join(' ') };
      }
      return alisState.hasPendingWorkspaceSync?.()
        ? { status: 'settling', reason: 'Alış workspace autosave işlemi tamamlanıyor.' }
        : { status: 'ready' };
    },
    flush: async () => {
      await alisState.flushPendingWorkspaceSync?.();
    },
  }), [alisState.flushPendingWorkspaceSync, alisState.hasPendingWorkspaceSync, modernViewModel.blocker]);
  const [desktopDisplayState, setDesktopDisplayState] = useState<DesktopDisplayWindowState | null>(null);
  const expectedDisplayRoute = useMemo(
    () => withDisplayLocale(alisState.workspace?.session.display_token
      ? `/display/${alisState.workspace.session.display_token}?ui=${variant}`
      : `/display/idle?ui=${variant}`, displayLocale),
    [alisState.workspace?.session.display_token, displayLocale, variant],
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
      const state = await openCustomerDisplayWindow(expectedDisplayRoute);
      setDesktopDisplayState(state);
    } catch {
      // Best-effort desktop status only.
    }
  }, [expectedDisplayRoute]);

  const closeCustomerDisplay = useCallback(async () => {
    try {
      const state = await closeCustomerDisplayWindow(variant);
      setDesktopDisplayState(state);
    } catch {
      // Best-effort desktop status only.
    }
  }, [variant]);

  useEffect(() => {
    async function syncCustomerDisplay() {
      try {
        const state = await ensureCustomerDisplayWindow(expectedDisplayRoute);
        setDesktopDisplayState(state);
      } catch {
        // Customer display is best-effort outside the core purchase workflow.
      }
    }

    void syncCustomerDisplay();
  }, [expectedDisplayRoute]);

  useEffect(() => () => {
    void setCustomerDisplayIdle(variant, displayLocale);
  }, [displayLocale, variant]);

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
      {alisState.workspace?.customer.customer_id ? <DockableCustomerNotesPanel key={alisState.workspace.customer.customer_id} customerId={alisState.workspace.customer.customer_id} customerName={alisState.workspace.customer.name} /> : null}
      {variant === 'modern' ? (
        <ModernAlisModule
          viewModel={modernViewModel}
          displayBridge={{
            desktopDisplayState,
            expectedDisplayRoute,
            routeMatches: isDesktopDisplayRouteMatch(desktopDisplayState, expectedDisplayRoute),
            onOpenCustomerDisplay: openCustomerDisplay,
            onCloseCustomerDisplay: closeCustomerDisplay,
          }}
        />
      ) : (
        <MakeAlisPage
          {...alisState}
          desktopDisplayState={desktopDisplayState}
          expectedDisplayRoute={expectedDisplayRoute}
          routeMatches={isDesktopDisplayRouteMatch(desktopDisplayState, expectedDisplayRoute)}
          onOpenCustomerDisplay={openCustomerDisplay}
          onCloseCustomerDisplay={closeCustomerDisplay}
        />
      )}
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
