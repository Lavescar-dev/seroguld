import type { OfficeDockDescriptor } from '@/lib/officeDock';

import { MakeOfficeDocumentPage } from './OfficeDocumentPage';
import { useOfficeDocumentState } from './useOfficeDocumentState';

type OfficeDockPanelProps = {
  document: OfficeDockDescriptor;
  onClose: () => void;
};

export function OfficeDockPanel({ document, onClose }: OfficeDockPanelProps) {
  const state = useOfficeDocumentState({
    kind: document.kind,
    artifactKey: document.key,
    disableReopen: true,
  });

  return <MakeOfficeDocumentPage {...state} layoutMode="dock" onClose={onClose} />;
}
