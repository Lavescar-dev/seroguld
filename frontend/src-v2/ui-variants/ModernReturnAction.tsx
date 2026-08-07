import { useUiVariant } from './UiVariantProvider';
import { UI_VARIANT_MODERN_RETURN_TEXT } from './types';

export function ModernReturnAction({ className }: { className?: string }) {
  const { variant, requestVariantChange } = useUiVariant();

  if (variant !== 'modern') {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => requestVariantChange('classic')}
      className={className ?? 'border border-brand-700 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-brand-800 transition hover:bg-brand-50'}
    >
      {UI_VARIANT_MODERN_RETURN_TEXT}
    </button>
  );
}
