import type { MetalType, ProductStatus, ProductType } from './common';

export interface Product {
  id: string;
  product_number: string;
  reference_number?: string | null;
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  pure_gold_grams?: string | null;
  purchase_date: string;
  purchase_price_dkk: string;
  gold_rate_at_purchase?: string | null;
  commission: string;
  seller_customer_id?: string | null;
  seller_name?: string | null;
  gdpr_release_date: string;
  is_gdpr_locked: boolean;
  status: ProductStatus;
  sale_date?: string | null;
  sale_price_dkk?: string | null;
  buyer_customer_id?: string | null;
  buyer_name?: string | null;
  profit_dkk?: string | null;
  melt_date?: string | null;
  melt_reason?: string | null;
  ai_description?: string | null;
  ai_description_approved?: boolean;
  woocommerce_product_id?: number | null;
  is_published_to_site?: boolean;
  published_at?: string | null;
  photos?: Array<{
    id?: string | null;
    url: string;
    filename?: string | null;
    is_primary?: boolean;
    uploaded_at?: string | null;
    avif_url?: string | null;
    original_url?: string | null;
    mime_type?: string | null;
    size_bytes?: number | null;
  }>;
  notes?: string | null;
  storage_location?: string | null;
  primary_photo?: string | null;
  image?: string | null;
  unit_count?: number | null;
  total_weight_grams?: string | null;
  spot_value_dkk?: string | null;
  shop_sync_status?: string | null;
  length_cm?: string | null;
  width_mm?: string | null;
  thickness_mm?: string | null;
  producer?: string | null;
  needs_cleaning: boolean;
  manual_review_required?: boolean;
  manual_review_reasons?: string[];
  import_source_type?: string | null;
}

export interface ProductPublishResponse {
  wc_product_id: number;
  wc_permalink?: string | null;
  product: Product;
}

export interface ProductWooImportResponse {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  deleted_mock_seed: number;
  imported_product_ids: string[];
  errors: string[];
}

export interface ProductHistoryEntry {
  id: string;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  notes?: string | null;
  created_at: string;
}

export interface WooSyncLogEntry {
  id: string;
  action: string;
  wc_product_id?: number | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  status: 'success' | 'failed' | string;
  error_message?: string | null;
  created_at: string;
}

export interface WooProductRawSummary {
  id?: number;
  name?: string;
  slug?: string;
  permalink?: string;
  status?: string;
  catalog_visibility?: string;
  sku?: string;
  type?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  on_sale?: boolean;
  currency?: string;
  stock_status?: string;
  stock_quantity?: number | null;
  manage_stock?: boolean;
  backorders?: string;
  weight?: string;
  dimensions?: Record<string, unknown>;
  total_sales?: number | string;
  date_created?: string;
  date_modified?: string;
  short_description_text?: string;
  description_text?: string;
  categories?: Array<{ id?: number; name?: string; slug?: string }>;
  tags?: Array<{ id?: number; name?: string; slug?: string }>;
  attributes?: Array<{
    id?: number;
    name?: string;
    slug?: string;
    options?: string[];
    visible?: boolean;
    variation?: boolean;
  }>;
  images?: Array<{
    id?: number;
    src?: string;
    name?: string;
    alt?: string;
    is_primary?: boolean;
  }>;
}

export interface WooProductRawResponse {
  crm_product_id: string;
  crm_product_number: string;
  wc_product_id: number;
  fetched_at: string;
  summary: WooProductRawSummary;
  raw: Record<string, unknown>;
}
