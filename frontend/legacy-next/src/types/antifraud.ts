export interface AntiFraudRiskMeta {
  key: string;
  value: unknown;
}

export interface AntiFraudRiskReason {
  code: string;
  reason: string;
}

export interface AntiFraudHumanField {
  key: string;
  label: string;
  value: string;
}

export interface AntiFraudOrder {
  order_id: number;
  order_number: string;
  status: string;
  total?: string | null;
  currency?: string | null;
  date_created?: string | null;
  payment_method?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  ip_address?: string | null;
  billing_country?: string | null;
  shipping_country?: string | null;
  risk_score?: number | null;
  risk_level: 'high' | 'medium' | 'low' | 'unknown' | string;
  requires_manual_review: boolean;
  risk_meta: AntiFraudRiskMeta[];
  risk_reasons: AntiFraudRiskReason[];
  notes: string[];
  notes_human: string[];
  ai_explanations_human: string[];
  risk_meta_human: AntiFraudHumanField[];
}

export interface AntiFraudSummary {
  total_orders: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  unknown_risk_count: number;
  manual_review_count: number;
}

export interface AntiFraudOrdersResponse {
  source: string;
  generated_at: string;
  summary: AntiFraudSummary;
  items: AntiFraudOrder[];
}
