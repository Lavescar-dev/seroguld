import { MakeDisplayIdlePage } from '@/make/display/DisplayIdlePage';
import { useDisplayIdleMakeState } from '@/make/display/useDisplayIdleMakeState';

type DisplayIdlePageProps = {
  embedded?: boolean;
};

export function DisplayIdlePage({ embedded = false }: DisplayIdlePageProps) {
  const state = useDisplayIdleMakeState({ embedded });
  return <MakeDisplayIdlePage {...state} />;
}
