'use client';

import type { PosDisplayLine } from '@/types';
import { mapPosDisplayLineToExcelView } from '@/lib/pos-mappers';

export type DisplayAnimatedLine = {
  key: string;
  line: PosDisplayLine;
  state: 'stable' | 'new' | 'updated' | 'removing';
};

type DisplayLinesTableProps = {
  lines: DisplayAnimatedLine[];
};

function stateBadge(state: DisplayAnimatedLine['state']) {
  if (state === 'new') {
    return (
      <span className="rounded-full border border-emerald-300/45 bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-100 md:text-sm">
        Yeni
      </span>
    );
  }

  if (state === 'updated') {
    return (
      <span className="rounded-full border border-amber-300/45 bg-amber-500/12 px-3 py-1 text-xs font-semibold text-amber-100 md:text-sm">
        Guncellendi
      </span>
    );
  }

  if (state === 'removing') {
    return (
      <span className="rounded-full border border-rose-300/45 bg-rose-500/12 px-3 py-1 text-xs font-semibold text-rose-100 md:text-sm">
        Siliniyor
      </span>
    );
  }

  return (
    <span className="rounded-full border border-[#6d5f49] bg-[#2b241b] px-3 py-1 text-xs font-semibold text-[#e5d6b7] md:text-sm">
      Stabil
    </span>
  );
}

function lineTone(state: DisplayAnimatedLine['state']) {
  if (state === 'new') return 'border-emerald-300/55 bg-[linear-gradient(135deg,rgba(10,52,38,0.92)_0%,rgba(18,28,22,0.96)_100%)] shadow-[0_18px_34px_rgba(7,61,43,0.24)]';
  if (state === 'updated') return 'border-amber-300/55 bg-[linear-gradient(135deg,rgba(66,44,18,0.92)_0%,rgba(26,20,15,0.96)_100%)] shadow-[0_18px_34px_rgba(100,66,16,0.22)]';
  if (state === 'removing') return 'border-rose-300/45 bg-[linear-gradient(135deg,rgba(71,24,24,0.88)_0%,rgba(28,16,17,0.95)_100%)] opacity-65';
  return 'border-[#453a2a] bg-[linear-gradient(135deg,#1d1812_0%,#17130f_100%)]';
}

export function DisplayLinesTable({ lines }: DisplayLinesTableProps) {
  return (
    <div className="overflow-hidden rounded-3xl border border-[#4c402f] bg-[#15120f] shadow-[0_18px_40px_rgba(0,0,0,0.42)]">
      <div className="border-b border-[#3f3524] bg-[#201912] px-5 py-4">
        <p className="text-base font-semibold uppercase tracking-[0.16em] text-[#d7bf8f] md:text-lg">Canli Kalemler</p>
        <p className="mt-1 text-sm text-[#b9a57f] md:text-base">Satirlar satici ekranindan anlik olarak buraya yansir.</p>
      </div>

      <div className="max-h-[calc(100vh-25rem)] space-y-3 overflow-y-auto p-4 md:space-y-4 md:p-5">
        {lines.map((item) => {
          const row = mapPosDisplayLineToExcelView(item.line);

          return (
            <article
              key={item.key}
              className={`rounded-[1.6rem] border p-4 shadow-[0_10px_24px_rgba(0,0,0,0.3)] transition-all duration-300 md:p-5 ${lineTone(item.state)}`}
            >
              <div className="grid gap-3 md:grid-cols-[100px,1.7fr,1.45fr,1.45fr,1.35fr] md:items-center">
                <div className="rounded-xl border border-[#5f5137] bg-[#2a2218] px-3 py-2 text-center">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#c9b487]">Satir</p>
                  <p className="mt-1 text-2xl font-bold text-[#f6e7c4] md:text-3xl">{row.lineNo}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#bca576]">Type / Metal</p>
                  <p className="mt-1 text-lg font-semibold text-[#f5efe1] md:text-2xl">
                    {row.typeLabel} <span className="mx-2 text-[#8f7f62]">•</span> {row.metalLabel}
                  </p>
                  <p className="mt-1 text-sm text-[#cdbb96] md:text-base">Excel type: {row.excelTypeLabel}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#bca576]">Karat / Finhed / Lodighed</p>
                  <p className="mt-1 text-lg font-semibold text-[#f5efe1] md:text-2xl">
                    {row.karatFinhed}
                  </p>
                  <p className="mt-1 text-sm text-[#cdbb96] md:text-base">Lodighed: {row.lodighed}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[#bca576]">Vaegt / Enhedspris</p>
                  <p className="mt-1 text-lg font-semibold text-[#f5efe1] md:text-2xl">
                    {row.weightText}
                  </p>
                  <p className="mt-1 text-sm text-[#cdbb96] md:text-base">{row.unitRateText}</p>
                </div>

                <div className="md:text-right">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#cfb982]">I alt</p>
                  <p className="mt-1 text-2xl font-bold text-[#f4d899] md:text-4xl">{row.totalText}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#3c3124] pt-3">
                <p className="text-sm text-[#d4c7ad] md:text-base">
                  <span className="font-semibold text-[#ebdfc7]">Not:</span> {row.notes || '-'}
                </p>
                {stateBadge(item.state)}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
