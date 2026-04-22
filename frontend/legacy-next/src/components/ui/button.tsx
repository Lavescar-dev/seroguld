import { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ className, variant = 'primary', ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
        {
          'bg-brand-700 text-white hover:bg-brand-800': variant === 'primary',
          'bg-white text-brand-800 border border-brand-300 hover:bg-brand-50': variant === 'ghost',
          'bg-red-700 text-white hover:bg-red-800': variant === 'danger',
        },
        className,
      )}
      {...props}
    />
  );
}
