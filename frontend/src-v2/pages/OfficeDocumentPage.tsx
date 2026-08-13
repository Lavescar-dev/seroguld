import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import { useParams } from 'react-router-dom';

export function OfficeDocumentPage() {
  const { kind = '', key = '' } = useParams<{ kind: string; key: string }>();
  return <EmbeddedWorkbookPanel kind={kind} artifactKey={key} layoutMode="page" />;
}
