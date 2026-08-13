import { EmbeddedWorkbookSurface } from './EmbeddedWorkbookSurface';
import { useEmbeddedWorkbookState } from './useEmbeddedWorkbookState';

type EmbeddedWorkbookPanelProps = {
  kind: string;
  artifactKey: string;
  layoutMode?: 'page' | 'dock' | 'workspace';
  onClose?: () => void | Promise<void>;
  variant?: 'modern' | 'classic';
};

/**
 * Small composition wrapper used by every v2 workbook entry point. Keeping
 * the query/save/session state here means AFG, inventory and log all use the
 * same controlled grid and revision protocol.
 */
export function EmbeddedWorkbookPanel({ kind, artifactKey, layoutMode = 'page', onClose, variant = 'classic' }: EmbeddedWorkbookPanelProps) {
  const state = useEmbeddedWorkbookState(kind, artifactKey);
  return <EmbeddedWorkbookSurface {...state} layoutMode={layoutMode} onClose={onClose} variant={variant} />;
}
