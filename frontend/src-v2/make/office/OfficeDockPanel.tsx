import type { OfficeDockDescriptor } from '@/lib/officeDock';

import { EmbeddedWorkbookPanel } from '../embedded/EmbeddedWorkbookPanel';

type OfficeDockPanelProps = {
  document: OfficeDockDescriptor;
  onClose: () => void;
};

export function OfficeDockPanel({ document, onClose }: OfficeDockPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EmbeddedWorkbookPanel kind={document.kind} artifactKey={document.key} layoutMode="dock" onClose={onClose} />
    </div>
  );
}
