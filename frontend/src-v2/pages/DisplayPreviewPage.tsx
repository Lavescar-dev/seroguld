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
import type {
  ModernAvailability,
  ModernCustomerDisplayControlPageProps,
  ModernStatusItem,
} from '@/modern/pages/types';
import { useUiVariant } from '@/ui-variants';

export function DisplayPreviewPage() {
  const state = useDisplayPreviewMakeState();
  const { variant } = useUiVariant();
  const [desktopDisplayState, setDesktopDisplayState] = useState<DesktopDisplayWindowState | null>(null);
  // M3 — köprü yanıtının yokluğu 'pencere kapalı' değildir: bridgeUnavailable
  // yalnızca köprü null döndüğünde (Tauri dışı / IPC hatası) işaretlenir;
  // son bilinen pencere durumu korunur (CustomerDisplayMonitorSettings kalıbı).
  const [bridgeUnavailable, setBridgeUnavailable] = useState(false);
  const expectedDisplayRoute = useMemo(() => (state.token ? `/display/${state.token}?ui=${variant}` : null), [state.token, variant]);

  const applyDesktopState = useCallback((nextState: DesktopDisplayWindowState | null) => {
    if (nextState) {
      setDesktopDisplayState(nextState);
      setBridgeUnavailable(false);
      return;
    }
    // getDesktopMonitorSetup/ensureCustomerDisplayWindow hata yaymaz, köprü
    // yoksa veya IPC hatasında null döner. Mevcut doğru durumu null ile
    // EZMEYİZ — ölü try/catch yerine 'bilinmiyor' işaretlenir.
    setBridgeUnavailable(true);
  }, []);

  const refreshDesktopDisplayState = useCallback(async () => {
    applyDesktopState(await getDesktopMonitorSetup());
  }, [applyDesktopState]);

  const openCustomerDisplay = useCallback(async () => {
    if (!expectedDisplayRoute) return;
    applyDesktopState(await ensureCustomerDisplayWindow(expectedDisplayRoute));
  }, [applyDesktopState, expectedDisplayRoute]);

  useEffect(() => {
    void refreshDesktopDisplayState();
    const handleFocus = () => {
      void refreshDesktopDisplayState();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshDesktopDisplayState]);

  if (variant === 'modern') {
    // 'unknown' — köprü hiç yanıt vermediyse pencere 'kapalı' SANILMASIN (M3):
    // modern sayfa bilinmeyen değeri nötr 'Bilinmiyor' etiketiyle gösterir.
    // Props tipi (modern/pages/types.ts) bu dalga için kilitli olduğundan dar
    // union'a cast edilir.
    const status = {
      connection: state.connection,
      windowState: desktopDisplayState?.window_open
        ? 'open'
        : desktopDisplayState?.has_secondary_monitor === false
          ? 'blocked'
          : desktopDisplayState
            ? 'closed'
            : 'unknown',
      token: state.token,
      lastHeartbeat: state.lastMessageAt,
      lastPreviewAt: state.snapshot?.updated_at,
    } as ModernCustomerDisplayControlPageProps['status'];
    const runtime: ModernStatusItem[] = [
      desktopDisplayState
        ? {
            label: 'İkinci monitör',
            value: desktopDisplayState.has_secondary_monitor ? 'Algılandı' : 'Algılanmadı',
            tone: desktopDisplayState.has_secondary_monitor ? 'success' : 'warning',
          }
        : {
            label: 'İkinci monitör',
            value: bridgeUnavailable ? 'Bilinmiyor' : 'Sorgulanıyor…',
            tone: 'info',
          },
      { label: 'Route', value: desktopDisplayState?.active_route || '—', tone: 'info' },
      ...(bridgeUnavailable
        ? [
            {
              label: 'Masaüstü köprüsü',
              value: 'Yanıt vermiyor — pencere durumu bilinmiyor',
              tone: 'warning' as const,
            },
          ]
        : []),
    ];
    // M3 — sorgu hatası 'token bekleniyor' ile karışmasın: hata varsa ayrık,
    // kırmızı uyarı gösterilir; token bekleniyor mesajı yalnız sorgu başarılı
    // ama boş döndüğünde görünür.
    const previewAvailability: ModernAvailability = state.previewError
      ? {
          state: 'unavailable',
          title: 'Önizleme alınamadı',
          description: `${state.previewError} — yeniden deneniyor.`,
        }
      : {
          state: state.token ? 'available' : 'readonly',
          title: state.token ? undefined : 'Aktif display token bekleniyor',
        };
    return (
      <ModernCustomerDisplayControlPage
        status={status}
        snapshot={state.snapshot}
        runtime={runtime}
        previewAvailability={previewAvailability}
        onOpenWindow={openCustomerDisplay}
        onPreview={refreshDesktopDisplayState}
        onRevoke={state.onRevoke}
        revokingToken={state.revokingToken}
      />
    );
  }

  return (
    <>
      {state.previewError ? (
        <div role="alert" className="border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          {`Önizleme alınamadı: ${state.previewError} — yeniden deneniyor.`}
        </div>
      ) : null}
      <MakeDisplayPreviewPage
        {...state}
        desktopDisplayState={desktopDisplayState}
        expectedDisplayRoute={expectedDisplayRoute}
        routeMatches={isDesktopDisplayRouteMatch(desktopDisplayState, expectedDisplayRoute)}
        onOpenCustomerDisplay={openCustomerDisplay}
      />
    </>
  );
}
