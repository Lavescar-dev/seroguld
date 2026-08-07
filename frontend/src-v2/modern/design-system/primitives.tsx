import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, Lock, type LucideIcon } from 'lucide-react';

import { cn } from './cn';

export type ModernTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
export type ModernActionTone = Exclude<ModernTone, 'neutral'> | 'ghost';

const badgeToneClasses: Record<ModernTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-600',
  primary: 'border-sky-200 bg-sky-50 text-sky-700',
  success: 'border-teal-200 bg-teal-50 text-teal-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
  info: 'border-cyan-200 bg-cyan-50 text-cyan-700',
};

const buttonToneClasses: Record<ModernActionTone, string> = {
  primary: 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700',
  success: 'border-teal-600 bg-teal-600 text-white hover:bg-teal-700',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
  danger: 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700',
  info: 'border-cyan-300 bg-cyan-50 text-cyan-900 hover:bg-cyan-100',
  ghost: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
};

const noticeToneClasses: Record<ModernTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-700',
  primary: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-teal-200 bg-teal-50 text-teal-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
  info: 'border-cyan-200 bg-cyan-50 text-cyan-900',
};

export function ModernPage({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex min-h-full flex-col gap-5 overflow-x-hidden rounded-[28px] bg-white/90 p-4 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 sm:p-6', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModernSection({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-[24px] border border-slate-200 bg-white/90 p-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] sm:p-5', className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function ModernSectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">{eyebrow}</p> : null}
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-2xl">{title}</h2>
        {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ModernCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModernBadge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: ModernTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.01em]',
        badgeToneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type CommonActionProps = {
  tone?: ModernActionTone;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  external?: boolean;
  children: ReactNode;
};

type ButtonLikeProps = CommonActionProps &
  (
    | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>)
    | ({ href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>)
  );

export function ModernButton(props: ButtonLikeProps) {
  const {
    tone = 'ghost',
    size = 'md',
    icon: Icon,
    trailingIcon: TrailingIcon,
    external,
    children,
    className: customClassName,
    ...rest
  } = props;
  const mergedClassName = cn(
    'inline-flex items-center justify-center gap-2 rounded-2xl border font-medium transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'min-h-9 px-3.5 text-xs' : 'min-h-11 px-4 text-sm',
    buttonToneClasses[tone],
    customClassName,
  );

  const content = (
    <>
      {Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      <span>{children}</span>
      {TrailingIcon ? (
        <TrailingIcon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      ) : external ? (
        <ArrowUpRight className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      ) : null}
    </>
  );

  if ('href' in props && props.href) {
    const { href, ...anchorProps } = rest as Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>;
    return (
      <a
        href={href}
        className={mergedClassName}
        target={external ? '_blank' : anchorProps.target}
        rel={external ? 'noreferrer noopener' : anchorProps.rel}
        {...anchorProps}
      >
        {content}
      </a>
    );
  }

  return (
    <button className={mergedClassName} type="button" {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {content}
    </button>
  );
}

export function ModernStat({
  label,
  value,
  meta,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: ModernTone;
  icon?: LucideIcon;
}) {
  return (
    <ModernCard className="flex min-h-[128px] flex-col justify-between bg-white">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        {Icon ? (
          <span className={cn('rounded-2xl p-2', badgeToneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">{value}</p>
        {meta ? <p className="mt-2 text-sm text-slate-500">{meta}</p> : null}
      </div>
    </ModernCard>
  );
}

export function ModernNotice({
  title,
  description,
  tone = 'info',
  icon,
  action,
}: {
  title: string;
  description: string;
  tone?: ModernTone;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-[20px] border p-4 sm:flex-row sm:items-start sm:justify-between', noticeToneClasses[tone])}>
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80">
          {icon ?? (tone === 'danger' ? <AlertTriangle className="h-5 w-5" /> : tone === 'success' ? <CheckCircle2 className="h-5 w-5" /> : tone === 'warning' ? <AlertTriangle className="h-5 w-5" /> : tone === 'primary' ? <Info className="h-5 w-5" /> : tone === 'neutral' ? <Lock className="h-5 w-5" /> : <Info className="h-5 w-5" />)}
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm leading-6 opacity-90">{description}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function ModernKeyValueList({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode; accent?: boolean }>;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl className={cn('grid gap-3', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3')}>
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</dt>
          <dd className={cn('mt-2 text-sm font-medium text-slate-700', item.accent && 'text-slate-950')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ModernToolbar({
  leading,
  trailing,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{leading}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{trailing}</div>
    </div>
  );
}

export function ModernTextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}

export function ModernTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}

export function ModernCheckboxField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {description ? <span className="mt-1 block text-sm text-slate-500">{description}</span> : null}
      </span>
    </label>
  );
}

export function ModernField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
