import type { ReactNode } from 'react';

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'gold' | 'slate' | 'emerald';
  icon?: ReactNode;
};

export function StatCard({ label, value, hint, accent = 'gold', icon }: StatCardProps) {
  const tone =
    accent === 'emerald'
      ? 'border-emerald-400/25 bg-emerald-500/8'
      : accent === 'slate'
        ? 'border-white/10 bg-white/5'
        : 'border-amber-400/25 bg-amber-500/8';

  return (
    <div className={`rounded-3xl border ${tone} px-5 py-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)]`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-300">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-2 text-sm text-brand-200/75">{hint}</p> : null}
    </div>
  );
}
