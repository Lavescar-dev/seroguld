import { type ReactNode } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle,
  Database,
  FileText,
  HelpCircle,
  Layers,
  Package,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { formatMoney, formatNumber } from '@/lib/format';
import { getActiveLocale } from '@/i18n';
import { labelPaymentMethod, type DashboardData, type GdprReleaseItem } from './useDashboardMakeState';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

// lib/format ile aynı tek locale stratejisi: getActiveLocale tabanlı.
// (Eski hand-rolled uiLang() document.documentElement.lang'i fallback'siz
// okuyor, dil değişiminde sayılar tutarsızlaşıyordu.)
function intlLocale() {
  const locale = getActiveLocale();
  return locale === 'en' ? 'en-GB' : locale === 'da' ? 'da-DK' : 'tr-TR';
}

function fmtKr(value: number) {
  return formatMoney(value);
}

function fmtGram(value: number) {
  return formatNumber(value, ' g');
}

// Saatli lib/format formatDate yerine tablo için yalnız tarih; try/catch ölü
// koduydu (Date throw etmez) — geçersiz girdi Number.isNaN ile '—' olur.
function fmtDato(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function KpiCard({
  icon,
  title,
  value,
  sub,
  color = 'brand',
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value: string | number;
  sub?: string;
  color?: 'brand' | 'amber' | 'emerald' | 'red' | 'slate' | 'sky';
  onClick?: () => void;
}) {
  const colorMap = {
    brand: { border: 'border-brand-400', bg: 'bg-brand-50', icon: 'text-brand-700', value: 'text-brand-900', sub: 'text-brand-500' },
    amber: { border: 'border-amber-400', bg: 'bg-amber-50', icon: 'text-amber-700', value: 'text-amber-900', sub: 'text-amber-600' },
    emerald: { border: 'border-emerald-400', bg: 'bg-emerald-50', icon: 'text-emerald-700', value: 'text-emerald-900', sub: 'text-emerald-600' },
    red: { border: 'border-red-400', bg: 'bg-red-50', icon: 'text-red-700', value: 'text-red-900', sub: 'text-red-500' },
    slate: { border: 'border-slate-400', bg: 'bg-slate-50', icon: 'text-slate-600', value: 'text-slate-800', sub: 'text-slate-500' },
    sky: { border: 'border-sky-400', bg: 'bg-sky-50', icon: 'text-sky-700', value: 'text-sky-900', sub: 'text-sky-600' },
  } as const;

  const styles = colorMap[color];
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 border-2 px-4 py-3.5 ${styles.border} ${styles.bg} ${
        onClick ? 'cursor-pointer transition-all hover:brightness-95' : ''
      }`}
      style={sansStyle}
    >
      <span className={`flex-shrink-0 ${styles.icon}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black uppercase tracking-wider text-slate-500">{title}</p>
        <p className={`mt-0.5 truncate font-black ${styles.value}`} style={monoStyle}>
          {value}
        </p>
        {sub ? <p className={`mt-0.5 truncate text-xs ${styles.sub}`}>{sub}</p> : null}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b-2 border-brand-700 bg-brand-900 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-amber-400">{icon}</span>
        <span className="text-xs font-black uppercase tracking-widest text-brand-200">{title}</span>
      </div>
      {action}
    </div>
  );
}

