import {
  normalizeDesktopDisplayRoute,
  type DesktopDisplayWindowState,
} from '@/lib/desktop';
import { CustomerDisplayIdleView, CustomerDisplayLiveView } from '@/components/CustomerDisplayCanvas';
import type { PosDisplaySnapshot } from '@/types';

type MakeDisplayPreviewPageProps = {
  token: string;
  snapshot: PosDisplaySnapshot | null;
  connection: 'connecting' | 'live' | 'offline';
  desktopDisplayState?: DesktopDisplayWindowState | null;
  expectedDisplayRoute?: string | null;
  routeMatches?: boolean;
  onOpenCustomerDisplay?: () => void | Promise<void>;
  /** POST /api/v2/display/revoke — eski token geçersiz kalır, yenisi verilir. */
  onRevoke?: () => void;
  revokingToken?: boolean;
};

export function MakeDisplayPreviewPage({
  token,
  snapshot,
  connection,
  desktopDisplayState,
  expectedDisplayRoute,
  routeMatches = false,
  onOpenCustomerDisplay,
  onRevoke,
  revokingToken = false,
}: MakeDisplayPreviewPageProps) {
  const actualRoute = desktopDisplayState?.active_route ? normalizeDesktopDisplayRoute(desktopDisplayState.active_route) : '—';

  return (
    <div className="min-h-full bg-[#e7dfd2] px-6 py-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-2 border-amber-400 bg-amber-50 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Admin Preview</p>
          <h2 className="text-sm font-black uppercase tracking-wider text-brand-900">Müşteri Ekranı Önizlemesi</h2>
          <p className="mt-1 text-xs font-semibold text-amber-800">Gerçek müşteri ekranı değildir. Bu sayfa yalnız admin preview’dır.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex border px-2.5 py-1 text-xs font-black uppercase tracking-wider ${
              connection === 'live'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : connection === 'connecting'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-rose-300 bg-rose-50 text-rose-700'
            }`}
          >
            {connection === 'live' ? 'Canlı bağlı' : connection === 'connecting' ? 'Bağlanıyor' : 'Beklemede'}
          </span>
          <span
            className={`inline-flex border px-2.5 py-1 text-xs font-black uppercase tracking-wider ${
              routeMatches
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-rose-300 bg-rose-50 text-rose-700'
            }`}
          >
            {routeMatches ? 'Gerçek ekran bağlı' : 'Gerçek ekran eşleşmiyor'}
          </span>
          {token ? (
            <div className="border border-brand-300 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-500">Display token</p>
              <p className="mono mt-1 text-xs font-black text-brand-900">{token.slice(0, 16)}...</p>
            </div>
          ) : null}
          {expectedDisplayRoute && onOpenCustomerDisplay ? (
            <button
              type="button"
              onClick={onOpenCustomerDisplay}
              className="border border-brand-900 bg-brand-800 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-brand-900"
            >
              Gerçek ekranı aç / öne getir
            </button>
          ) : null}
          {onRevoke ? (
            <button
              type="button"
              onClick={onRevoke}
              disabled={!token || revokingToken}
              title={
                token
                  ? 'Açık müşteri ekranı bağlantısını keser ve yeni bir token üretir.'
                  : 'Geri alınacak aktif token yok.'
              }
              className="border border-rose-400 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {revokingToken ? 'Token geri alınıyor…' : 'Tokenı geri al'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="border border-brand-300 bg-white px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Admin Preview Durumu</p>
          <p className="mt-1 text-sm text-brand-800">
            {routeMatches
              ? 'Gerçek second-screen müşteri ekranı bu taslağa bağlı.'
              : desktopDisplayState?.window_open
                ? 'Gerçek second-screen pencere açık ama farklı route gösteriyor.'
                : 'Gerçek second-screen pencere şu an açık görünmüyor.'}
          </p>
          {!desktopDisplayState?.has_secondary_monitor ? (
            <p className="mt-2 text-xs font-semibold text-amber-700">İkinci monitör algılanmadı. Şu an yalnız admin preview’a bakıyor olabilirsiniz.</p>
          ) : null}
        </div>
        <div className="border border-brand-300 bg-white px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Display Route</p>
          <div className="mt-2 space-y-2 text-xs">
            <div>
              <p className="font-bold uppercase tracking-wider text-brand-500">Beklenen</p>
              <p className="mono mt-1 break-all font-black text-brand-900">{expectedDisplayRoute || '—'}</p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-brand-500">Açık Olan</p>
              <p className="mono mt-1 break-all font-black text-brand-900">{actualRoute}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden border-2 border-brand-300 bg-white shadow-[0_18px_45px_rgba(20,13,8,0.12)]">
        <div className="pointer-events-none absolute left-4 top-4 z-sticky border-2 border-amber-500 bg-amber-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-amber-900">
          Admin Preview
        </div>
        {snapshot ? <CustomerDisplayLiveView snapshot={snapshot} connection={connection} embedded /> : <CustomerDisplayIdleView embedded />}
      </div>

      {!snapshot ? (
        <div className="mt-3 border border-brand-300 bg-white px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Durum</p>
          <p className="mt-1 text-sm text-brand-700">Aktif snapshot bekleniyor. Preview sahnesi idle modunda acik tutuluyor.</p>
        </div>
      ) : null}
    </div>
  );
}
