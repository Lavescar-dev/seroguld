'use client';

import { useMemo } from 'react';

type Props = {
  releaseDate: string;
  isLocked: boolean;
};

export function GDPRCountdown({ releaseDate, isLocked }: Props) {
  const { days, progress } = useMemo(() => {
    const now = new Date();
    const release = new Date(releaseDate);
    const msLeft = release.getTime() - now.getTime();
    const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    const totalWindowMs = 14 * 24 * 60 * 60 * 1000;
    const elapsed = totalWindowMs - msLeft;
    const pct = Math.max(0, Math.min(100, Math.round((elapsed / totalWindowMs) * 100)));
    return { days: daysLeft, progress: pct };
  }, [releaseDate]);

  const color = !isLocked ? 'bg-emerald-500' : progress > 66 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="w-40">
      <div className="mb-1 text-xs font-medium text-brand-700">
        {isLocked ? `${days} gün kaldı` : 'Serbest'}
      </div>
      <div className="h-2 w-full rounded-full bg-brand-100">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
