import { MakeExcelPreviewPage } from '@/make/excel/ExcelPreviewPage';
import { useExcelPreviewState } from '@/make/excel/useExcelPreviewState';

export function ExcelPreviewPage() {
  const state = useExcelPreviewState();
  return <MakeExcelPreviewPage {...state} />;
}
