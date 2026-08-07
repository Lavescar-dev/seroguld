import clsx from 'clsx';

import { useUiVariant } from './UiVariantProvider';
import { UI_VARIANT_LABELS, UI_VARIANT_SETTINGS_CARDS, type UiVariant } from './types';

function VariantCard({
  variant,
  activeVariant,
  onSelect,
}: {
  variant: UiVariant;
  activeVariant: UiVariant;
  onSelect: (variant: UiVariant) => void;
}) {
  const config = UI_VARIANT_SETTINGS_CARDS[variant];
  const isActive = variant === activeVariant;

  return (
    <article
      className={clsx(
        'flex h-full flex-col justify-between border px-5 py-5',
        isActive ? 'border-brand-700 bg-brand-50' : 'border-brand-200 bg-white',
      )}
    >
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-500">
          {config.eyebrow}
        </p>
        <h3 className="mt-2 text-base font-black text-brand-950">{UI_VARIANT_LABELS[variant]}</h3>
        <p className="mt-3 text-sm leading-6 text-brand-700">{config.description}</p>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-brand-200 pt-4">
        <span
          className={clsx(
            'text-xs font-black uppercase tracking-[0.24em]',
            isActive ? 'text-brand-800' : 'text-brand-500',
          )}
        >
          {isActive ? config.activeText : 'Hazır'}
        </span>
        {isActive ? null : (
          <button
            type="button"
            onClick={() => onSelect(variant)}
            className="border border-brand-700 bg-brand-700 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-white transition hover:bg-brand-800"
          >
            {config.actionText}
          </button>
        )}
      </div>
    </article>
  );
}

export function UiVariantSettingsCards({ className }: { className?: string }) {
  const { variant, requestVariantChange } = useUiVariant();

  return (
    <section className={className}>
      <div className="mb-4">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-brand-500">
          Arayüz deneyimi
        </p>
        <h2 className="mt-2 text-lg font-black text-brand-950">Klasik ve yeni görünüm arasında geçiş yapın</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <VariantCard variant="classic" activeVariant={variant} onSelect={requestVariantChange} />
        <VariantCard variant="modern" activeVariant={variant} onSelect={requestVariantChange} />
      </div>
    </section>
  );
}
