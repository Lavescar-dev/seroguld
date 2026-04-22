import type { MetalType, ProductStatus, ProductType } from './common';

export type PosSessionStatus = 'draft' | 'confirmed' | 'cancelled';
export type PosRateSource = 'live' | 'manual';
export type PosTradeSide = 'buy_from_customer' | 'sell_to_customer';
export type PosDocumentKind = 'afregningsbilag' | 'faktura';

export interface PosMetalRates {
  yellow_gold: string;
  white_gold: string;
  silver: string;
  platinum: string;
  palladium: string;
}

export interface PosSession {
  id: string;
  session_code: string;
  display_token: string;
  customer_id: string;
  customer_name?: string | null;
  trade_side: PosTradeSide;
  product_type?: ProductType | null;
  metal_type?: MetalType | null;
  weight_grams?: string | null;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  live_rate_dkk?: string | null;
  manual_rate_dkk?: string | null;
  active_rate_dkk?: string | null;
  rate_source: PosRateSource;
  margin_percent_internal: string;
  final_offer_dkk?: string | null;
  status: PosSessionStatus;
  created_at: string;
  updated_at: string;
  confirmed_at?: string | null;
}

export interface PosSessionLine {
  id: string;
  pos_session_id: string;
  line_no: number;
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage: string;
  rate_dkk?: string | null;
  margin_percent_internal: string;
  line_offer_dkk?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosDisplaySnapshot {
  session_code: string;
  status: PosSessionStatus;
  trade_side: PosTradeSide;
  document_kind?: PosDocumentKind | null;
  document_number?: string | null;
  customer_name?: string | null;
  product_type?: ProductType | null;
  metal_type?: MetalType | null;
  weight_grams?: string | null;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  rate_dkk?: string | null;
  final_offer_dkk?: string | null;
  line_count?: number;
  lines_total_dkk?: string | null;
  total_weight_grams?: string | null;
  total_pure_gold_grams?: string | null;
  lines?: PosDisplayLine[];
  updated_at: string;
}

export interface PosDisplayLine {
  line_no: number;
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage: string;
  rate_dkk?: string | null;
  line_offer_dkk?: string | null;
  notes?: string | null;
}

export interface PosConfirmResponse {
  session: PosSession;
  product_id: string;
  product_number: string;
  product_ids?: string[];
  product_numbers?: string[];
}

export interface PosNumberingPreview {
  product_number_next: string;
  reference_number_next: string;
  afregnings_number_next: string;
  invoice_number_next: string;
}

export interface PosTransactionLine {
  id: string;
  line_no: number;
  product_id?: string | null;
  product_number?: string | null;
  reference_number?: string | null;
  product_type?: string | null;
  metal_type?: string | null;
  weight_grams?: string | null;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  pure_gold_grams?: string | null;
  rate_dkk?: string | null;
  margin_percent: string;
  line_total_dkk: string;
  created_at: string;
}

export interface PosTransaction {
  id: string;
  pos_session_id: string;
  pos_document_sequence_no?: number | null;
  trade_side: string;
  status: string;
  customer_id?: string | null;
  clerk_user_id?: string | null;
  currency_code: string;
  gross_amount_dkk: string;
  net_amount_dkk: string;
  vat_rate_percent: string;
  vat_amount_dkk: string;
  notes?: string | null;
  created_at: string;
  confirmed_at?: string | null;
  lines: PosTransactionLine[];
}

export interface PosDocumentListItem {
  sequence_no: number;
  session_id: string;
  session_code: string;
  trade_side: string;
  status: string;
  document_type: string;
  document_kind: PosDocumentKind;
  document_title: string;
  document_number: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  currency_code: string;
  gross_amount_dkk: string;
  net_amount_dkk: string;
  vat_amount_dkk: string;
  line_count: number;
  total_weight_grams?: string | null;
  total_pure_gold_grams?: string | null;
  product_ids: string[];
  product_numbers: string[];
  product_status_counts: Partial<Record<ProductStatus, number>>;
  operation_state: 'awaiting_decision' | ProductStatus | 'mixed';
  has_locked_products: boolean;
  issued_at: string;
  confirmed_at?: string | null;
}

export interface PosDocumentDetailLine {
  id: string;
  line_no: number;
  product_id?: string | null;
  product_number?: string | null;
  reference_number?: string | null;
  product_type?: string | null;
  metal_type?: string | null;
  weight_grams?: string | null;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  pure_gold_grams?: string | null;
  rate_dkk?: string | null;
  margin_percent: string;
  line_total_dkk: string;
  product_status?: string | null;
  is_gdpr_locked: boolean;
  product_notes?: string | null;
  created_at: string;
}

export interface PosDocumentDetail {
  sequence_no: number;
  session_id: string;
  session_code: string;
  trade_side: string;
  status: string;
  document_type: string;
  document_kind: PosDocumentKind;
  document_title: string;
  document_number: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  currency_code: string;
  gross_amount_dkk: string;
  net_amount_dkk: string;
  vat_amount_dkk: string;
  line_count: number;
  total_weight_grams?: string | null;
  total_pure_gold_grams?: string | null;
  product_ids: string[];
  product_numbers: string[];
  product_status_counts: Partial<Record<ProductStatus, number>>;
  operation_state: 'awaiting_decision' | ProductStatus | 'mixed';
  has_locked_products: boolean;
  notes?: string | null;
  issued_at: string;
  confirmed_at?: string | null;
  lines: PosDocumentDetailLine[];
}
