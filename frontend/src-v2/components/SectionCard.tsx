import type { PropsWithChildren, ReactNode } from 'react';

type SectionCardProps = PropsWithChildren<{
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}>;

export function SectionCard({ title, description, action, className = '', children }: SectionCardProps) {
  return (
    <section className={`rounded-[28px] border border-white/10 bg-[#191611]/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)] ${className}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[0.02em] text-white">{title}</h2>
          {description ? <p className="mt-1 text-sm text-brand-200/75">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
