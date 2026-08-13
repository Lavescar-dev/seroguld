import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';

type ModernOfficeSurfaceProps = {
  state: { kind: string; artifactKey: string };
  mode?: 'page' | 'dock' | 'workspace';
  onClose?: () => void | Promise<void>;
  titleOverride?: string;
};

/** Modern workbook surface. The backend-controlled grid is shared by every route. */
export function ModernOfficeSurface({ state, mode = 'workspace', onClose }: ModernOfficeSurfaceProps) {
  return (
    <div className="flex min-h-0 h-full flex-1 flex-col overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-md">
      <EmbeddedWorkbookPanel kind={state.kind} artifactKey={state.artifactKey} layoutMode={mode} onClose={onClose} variant="modern" />
    </div>
  );
}
