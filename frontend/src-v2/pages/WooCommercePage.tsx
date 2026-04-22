import { MakeWooCommercePage } from '@/make/woocommerce/WooCommercePage';
import { useWooMakeState } from '@/make/woocommerce/useWooMakeState';

export function WooCommercePage() {
  const state = useWooMakeState();
  return <MakeWooCommercePage {...state} />;
}
