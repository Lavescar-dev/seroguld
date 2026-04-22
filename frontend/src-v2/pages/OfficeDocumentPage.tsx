import { MakeOfficeDocumentPage } from '@/make/office/OfficeDocumentPage';
import { useOfficeDocumentState } from '@/make/office/useOfficeDocumentState';

export function OfficeDocumentPage() {
  const state = useOfficeDocumentState();
  return <MakeOfficeDocumentPage {...state} />;
}
