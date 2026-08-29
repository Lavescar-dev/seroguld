export type EditableCustomer = {
  name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
  city: string;
  cpr_number: string;
  identity_doc_type: string;
  identity_doc_number: string;
  identity_doc_country: string;
};

export type EditableGoldRow = {
  row_key: string;
  karat: string;
  label: string;
  lodighed: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};

export type EditableSilverRow = {
  row_key: string;
  type_code: string;
  label: string;
  lodighed: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};

export type EditableBarRow = {
  row_key: string;
  bar_type: 'gold' | 'silver';
  label: string;
  lodighed: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};

export type EditablePtPdRow = {
  row_key: string;
  metal: 'platinum' | 'palladium';
  label: string;
  lodighed: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};

// R2-01 — dinamik "Kniv / Çeyrek altın" satırı. Gümüş bölümünün altındaki
// sekmeden eklenir; sabit karat/bar tanımına oturmaz, kendi metal+karat
// bilgisini taşır. quarter = çeyrek altın (varsayılan 22K), kniv = gümüş.
export type EditableExtraRow = {
  row_key: string;
  kind: 'kniv' | 'quarter';
  label: string;
  metal: 'gold' | 'silver';
  karat: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};

export type PaymentMethod = 'bank';
export type CompanionMode = 'auto' | 'manual';
export type WorkspaceSurfaceView = 'system' | 'excel';

export type EditableWorkspaceNumbering = {
  afregnings_number_next: string;
  invoice_number_next: string;
};

export type EditableCalculatorRow = {
  row_key: string;
  unit_weight: string;
  count: string;
  total_weight: string;
  target_row_key: string;
};

export type EditableInvoiceGoldRow = {
  row_key: string;
  code: string;
  label: string;
  fineness: string;
  lodighed: string;
  gram: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};

export type EditableInvoiceMiscRow = {
  row_key: string;
  text: string;
  quantity: string;
  unit_price_dkk: string;
  line_total_dkk: string;
};
