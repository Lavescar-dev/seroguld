import { MakeDisplayPage } from '@/make/display/DisplayPage';
import { useDisplayLiveMakeState } from '@/make/display/useDisplayLiveMakeState';

export function DisplayPage() {
  const state = useDisplayLiveMakeState();
  return <MakeDisplayPage {...state} />;
}
