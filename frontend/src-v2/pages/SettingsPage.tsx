import { AlertTriangle, RefreshCw } from 'lucide-react';

import { useSettingsMakeState } from '@/make/settings/useSettingsMakeState';
import { UiVariantSettingsCards, useUiVariant } from '@/ui-variants';
import { CustomerDisplayMonitorSettings } from '@/components/CustomerDisplayMonitorSettings';
import { LanguagePreferencePanel } from '@/i18n';
import { SettingsWorkspace } from '@/components/SettingsWorkspace';

/**
 * HIGH fix: GET /api/v2/settings başarısızken sayfa eskiden DEFAULT_CONFIG ile
 * sessizce açılıyordu; Kaydet/Sıfırla/İçe aktar üretim ayarlarını kalıcı
 * ezebiliyordu. Artık yükleme sürerken iskelet, başarısızlıkta kilitli hata
 * bandı gösterilir — default konfig yazma yolu hiç açılmaz.
 */
function SettingsLoadingSkeleton() {
  return (
    <div className="min-h-full bg-[#f3f6fb] text-slate-950" data-testid="settings-loading-skeleton" aria-busy="true">
      <div className="mx-auto max-w-[1480px] animate-pulse px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-5">
          <div className="h-3 w-32 rounded bg-slate-200" />
          <div className="mt-3 h-7 w-40 rounded bg-slate-200" />
          <div className="mt-2 h-4 w-72 rounded bg-slate-200" />
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="hidden h-72 rounded-2xl border border-slate-200 bg-white p-3 lg:block">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="mb-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-slate-100" />
                <div className="flex-1">
                  <div className="h-3.5 w-28 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-20 rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 sm:p-7">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-6 w-48 rounded bg-slate-200" />
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {[0, 1, 2, 3].map((field) => (
                <div key={field}>
                  <div className="h-3 w-24 rounded bg-slate-100" />
                  <div className="mt-2 h-11 w-full rounded-xl bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-full bg-[#f3f6fb] text-slate-950">
      <div className="mx-auto max-w-[1480px] px-4 py-10 sm:px-6 lg:px-8">
        <div
          role="alert"
          data-testid="settings-load-error"
          className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 p-6"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold text-rose-900">Ayarlar yüklenemedi</h1>
              <p className="mt-1 text-sm leading-6 text-rose-800">
                Üretim yapılandırması sunucudan okunamadı. Ayarlar güvenli kilitte: kaydetme, sıfırlama ve içe
                aktarma, mevcut değerler okunana kadar devre dışıdır.
              </p>
              {message ? <p className="mt-2 break-words font-mono text-xs text-rose-700">{message}</p> : null}
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                <RefreshCw className="h-4 w-4" /> Tekrar dene
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const state = useSettingsMakeState();
  const { variant } = useUiVariant();

  if (state.isLoading) {
    return <SettingsLoadingSkeleton />;
  }
  if (state.isError) {
    return <SettingsLoadError message={state.loadErrorMessage} onRetry={state.onRetryLoad} />;
  }

  return (
    <SettingsWorkspace
      {...state}
      variant={variant}
      uiVariantSlot={<UiVariantSettingsCards />}
      languageSlot={<LanguagePreferencePanel variant={variant} />}
      monitorSlot={<CustomerDisplayMonitorSettings variant={variant} />}
    />
  );
}