// Pano hatası artık yutulmuyor: "strip" bayat veriyle birlikte üst şerit,
// "panel" ise ilk yükleme hatasındadır — sıfır dolu sahte pano YERİNE ayrı
// hata durumu olarak çizilir. Her iki varyantta da refetch ("Tekrar dene") var.
function DashboardErrorNotice({
  variant,
  message,
  isRetrying,
  onRetry,
}: {
  variant: 'strip' | 'panel';
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const isPanel = variant === 'panel';
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 border-red-700 bg-red-950 sm:flex-row sm:items-center sm:justify-between ${
        isPanel ? 'border-2 p-5' : 'border-b-2 px-4 py-3 sm:px-6'
      }`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-red-300">
            {/* Panel başlığı mevcut katalog anahtarını yeniden kullanır */}
            {isPanel ? 'Yönetim özeti yüklenemedi' : 'Pano güncellenemedi'}
          </p>
          <p className="mt-1 break-words text-xs text-red-100">{message}</p>
          {isPanel ? (
            <p className="mt-1 text-xs text-red-300">
              Sıfır değerlerle sahte pano gösterilmiyor; bağlantı düzelince veriler otomatik yenilenir.
            </p>
          ) : null}
        </div>
      </div>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="flex flex-shrink-0 items-center gap-1.5 border border-red-500/60 bg-red-900/40 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-red-200 transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
        {isRetrying ? 'Yükleniyor' : 'Tekrar dene'}
      </button>
    </div>
  );
}

// Sunucudan henüz veri gelmedi (ilk yükleme): sıfır dolu KPI'lar yerine
// nötr yükleme durumu gösterilir.
function DashboardLoadingPanel() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3" role="status">
      <RefreshCw className="h-6 w-6 animate-spin text-brand-500" />
      <p className="text-xs font-black uppercase tracking-widest text-brand-500">Pano verileri yükleniyor</p>
    </div>
  );
}

function DepoPieChart({ pieData }: { pieData: { name: string; gram: number; spot: number; color: string }[] }) {
  const total = pieData.reduce((sum, item) => sum + item.spot, 0);
  if (total === 0) return null;

  const cx = 90;
  const cy = 80;
  const outerR = 65;
  const innerR = 30;
  let startAngle = -Math.PI / 2;
  // SVG spec: yay başlangıç/bitiş noktaları çakışınca (açı = 2π) arc hiçbir
  // şey çizmez — tek kategori grafığı komple görünmez yapıyordu. Tam daire
  // iki yarımyay olarak çizilir.
  const FULL_CIRCLE = 2 * Math.PI - 1e-9;

  const slices = pieData.map((item) => {
    const angle = (item.spot / total) * 2 * Math.PI;
    let path: string;
    if (angle >= FULL_CIRCLE) {
      path = [
        `M ${cx + outerR} ${cy}`,
        `A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy}`,
        `A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy}`,
        `L ${cx - innerR} ${cy}`,
        `A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy}`,
        `A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy}`,
        'Z',
      ].join(' ');
    } else {
      const endAngle = startAngle + angle;
      const x1 = cx + outerR * Math.cos(startAngle);
      const y1 = cy + outerR * Math.sin(startAngle);
      const x2 = cx + outerR * Math.cos(endAngle);
      const y2 = cy + outerR * Math.sin(endAngle);
      const ix1 = cx + innerR * Math.cos(endAngle);
      const iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(startAngle);
      const iy2 = cy + innerR * Math.sin(startAngle);
      const large = angle > Math.PI ? 1 : 0;
      path = [
        `M ${x1} ${y1}`,
        `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
        `L ${ix1} ${iy1}`,
        `A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2}`,
        'Z',
      ].join(' ');
    }
    startAngle += angle;
    return { ...item, path };
  });

  return (
    <div className="flex flex-col items-center gap-2 px-2 pb-1 pt-2">
      <svg width={180} height={160} viewBox="0 0 180 160">
        {slices.map((slice) => (
          <path key={slice.name} d={slice.path} fill={slice.color} stroke="#fff" strokeWidth={2} />
        ))}
      </svg>
      <div className="flex w-full flex-wrap justify-center gap-x-3 gap-y-1 pb-1">
        {pieData.map((item) => (
          <div key={item.name} className="flex items-center gap-1">
            <span className="h-2 w-2 flex-shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-[10px] text-[#6b5a3e]" style={monoStyle}>
              {item.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyBarChart({ aylikAlis }: { aylikAlis: { ay: string; adet: number; kr: number }[] }) {
  if (aylikAlis.length === 0) return null;
  const W = 560;
  const H = 120;
  const padL = 44;
  const padR = 8;
  const padT = 8;
  const padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxKr = Math.max(...aylikAlis.map((item) => item.kr), 1);
  const barW = Math.max(8, (chartW / aylikAlis.length) * 0.55);
  const gap = chartW / aylikAlis.length;
  const ticks = Array.from({ length: 5 }, (_, index) => (maxKr * index) / 4);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {ticks.map((tick, index) => {
        const y = padT + chartH - (tick / maxKr) * chartH;
        const label = tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : `${Math.round(tick)}`;
        return (
          <g key={`tick-${index}`}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e8dcc8" strokeWidth={1} />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9a7e5a" style={monoStyle}>
              {label}
            </text>
          </g>
        );
      })}
      {aylikAlis.map((item, index) => {
        const bh = Math.max(2, (item.kr / maxKr) * chartH);
        const x = padL + index * gap + (gap - barW) / 2;
        const y = padT + chartH - bh;
        return (
          <g key={`bar-${item.ay}-${index}`}>
            <rect x={x} y={y} width={barW} height={bh} fill="#b8860b" rx={2} />
            <text x={x + barW / 2} y={H - padB + 14} textAnchor="middle" fontSize={10} fill="#9a7e5a" style={monoStyle}>
              {item.ay}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type MakeDashboardPageProps = {
  data: DashboardData;
  /** Aktif sorgunun son başarılı veri anı; veri hiç alınmadıysa null → yüzey "—" gösterir. */
  lastRefresh: Date | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  /** Classic sorgunun hatası (yüzeye çıkarılır); hata yoksa null. */
  errorMessage: string | null;
  /** Sunucudan hiç veri gelmediyse false → sıfır dolu pano yerine ayrı durum çizilir. */
  hasServerData: boolean;
  /** GDPR takvim yüzeyi (/api/dashboard/calendar); beslenmiyorsa kart hiç çizilmez. */
  gdprReleases?: { state: 'loading' | 'ready' | 'error'; items: GdprReleaseItem[] };
};

export function MakeDashboardPage({
  data,
  lastRefresh,
  isRefreshing,
  onRefresh,
  onNavigate,
  errorMessage,
  hasServerData,
  gdprReleases,
}: MakeDashboardPageProps) {
  const spotFark = data.depoSpotDeger - data.depoAlisDeger;
  const spotFarkPct = data.depoAlisDeger > 0 ? (spotFark / data.depoAlisDeger) * 100 : 0;
  const pieData = data.depoByCat.filter((item) => item.spot > 0);
  const opmcToplam = data.opmcYuksek + data.opmcOrta + data.opmcDusuk + data.opmcBelirsiz;

  return (
    <div className="min-h-full bg-brand-50" style={sansStyle}>
      <div className="flex flex-col justify-between gap-2 border-b-2 border-brand-800 bg-brand-950 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-amber-400" />
          <div>
            <h1 className="font-black tracking-wide text-white" style={monoStyle}>
              DASHBOARD
            </h1>
            <p className="text-xs text-brand-400">Genel bakış · Tüm modüllerden canlı veri</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span
            className={`inline-flex items-center gap-1 border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
              !hasServerData && errorMessage
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : isRefreshing
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-brand-700 bg-brand-900 text-brand-400'
            }`}
            style={monoStyle}
          >
            {!hasServerData && errorMessage ? 'Bağlantı hatası' : isRefreshing ? 'Canlı yenileniyor' : hasServerData ? 'Canlı bağlı' : 'Bağlanıyor'}
          </span>
          <p className="hidden text-xs text-brand-500 sm:block" style={monoStyle}>
            Son güncelleme: {lastRefresh ? lastRefresh.toLocaleTimeString(intlLocale()) : '—'}
          </p>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 border border-brand-600 px-3 py-1.5 text-xs font-bold text-brand-300 transition-colors hover:bg-brand-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Yükleniyor' : 'Yenile'}
          </button>
        </div>
      </div>

      {errorMessage && hasServerData ? (
        <DashboardErrorNotice variant="strip" message={errorMessage} isRetrying={isRefreshing} onRetry={onRefresh} />
      ) : null}

      {/* Sunucudan veri hiç gelmediyse sıfır dolu pano çizilmez: ilk yükleme
          hatası ayrı hata paneli, henüz yükleniyorsa nötr yükleme durumu. */}
      {hasServerData ? (
      <div className="space-y-4 p-3 sm:space-y-5 sm:p-5">
        <div className="overflow-hidden border-2 border-brand-300 bg-brand-900">
          <div className="flex items-center gap-2 border-b border-brand-700 px-4 py-2">
            <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-black uppercase tracking-widest text-brand-300">Spot Piyasa Fiyatları (DKK/g)</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-brand-700 sm:grid-cols-4">
            {[
              { symbol: 'Au', label: 'Altın 24K', price: data.goldPrice, color: 'text-amber-400', bg: 'bg-amber-900/30' },
              { symbol: 'Ag', label: 'Gümüş 999', price: data.silverPrice, color: 'text-slate-300', bg: 'bg-slate-800/40' },
              { symbol: 'Pt', label: 'Platin 999', price: data.platinPrice, color: 'text-zinc-300', bg: 'bg-zinc-800/30' },
              { symbol: 'Pd', label: 'Palladyum', price: data.palladyumPrice, color: 'text-sky-300', bg: 'bg-sky-900/30' },
            ].map((market) => (
              <div key={market.symbol} className="flex items-center gap-3 px-5 py-3">
                <span className={`px-2 py-1 text-sm font-black ${market.bg} ${market.color}`} style={monoStyle}>
                  {market.symbol}
                </span>
                <div>
                  <p className="text-xs font-bold text-brand-400">{market.label}</p>
                  <p className={`font-black ${market.color}`} style={monoStyle}>
                    {fmtKr(market.price)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            icon={<Package className="h-5 w-5" />}
            title="Alış Sayısı"
            value={data.alisSayisi}
            sub={fmtKr(data.alisToplamKr)}
            color="amber"
            // AFG alış listesi: modern varyantın purchase aktivite hedefiyle aynı.
            // '/' POS ekranıdır; liste görmek isteyen kasiyeri yanlış ekrana düşürüyordu.
            onClick={() => onNavigate('/log')}
          />
          <KpiCard
            icon={<Users className="h-5 w-5" />}
            title="Müşteriler"
            value={data.musteriSayisi}
            sub="Kayıtlı müşteri"
            color="brand"
            onClick={() => onNavigate('/musteriler')}
          />
          <KpiCard
            icon={<Database className="h-5 w-5" />}
            title="Depo Stoku"
            value={data.depoToplamItem}
            sub={`Spot: ${fmtKr(data.depoSpotDeger)}`}
            color="brand"
            onClick={() => onNavigate('/depolama')}
          />
          <KpiCard
            icon={<FileText className="h-5 w-5" />}
            title="Log Girişi"
            value={data.logSayisi}
            sub={`${data.ayirmaSayisi} ayrıştırma · ${data.eritmeSayisi} eritme`}
            color="slate"
            onClick={() => onNavigate('/log')}
          />
          <KpiCard
            icon={<ShieldAlert className="h-5 w-5" />}
            title="OPMC Risk"
            value={data.opmcYuksek > 0 ? `${data.opmcYuksek} Yüksek` : `${data.opmcOrta} Orta`}
            sub={`Manuel inceleme: ${data.opmcManuel}`}
            color={data.opmcYuksek > 0 ? 'red' : 'amber'}
            onClick={() => onNavigate('/opmc')}
          />
          <KpiCard
            icon={<Building2 className="h-5 w-5" />}
            title="Uniconta"
            value={`${data.faturaAdedi} Fatura`}
            sub={fmtKr(data.faturaToplamKr)}
            color="sky"
            onClick={() => onNavigate('/uniconta')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
          <div className="flex flex-col overflow-hidden border-2 border-brand-300 bg-white lg:col-span-1">
            <SectionHeader
              icon={<Database className="h-4 w-4" />}
              title="Depo Özeti"
              action={
                <button
                  onClick={() => onNavigate('/depolama')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Aç <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="grid grid-cols-2 divide-x divide-brand-200 border-b-2 border-brand-200">
              <div className="px-4 py-3">
                <p className="text-xs font-black uppercase tracking-wider text-brand-500">Spot Değer</p>
                <p className="mt-0.5 font-black text-brand-900" style={monoStyle}>
                  {fmtKr(data.depoSpotDeger)}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-black uppercase tracking-wider text-brand-500">Alış Değeri</p>
                <p className="mt-0.5 font-black text-brand-900" style={monoStyle}>
                  {fmtKr(data.depoAlisDeger)}
                </p>
              </div>
            </div>
            <div
              className={`flex items-center gap-2 border-b border-brand-200 px-4 py-2.5 ${
                spotFark >= 0 ? 'bg-emerald-50' : 'bg-red-50'
              }`}
            >
              {spotFark >= 0 ? (
                <TrendingUp className="h-4 w-4 flex-shrink-0 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 flex-shrink-0 text-red-600" />
              )}
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-slate-600">Spot Fark</span>
                <span
                  className={`ml-2 text-sm font-black ${spotFark >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                  style={monoStyle}
                >
                  {spotFark >= 0 ? '+' : ''}
                  {fmtKr(spotFark)}
                  <span className="ml-1.5 text-xs font-bold">
                    ({spotFarkPct >= 0 ? '+' : ''}
                    {spotFarkPct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            </div>
            {pieData.length > 0 ? (
              <div className="flex-1 px-2 pb-0 pt-2">
                <DepoPieChart pieData={pieData} />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center py-8 text-xs font-bold text-brand-400">Depo verisi yok</div>
            )}
            <div className="border-t border-brand-200">
              {data.depoByCat.map((cat) => (
                <div key={cat.name} className="flex items-center justify-between border-b border-brand-100 px-4 py-1.5 last:border-b-0 hover:bg-brand-50">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-none" style={{ backgroundColor: cat.color }} />
                    <span className="text-xs font-bold text-brand-700">{cat.name}</span>
                  </div>
                  <span className="text-xs font-black text-brand-800" style={monoStyle}>
                    {fmtGram(cat.gram)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col overflow-hidden border-2 border-brand-300 bg-white lg:col-span-2">
            <SectionHeader
              icon={<Package className="h-4 w-4" />}
              title="Son Alışlar"
              action={
                <button
                  onClick={() => onNavigate('/log')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Tümü <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            {data.sonAlislar.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-12 text-xs font-bold text-brand-400">Henüz alış kaydı yok</div>
            ) : (
              <>
                <div className="flex-1 overflow-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-brand-100">
                        <th className="whitespace-nowrap border border-brand-300 px-3 py-2 text-left text-xs font-black uppercase tracking-wider text-brand-600">
                          AFG Nr
                        </th>
                        <th className="border border-brand-300 px-3 py-2 text-left text-xs font-black uppercase tracking-wider text-brand-600">
                          Müşteri
                        </th>
                        <th className="border border-brand-300 px-3 py-2 text-left text-xs font-black uppercase tracking-wider text-brand-600">
                          Dato
                        </th>
                        <th className="border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-600">
                          Toplam
                        </th>
                        <th className="border border-brand-300 px-3 py-2 text-center text-xs font-black uppercase tracking-wider text-brand-600">
                          Ödeme
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sonAlislar.map((alis, index) => (
                        <tr
                          key={alis.id}
                          // Satır AFG listesine gider: hover tıklanabilir hissi
                          // verip ölü duruyordu (modern aktivite satırları gibi).
                          onClick={() => onNavigate('/log')}
                          className={`cursor-pointer transition-colors hover:bg-brand-50 ${
                            index % 2 === 1 ? 'bg-brand-50/40' : 'bg-white'
                          }`}
                        >
                          <td className="whitespace-nowrap border border-brand-200 px-3 py-2 font-black text-brand-800" style={monoStyle}>
                            {alis.afregningsnr}
                          </td>
                          <td className="max-w-[180px] truncate border border-brand-200 px-3 py-2 text-brand-700">
                            {alis.musteri}
                          </td>
                          <td className="whitespace-nowrap border border-brand-200 px-3 py-2 text-brand-600" style={monoStyle}>
                            {fmtDato(alis.dato)}
                          </td>
                          <td className="whitespace-nowrap border border-brand-200 px-3 py-2 text-right font-black text-brand-900" style={monoStyle}>
                            {fmtKr(alis.total)}
                          </td>
                          <td className="border border-brand-200 px-3 py-2 text-center">
                            {/* Ham 'bank'/'cash' enum'u ya da sabit 'Banka' değil:
                                backend ödeme yöntemi etiketi (nakit alışta Banka
                                yazan yanlış finansal bilgi düzeltildi). */}
                            <span className="border border-sky-300 bg-sky-100 px-1.5 py-0.5 text-xs font-black text-sky-700">
                              {labelPaymentMethod(alis.paymentMethod)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.aylikAlis.length > 0 ? (
                  <div className="border-t-2 border-brand-200 p-4">
                    <p className="mb-3 text-xs font-black uppercase tracking-wider text-brand-500">Aylık Alış (Son 6 Ay · DKK)</p>
                    <MonthlyBarChart aylikAlis={data.aylikAlis} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className="overflow-hidden border-2 border-brand-300 bg-white">
            <SectionHeader
              icon={<ShieldAlert className="h-4 w-4" />}
              title="OPMC Risk"
              action={
                <button
                  onClick={() => onNavigate('/opmc')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Aç <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="space-y-2 p-4">
              {[
                { label: 'Yüksek Risk', count: data.opmcYuksek, icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300' },
                { label: 'Orta Risk', count: data.opmcOrta, icon: <AlertCircle className="h-3.5 w-3.5" />, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300' },
                { label: 'Düşük Risk', count: data.opmcDusuk, icon: <CheckCircle className="h-3.5 w-3.5" />, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300' },
                { label: 'Belirsiz', count: data.opmcBelirsiz, icon: <HelpCircle className="h-3.5 w-3.5" />, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-300' },
              ].map((row) => (
                <div key={row.label} className={`flex items-center justify-between border px-3 py-2 ${row.border} ${row.bg}`}>
                  <div className={`flex items-center gap-2 ${row.color}`}>
                    {row.icon}
                    <span className="text-xs font-black">{row.label}</span>
                  </div>
                  <span className={`text-sm font-black ${row.color}`} style={monoStyle}>
                    {row.count}
                  </span>
                </div>
              ))}
              <div className="mt-3 flex items-center justify-between border border-purple-300 bg-purple-50 px-3 py-2">
                <span className="text-xs font-black text-purple-700">Manuel İnceleme</span>
                <span className="text-sm font-black text-purple-800" style={monoStyle}>
                  {data.opmcManuel}
                </span>
              </div>
              <p className="pt-1 text-xs text-brand-400">
                Toplam: <span className="font-black text-brand-700" style={monoStyle}>{opmcToplam}</span> siparis izleniyor
              </p>
            </div>
          </div>

          <div className="overflow-hidden border-2 border-brand-300 bg-white">
            <SectionHeader
              icon={<FileText className="h-4 w-4" />}
              title="Log & Eritme"
              action={
                <button
                  onClick={() => onNavigate('/log')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Aç <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-brand-200 bg-brand-50 px-3 py-2.5">
                  <p className="text-xs font-black uppercase tracking-wider text-brand-500">Log Girişi</p>
                  <p className="mt-0.5 font-black text-brand-900" style={monoStyle}>{data.logSayisi}</p>
                </div>
                <div className="border border-brand-200 bg-brand-50 px-3 py-2.5">
                  <p className="text-xs font-black uppercase tracking-wider text-brand-500">Ayrıştırma</p>
                  <p className="mt-0.5 font-black text-brand-900" style={monoStyle}>{data.ayirmaSayisi}</p>
                </div>
              </div>
              <div className="border border-orange-300 bg-orange-50 px-3 py-2.5">
                <p className="text-xs font-black uppercase tracking-wider text-orange-600">Eritme Lotu</p>
                <p className="mt-0.5 font-black text-orange-900" style={monoStyle}>{data.eritmeSayisi}</p>
              </div>
              {data.eritmeToplamHasAltin > 0 ? (
                <div className="space-y-1 border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-600">Toplam Finguld</span>
                    <span className="text-xs font-black text-amber-800" style={monoStyle}>{fmtGram(data.eritmeToplamHasAltin)}</span>
                  </div>
                  {data.eritmeToplamPayout > 0 ? (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-amber-600">Toplam Ödeme</span>
                      <span className="text-xs font-black text-amber-800" style={monoStyle}>{fmtKr(data.eritmeToplamPayout)}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden border-2 border-brand-300 bg-white">
            <SectionHeader
              icon={<ShoppingCart className="h-4 w-4" />}
              title="WooCommerce"
              action={
                <button
                  onClick={() => onNavigate('/woocommerce')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Aç <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="space-y-2 p-4">
              <p className="mb-3 text-xs font-bold text-brand-500">Depo stoğundaki ürünlerin shop durumu:</p>
              {[
                { label: "Shop'a Hazır", count: data.wooHazir, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: <CheckCircle className="h-3.5 w-3.5" /> },
                { label: 'Fotoğraf Eksik', count: data.wooFoto, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', icon: <AlertCircle className="h-3.5 w-3.5" /> },
                { label: 'Listelendi', count: data.wooLisitlendi, color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-300', icon: <Zap className="h-3.5 w-3.5" /> },
              ].map((row) => (
                <div key={row.label} className={`flex items-center justify-between border px-3 py-2 ${row.border} ${row.bg}`}>
                  <div className={`flex items-center gap-2 ${row.color}`}>
                    {row.icon}
                    <span className="text-xs font-black">{row.label}</span>
                  </div>
                  <span className={`text-sm font-black ${row.color}`} style={monoStyle}>{row.count}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border border-brand-200 bg-brand-50 px-3 py-2">
                <span className="text-xs font-black text-brand-600">Tanımsız</span>
                <span className="text-sm font-black text-brand-700" style={monoStyle}>
                  {data.depoToplamItem - data.wooHazir - data.wooFoto - data.wooLisitlendi}
                </span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden border-2 border-brand-300 bg-white">
            <SectionHeader
              icon={<Users className="h-4 w-4" />}
              title="Son Müşteriler"
              action={
                <button
                  onClick={() => onNavigate('/musteriler')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Tümü <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="divide-y divide-brand-100">
              {data.sonMusteriler.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-xs font-bold text-brand-400">Müşteri kaydı yok</div>
              ) : (
                data.sonMusteriler.map((customer) => {
                  const initials = customer.navn
                    .trim()
                    .split(' ')
                    .filter(Boolean)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();
                  return (
                    // Hover'ın vaat ettiği tıklama: müşteri kaydını açar.
                    <div
                      key={customer.id}
                      onClick={() => onNavigate('/musteriler')}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-brand-50"
                    >
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center bg-brand-800 text-xs font-black text-amber-400" style={monoStyle}>
                        {initials || '?'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-brand-800">{customer.navn}</p>
                        <p className="text-xs text-brand-500" style={monoStyle}>{fmtDato(customer.kayitTarihi)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Backend /api/dashboard/calendar artık pano yüzeyine bağlı: kilit
            süresi dolan (önümüzdeki 14 gün) ürünler satılabilir olduğu an
            kasiyerin gözünün önünde olur. */}
        {gdprReleases ? (
          <div className="overflow-hidden border-2 border-brand-300 bg-white">
            <SectionHeader
              icon={<ShieldAlert className="h-4 w-4" />}
              title="Yaklaşan GDPR serbest bırakma (14 gün)"
              action={
                <button
                  onClick={() => onNavigate('/depolama')}
                  className="flex items-center gap-1 text-xs font-bold text-brand-400 transition-colors hover:text-amber-400"
                >
                  Depolama <ArrowRight className="h-3 w-3" />
                </button>
              }
            />
            {gdprReleases.state === 'loading' ? (
              <div className="flex items-center justify-center py-6 text-xs font-bold text-brand-400">Yükleniyor…</div>
            ) : gdprReleases.state === 'error' ? (
              <div className="flex items-center justify-center py-6 text-xs font-bold text-red-600">GDPR takvimi alınamadı</div>
            ) : gdprReleases.items.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-xs font-bold text-brand-400">Önümüzdeki 14 günde kilit süresi dolan ürün yok</div>
            ) : (
              <div className="divide-y divide-brand-100">
                {gdprReleases.items.map((item) => (
                  <div
                    key={item.productId}
                    onClick={() => onNavigate('/depolama')}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-brand-50"
                  >
                    <span className="flex-shrink-0 font-black text-brand-800" style={monoStyle}>
                      {item.productNumber}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-brand-500" style={monoStyle}>
                      {fmtDato(item.releaseDate)}
                    </span>
                    <span
                      className={`flex-shrink-0 border px-1.5 py-0.5 text-xs font-black ${
                        item.daysRemaining <= 3
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-brand-200 bg-brand-50 text-brand-600'
                      }`}
                    >
                      {item.daysRemaining === 0 ? 'bugün' : `${item.daysRemaining} gün`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between border border-brand-200 bg-white px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-brand-400" />
            <span className="text-xs font-black uppercase tracking-wider text-brand-500">Sero Guld · Kuyumcu Yönetim Sistemi</span>
          </div>
          <span className="text-xs text-brand-400" style={monoStyle}>
            {new Date().toLocaleDateString(intlLocale())} — v{data.alisSayisi + data.depoToplamItem + data.musteriSayisi} kayıt
          </span>
        </div>
      </div>
      ) : errorMessage ? (
        <div className="p-3 sm:p-5">
          <DashboardErrorNotice variant="panel" message={errorMessage} isRetrying={isRefreshing} onRetry={onRefresh} />
        </div>
      ) : (
        <DashboardLoadingPanel />
      )}
    </div>
  );
}
