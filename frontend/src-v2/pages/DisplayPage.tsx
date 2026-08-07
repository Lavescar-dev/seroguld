import { MakeDisplayPage } from '@/make/display/DisplayPage';
import { useDisplayLiveMakeState } from '@/make/display/useDisplayLiveMakeState';
import { useUiVariant } from '@/ui-variants';

export function DisplayPage() {
  const state = useDisplayLiveMakeState();
  const { variant } = useUiVariant();
  return (
    <div data-testid="customer-display-page" data-display-ui-variant={variant}>
      <MakeDisplayPage {...state} />
    </div>
  );
}
