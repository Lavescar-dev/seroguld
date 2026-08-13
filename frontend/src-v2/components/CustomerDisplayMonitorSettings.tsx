import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Monitor, RefreshCw, X } from 'lucide-react';

import {
  DISPLAY_IDLE_ROUTE,
  closeCustomerDisplayWindow,
  getDesktopMonitorSetup,
  openCustomerDisplayWindow,
  setCustomerDisplayMonitor,
  type DesktopDisplayWindowState,
} from '@/lib/desktop';

type CustomerDisplayMonitorSettingsProps = {
  variant: 'classic' | 'modern';
};

function monitorLabel(name: string, index: number) {
  return name.trim() || `Ekran ${index + 1}`;
}

function selectionMessage(state: DesktopDisplayWindowState) {
  if (state.selection_source === 'fallback') {
    return 'Kayıtlı monitör bağlı değil. Uygun ekran geçici olarak kullanılıyor.';
  }
  if (state.selection_source === 'unavailable') {
    return 'Müşteri ekranı için kullanılabilecek ikinci monitör bulunamadı.';
  }
  if (state.selection_source === 'saved') {
    return 'Bu bilgisayar için kaydedilmiş monitör kullanılıyor.';
  }
  return 'İlk uygun ikinci monitör otomatik olarak kullanılıyor.';
}

