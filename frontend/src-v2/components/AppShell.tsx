import { MakeRoot } from '@/make/root/Root';
import { useRootMakeState } from '@/make/root/useRootMakeState';
import { ClassicDiscoveryBanner, useUiVariant } from '@/ui-variants';

import { ModernAppShell } from './ModernAppShell';

export function AppShell() {
  const state = useRootMakeState();
  const { variant } = useUiVariant();

  if (variant === 'modern') {
    return <ModernAppShell state={state} />;
  }

  return (
    <>
      <div className="fixed right-4 top-4 z-overlay-top w-[min(720px,calc(100vw-2rem))] shadow-xl">
        <ClassicDiscoveryBanner />
      </div>
      <MakeRoot {...state} />
    </>
  );
}
