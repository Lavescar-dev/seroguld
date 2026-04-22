import { MakeGdprPage } from '@/make/gdpr/GdprPage';
import { useGdprMakeState } from '@/make/gdpr/useGdprMakeState';

export function GdprPage() {
  const state = useGdprMakeState();
  return <MakeGdprPage {...state} />;
}
