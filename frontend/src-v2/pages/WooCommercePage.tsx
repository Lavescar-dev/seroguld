import { MakeWooCommercePage } from '@/make/woocommerce/WooCommercePage';
import { useWooMakeState } from '@/make/woocommerce/useWooMakeState';
import { ModernWooCommercePage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function WooCommercePage() {
  const state = useWooMakeState();
  const { variant } = useUiVariant();

  if (variant === 'modern') {
    return <ModernWooCommercePage state={state} />;
  }

  return <MakeWooCommercePage {...state} />;
}
