'use client';

import { Button } from '@/components/ui/button';

type DisplayHeaderProps = {
  buildTag?: string;
  tradeLabel: string;
  sessionCode?: string;
  statusLabel: string;
  documentKind?: string | null;
  documentNumber?: string | null;
  documentStateText?: string | null;
  connectionState: 'connecting' | 'live' | 'offline';
  updatedAtText: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
};

export function DisplayHeader({
  buildTag,
  tradeLabel,
  sessionCode,
  statusLabel,
  documentKind,
  documentNumber,
  documentStateText,
  connectionState,
  updatedAtText,
  isFullscreen,
  onToggleFullscreen,
}: DisplayHeaderProps) {
  const tradeTone =
    tradeLabel.toLowerCase().includes('sat')
      ? 'border-sky-300/45 bg-sky-500/15 text-sky-100'
      : 'border-amber-300/45 bg-amber-500/15 text-amber-100';

  const connectionTone =
    connectionState === 'live'
      ? 'border-emerald-400/55 bg-emerald-500/15 text-emerald-100'
      : connectionState === 'connecting'
        ? 'border-amber-400/55 bg-amber-500/15 text-amber-100'
        : 'border-red-400/55 bg-red-500/15 text-red-100';

  const connectionLabel =
    connectionState === 'live' ? 'Canli Bagli' : connectionState === 'connecting' ? 'Yeniden Baglaniyor' : 'Baglanti Kesildi';

  return (
    <header className="rounded-[2rem] border border-[#4f412f] bg-[linear-gradient(120deg,#1f1912_0%,#15120f_52%,#10141a_100%)] px-6 py-5 shadow-[0_24px_54px_rgba(0,0,0,0.42)] md:px-8 md:py-7">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#c5aa74] md:text-sm">Sero Guld POS</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#f8edcf] md:text-5xl">Musteri Ekrani</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#d8c8a7] md:text-lg">
            Satir bazli teklif ozeti, belge durumu ve toplamlar burada customer-safe olarak gosterilir.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-4 py-1.5 text-sm font-semibold md:text-base ${tradeTone}`}>{tradeLabel}</span>
            {buildTag ? (
              <span className="rounded-full border border-[#6a5739] bg-[#221d17] px-3 py-1 text-xs font-semibold text-[#d8c196]">
                UI: {buildTag}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm md:text-base">
          <span className={`rounded-full border px-4 py-2 font-semibold ${connectionTone}`}>{connectionLabel}</span>
          <Button
            type="button"
            onClick={onToggleFullscreen}
            className="rounded-full border border-[#7a6543] bg-[#2a2218] px-5 py-2 text-[#ecd8ab] hover:bg-[#342a1f]"
          >
            {isFullscreen ? 'Tam Ekrandan Cik' : 'Tam Ekran'}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 text-sm text-[#ccb995] md:grid-cols-4 md:text-base">
        <div className="rounded-2xl border border-[#3b3124] bg-[#1b1713] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#bca57a]">Oturum</p>
          <p className="mt-1 font-semibold text-[#f2e2be]">{sessionCode || '-'}</p>
        </div>
        <div className="rounded-2xl border border-[#3b3124] bg-[#1b1713] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#bca57a]">Durum</p>
          <p className="mt-1 font-semibold text-[#f2e2be]">{statusLabel}</p>
        </div>
        <div className="rounded-2xl border border-[#3b3124] bg-[#1b1713] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#bca57a]">Belge</p>
          <p className="mt-1 font-semibold text-[#f2e2be]">{documentKind || '-'}</p>
          <p className="mt-1 text-sm text-[#ccb995]">{documentNumber || '-'}</p>
          {documentStateText ? <p className="mt-1 text-xs text-[#aa9570]">{documentStateText}</p> : null}
        </div>
        <div className="rounded-2xl border border-[#3b3124] bg-[#1b1713] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#bca57a]">Son Guncelleme</p>
          <p className="mt-1 font-semibold text-[#f2e2be]">{updatedAtText}</p>
        </div>
      </div>
    </header>
  );
}
