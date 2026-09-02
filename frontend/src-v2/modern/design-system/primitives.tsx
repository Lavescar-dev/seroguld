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
  neutral: 'border-sg-border bg-sg-surface text-sg-text-soft',
  primary: 'border-sg-accent/20 bg-sg-accent-soft text-sg-accent-dark',
  success: 'border-sg-green/20 bg-sg-green-soft text-sg-green-strong',
  warning: 'border-sg-amber/20 bg-sg-amber-soft text-sg-amber',
  danger: 'border-sg-red/20 bg-sg-red-soft text-sg-red',
  info: 'border-sg-blue/20 bg-sg-blue-soft text-sg-accent-dark',
};

const buttonToneClasses: Record<ModernActionTone, string> = {
  primary: 'border-sg-accent bg-sg-accent text-white hover:bg-sg-accent-dark',
  success: 'border-sg-green bg-sg-green text-white hover:bg-sg-green-strong',
  warning: 'border-sg-amber/30 bg-sg-amber-soft text-sg-amber hover:bg-sg-amber-soft/70',
  danger: 'border-sg-red bg-sg-red text-white hover:bg-sg-red/90',
  info: 'border-sg-blue/30 bg-sg-blue-soft text-sg-accent-dark hover:bg-sg-blue-soft/70',
  ghost: 'border-sg-border bg-sg-surface text-sg-text hover:bg-sg-surface-soft',
};

const noticeToneClasses: Record<ModernTone, string> = {
  neutral: 'border-sg-border bg-sg-surface text-sg-text',
  primary: 'border-sg-accent/20 bg-sg-accent-soft text-sg-text',
  success: 'border-sg-green/20 bg-sg-green-soft text-sg-text',
  warning: 'border-sg-amber/20 bg-sg-amber-soft text-sg-text',
  danger: 'border-sg-red/20 bg-sg-red-soft text-sg-text',
  info: 'border-sg-blue/20 bg-sg-blue-soft text-sg-text',
};

export function ModernPage({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex min-h-full flex-col gap-5 overflow-x-hidden', className)}
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
      className={cn('rounded-sg-lg border border-sg-border bg-sg-surface p-4 shadow-sg-sm sm:p-5', className)}
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
    <div className="flex flex-col gap-4 border-b border-sg-border-soft pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">{eyebrow}</p> : null}
        <h2 className="mt-1 text-base font-semibold tracking-[-0.01em] text-sg-text sm:text-lg">{title}</h2>
        {description ? <p className="mt-1.5 text-sm leading-6 text-sg-text-soft">{description}</p> : null}
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
      className={cn('rounded-sg-md border border-sg-border bg-sg-surface-soft p-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModernBadge({
  tone = 'neutral',
  title,
  className,
  children,
}: {
  tone?: ModernTone;
  title?: string;
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
      title={title}
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
    'inline-flex items-center justify-center gap-2 rounded-sg-md border font-medium transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'min-h-9 px-3.5 text-xs' : 'min-h-10 px-4 text-sm',
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
    <ModernCard className="flex min-h-[112px] flex-col justify-between bg-sg-surface">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{label}</p>
        {Icon ? (
          <span className={cn('rounded-sg-md p-2', badgeToneClasses[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-[-0.02em] text-sg-text">{value}</p>
        {meta ? <p className="mt-1.5 text-sm text-sg-text-soft">{meta}</p> : null}
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
    <div className={cn('flex flex-col gap-3 rounded-sg-lg border-l-4 p-4 sm:flex-row sm:items-start sm:justify-between', noticeToneClasses[tone])}>
      <div className="flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sg-md bg-sg-surface/80">
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
        <div key={item.label} className="rounded-sg-md border border-sg-border-soft bg-sg-surface-soft/55 px-4 py-3.5">
          <dt className="text-[10px] font-medium uppercase tracking-[0.2em] text-sg-text-soft/80">{item.label}</dt>
          <dd className={cn('mt-2 text-[15px] font-normal leading-5 text-sg-text', item.accent && 'font-semibold text-sg-accent-dark')}>{item.value}</dd>
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
    <div className="flex flex-col gap-3 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-3 sm:flex-row sm:items-center sm:justify-between">
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
        'min-h-10 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3.5 text-sm text-sg-text outline-none transition placeholder:text-sg-text-soft/60 focus:border-sg-accent focus:ring-2 focus:ring-sg-accent-soft motion-reduce:transition-none',
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
        'min-h-[120px] w-full rounded-sg-md border border-sg-border bg-sg-surface px-3.5 py-3 text-sm text-sg-text outline-none transition placeholder:text-sg-text-soft/60 focus:border-sg-accent focus:ring-2 focus:ring-sg-accent-soft motion-reduce:transition-none',
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
    <label className={cn('flex items-start gap-3 rounded-sg-md border border-sg-border bg-sg-surface px-4 py-3', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-sg-border text-sg-accent focus:ring-sg-accent"
      />
      <span>
        <span className="block text-sm font-medium text-sg-text">{label}</span>
        {description ? <span className="mt-1 block text-sm text-sg-text-soft">{description}</span> : null}
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
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{label}</span>
      {children}
      {hint ? <span className="text-xs text-sg-text-soft">{hint}</span> : null}
    </label>
  );
}
