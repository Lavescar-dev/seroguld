import { useUiVariant } from './UiVariantProvider';
import { UI_VARIANT_CLASSIC_BANNER_COPY } from './types';

export function ClassicDiscoveryBanner() {
  const { variant, isModernBannerDismissed, dismissModernBanner, requestVariantChange } =
    useUiVariant();

  if (variant !== 'classic' || isModernBannerDismissed) {
    return null;
  }

  return (
    <section className="border border-emerald-300 bg-emerald-50 px-5 py-4 text-emerald-950">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-700">
            {UI_VARIANT_CLASSIC_BANNER_COPY.title}
          </p>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            {UI_VARIANT_CLASSIC_BANNER_COPY.message}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismissModernBanner}
            className="border border-emerald-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-emerald-800 transition hover:bg-emerald-100"
          >
            {UI_VARIANT_CLASSIC_BANNER_COPY.dismissText}
          </button>
          <button
            type="button"
            onClick={() => requestVariantChange('modern')}
            className="border border-emerald-700 bg-emerald-700 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-white transition hover:bg-emerald-800"
          >
            {UI_VARIANT_CLASSIC_BANNER_COPY.actionText}
          </button>
        </div>
      </div>
    </section>
  );
}