export function CustomerDisplayMonitorSettings({ variant }: CustomerDisplayMonitorSettingsProps) {
  const modern = variant === 'modern';
  const [state, setState] = useState<DesktopDisplayWindowState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    const nextState = await getDesktopMonitorSetup();
    setState(nextState);
    if (!nextState) {
      setError('Monitör bilgisi yalnızca Windows masaüstü uygulamasında kullanılabilir.');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectMonitor = async (monitorId: string) => {
    if (!state || selecting) return;
    setSelecting(monitorId);
    setError(null);
    const nextState = await setCustomerDisplayMonitor(monitorId, state.active_route);
    if (!nextState) {
      setError('Monitör seçimi uygulanamadı. Mevcut seçim korunuyor.');
      setSelecting(null);
      return;
    }

    setState(nextState);
    setSelecting(null);
  };

  const toggleCustomerDisplay = async () => {
    if (!state || toggling) return;
    setToggling(true);
    setError(null);
    const nextState = state.window_open
      ? await closeCustomerDisplayWindow(variant)
      : await openCustomerDisplayWindow(`${DISPLAY_IDLE_ROUTE}?ui=${variant}`);
    if (!nextState) {
      setError(state.window_open ? 'Müşteri ekranı kapatılamadı.' : 'Müşteri ekranı açılamadı. İkinci monitör bağlantısını kontrol edin.');
    } else {
      setState(nextState);
    }
    setToggling(false);
  };

  const monitors = state?.monitors || [];
  const sectionClass = modern
    ? 'rounded-sg-lg border border-sg-border bg-sg-surface p-5 shadow-sg-card'
    : 'overflow-hidden border-2 border-brand-300 bg-white';
  const headingClass = modern
    ? 'text-base font-semibold text-sg-text'
    : 'text-sm font-black uppercase tracking-wider text-brand-900';
  const mutedClass = modern ? 'text-sm leading-6 text-sg-text-soft' : 'text-xs text-brand-500';

  return (
    <section className={sectionClass}>
      <div className={modern ? 'flex items-start justify-between gap-4' : 'border-b border-brand-200 bg-brand-50 px-4 py-3'}>
        <div>
          <p className={modern ? 'text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent' : 'text-[10px] font-black uppercase tracking-[0.2em] text-brand-500'}>
            Masaüstü ekranı
          </p>
          <h2 className={`mt-1 ${headingClass}`}>Müşteri ekranı monitörü</h2>
          <p className={`mt-1 ${mutedClass}`}>İkinci monitörde müşteri ekranının gösterileceği ekranı seçin.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleCustomerDisplay()}
            disabled={loading || toggling || (!state?.window_open && !state?.has_secondary_monitor)}
            className={modern
              ? 'inline-flex items-center gap-2 rounded-sg-md border border-sg-border px-3 py-2 text-sm font-medium text-sg-text-soft hover:bg-sg-surface-soft disabled:cursor-not-allowed disabled:opacity-50'
              : 'inline-flex items-center gap-1.5 border border-brand-300 px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50'}
          >
            {state?.window_open ? <X className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
            {toggling ? 'Uygulanıyor...' : state?.window_open ? 'Müşteri ekranını kapat' : 'Müşteri ekranını aç'}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || refreshing}
            className={modern
              ? 'inline-flex items-center gap-2 rounded-sg-md border border-sg-border px-3 py-2 text-sm font-medium text-sg-text-soft hover:bg-sg-surface-soft disabled:cursor-not-allowed disabled:opacity-50'
              : 'inline-flex items-center gap-1.5 border border-brand-300 px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50'}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      <div className={modern ? 'mt-4' : 'space-y-3 p-4'}>
        {error ? (
          <div className={modern ? 'mb-4 flex items-start gap-3 rounded-sg-md border border-sg-danger/30 bg-sg-danger-soft p-3 text-sm text-sg-danger-dark' : 'mb-3 flex items-start gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'}>
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? <p className={mutedClass}>Monitörler okunuyor...</p> : null}

        {!loading && state ? (
          <>
            <div className={modern ? 'mb-4 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3' : 'mb-3 border border-brand-200 bg-brand-50 px-3 py-2'}>
              <p className={modern ? 'text-sm font-semibold text-sg-text' : 'text-xs font-black text-brand-800'}>{selectionMessage(state)}</p>
              <p className={`mt-1 ${mutedClass}`}>Seçim anında kaydedilir ve açık müşteri penceresi yeni ekrana taşınır.</p>
            </div>

            {monitors.length === 0 ? (
              <p className={mutedClass}>Bağlı monitör bulunamadı.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {monitors.map((monitor, index) => {
                  const disabled = monitor.current || selecting !== null;
                  const cardClass = modern
                    ? `rounded-sg-md border p-4 text-left transition ${monitor.selected ? 'border-sg-accent bg-sg-accent-soft' : 'border-sg-border bg-sg-surface'} ${disabled && !monitor.selected ? 'cursor-not-allowed opacity-60' : 'hover:border-sg-accent'}`
                    : `border-2 p-3 text-left transition-colors ${monitor.selected ? 'border-brand-700 bg-brand-50' : 'border-brand-200 bg-white'} ${disabled && !monitor.selected ? 'cursor-not-allowed opacity-60' : 'hover:border-brand-500'}`;
                  return (
                    <button
                      key={monitor.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => void selectMonitor(monitor.id)}
                      className={cardClass}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <Monitor className={modern ? 'mt-0.5 h-5 w-5 text-sg-accent' : 'mt-0.5 h-4 w-4 text-brand-700'} />
                          <span className="min-w-0">
                            <span className={modern ? 'block truncate text-sm font-semibold text-sg-text' : 'block truncate text-xs font-black text-brand-900'}>{monitorLabel(monitor.name, index)}</span>
                            <span className={`mt-1 block ${mutedClass}`}>{monitor.width} × {monitor.height} · konum {monitor.x}, {monitor.y}</span>
                          </span>
                        </div>
                        {monitor.selected ? <Check className={modern ? 'h-5 w-5 flex-shrink-0 text-sg-accent' : 'h-4 w-4 flex-shrink-0 text-brand-700'} /> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {monitor.current ? <span className={modern ? 'rounded-full bg-sg-surface-soft px-2 py-1 text-[11px] text-sg-text-soft' : 'border border-brand-200 px-2 py-1 text-[10px] font-bold text-brand-500'}>CRM bu ekranda</span> : null}
                        {monitor.primary ? <span className={modern ? 'rounded-full bg-sg-surface-soft px-2 py-1 text-[11px] text-sg-text-soft' : 'border border-brand-200 px-2 py-1 text-[10px] font-bold text-brand-500'}>Ana ekran</span> : null}
                        {monitor.selected ? <span className={modern ? 'rounded-full bg-sg-accent px-2 py-1 text-[11px] text-white' : 'border border-brand-700 bg-brand-700 px-2 py-1 text-[10px] font-bold text-white'}>{selecting === monitor.id ? 'Uygulanıyor' : 'Müşteri ekranı'}</span> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
