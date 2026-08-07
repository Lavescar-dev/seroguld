import { LogPage } from '@/make/log/LogPage';
import { useLogMakeState } from '@/make/log/useLogMakeState';
import { createModernLogViewModel } from '@/modern/adapters';
import { ModernLogModule } from '@/modern/modules';
import { useUiVariant, useUiVariantBlocker } from '@/ui-variants';

export function AfgPage() {
  const state = useLogMakeState();
  const { variant } = useUiVariant();
  const viewModel = createModernLogViewModel(state);
  useUiVariantBlocker(viewModel.blocker);
  return variant === 'modern' ? <ModernLogModule viewModel={viewModel} /> : <LogPage {...state} />;
}
