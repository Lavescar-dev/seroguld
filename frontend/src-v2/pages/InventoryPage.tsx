import { DepolamaPage as MakeDepolamaPage } from '@/make/depolama/DepolamaPage';
import { useDepolamaMakeState } from '@/make/depolama/useDepolamaMakeState';
import { createModernDepolamaViewModel } from '@/modern/adapters';
import { ModernDepolamaModule } from '@/modern/modules';
import { useUiVariant } from '@/ui-variants';

export function InventoryPage() {
  const depolamaState = useDepolamaMakeState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? (
    <ModernDepolamaModule viewModel={createModernDepolamaViewModel(depolamaState)} />
  ) : (
    <MakeDepolamaPage {...depolamaState} />
  );
}
