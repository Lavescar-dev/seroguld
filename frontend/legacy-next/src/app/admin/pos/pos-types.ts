import {
  IdentityDocType,
  MetalType,
  PosTradeSide,
  ProductType,
} from '@/types';

export type CustomerMode = 'existing' | 'new';
export type SaleMode = 'inventory' | 'manual';
export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

export type QuoteFormState = {
  product_type: ProductType | '';
  metal_type: MetalType | '';
  weight_grams: string;
  purity_karat: string;
  purity_percentage: string;
  margin_percent_internal: string;
};

export type NewCustomerState = {
  name: string;
  phone: string;
  email: string;
  address: string;
  postal_code: string;
  cpr_number: string;
  identity_doc_type: IdentityDocType | '';
  identity_doc_number: string;
  identity_doc_country: string;
};

export type ConfirmFormState = {
  reference_number: string;
  storage_location: string;
  notes: string;
  needs_cleaning: boolean;
  sale_override_reason: string;
  sale_price_dkk: string;
  manual_purchase_cost_dkk: string;
};

export type PosBulkLineInput = {
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: number;
  purity_karat?: string;
  purity_percentage: number;
  rate_dkk?: number;
  margin_percent_internal?: number;
  notes?: string;
};

export type PosDisplayPreviewLineInput = {
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: number;
  purity_karat?: string;
  purity_percentage: number;
  rate_dkk?: number;
  margin_percent_internal?: number;
  line_offer_dkk?: number;
  notes?: string;
};

export type PosBulkDraftRow = {
  id: string;
  product_type: ProductType | '';
  metal_type: MetalType | '';
  weight_grams: string;
  purity_karat: string;
  purity_percentage: string;
  default_rate_dkk: string;
  rate_dkk: string;
  margin_percent_internal: string;
  notes: string;
};

export type PosMixDraftRow = {
  id: string;
  metal_type: MetalType | '';
  purity_karat: string;
  purity_percentage: string;
  weight_grams: string;
  notes: string;
};

export type PurityPreset = {
  value: string;
  purity: string;
  aliases: string[];
};

export type WizardStepMeta = {
  id: WizardStep;
  title: string;
  hint: string;
};

export type TradeSideSelection = PosTradeSide;
