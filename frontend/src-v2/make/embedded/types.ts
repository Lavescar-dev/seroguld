export type EmbeddedSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export type EmbeddedCellError = {
  message: string;
};

export type EmbeddedWorkbookCell = {
  cellRef: string;
  rowNumber?: number;
  value: string;
  editable: boolean;
  inputKind?: string;
  label?: string;
  formula?: boolean;
  colSpan?: number;
  rowSpan?: number;
  /** Excel'te gizli satır: grid'den düşmez, soluk basılır ve düzenlenemez. */
  hiddenRow?: boolean;
};

export type EmbeddedWorkbookSheet = {
  name: string;
  mode: string;
  systemSync: boolean;
  columns: string[];
  rows: Array<Array<EmbeddedWorkbookCell | null>>;
  note?: string | null;
};
