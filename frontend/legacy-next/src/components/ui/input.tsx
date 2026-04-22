import { InputHTMLAttributes } from 'react';
import clsx from 'clsx';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm text-brand-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200',
        className,
      )}
      {...props}
    />
  );
}
