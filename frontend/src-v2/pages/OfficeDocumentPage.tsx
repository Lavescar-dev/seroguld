import { MakeOfficeDocumentPage } from '@/make/office/OfficeDocumentPage';
import { useOfficeDocumentState } from '@/make/office/useOfficeDocumentState';
import { ModernOfficeSurface } from '@/modern/modules/ModernOfficeSurface';
import { useUiVariant } from '@/ui-variants';

export function OfficeDocumentPage() {
  const state = useOfficeDocumentState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? <ModernOfficeSurface state={state} mode="page" /> : <MakeOfficeDocumentPage {...state} />;
}
