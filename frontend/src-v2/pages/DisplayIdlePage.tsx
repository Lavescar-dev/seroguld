import { MakeDisplayIdlePage } from '@/make/display/DisplayIdlePage';
import { useDisplayIdleMakeState } from '@/make/display/useDisplayIdleMakeState';
import { useUiVariant } from '@/ui-variants';

type DisplayIdlePageProps = {
  embedded?: boolean;
};

export function DisplayIdlePage({ embedded = false }: DisplayIdlePageProps) {
  const state = useDisplayIdleMakeState({ embedded });
  const { variant } = useUiVariant();
  return (
    <div data-testid="customer-display-idle-page" data-display-ui-variant={variant}>
      <MakeDisplayIdlePage {...state} />
    </div>
  );
}
