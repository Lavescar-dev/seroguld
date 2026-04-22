import type { IdentityDocType, MetalType, ProductStatus, ProductType } from './common';

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  postal_code?: string | null;
  cpr_number_masked?: string | null;
  identity_doc_type?: IdentityDocType | null;
  identity_doc_number_masked?: string | null;
  identity_doc_country?: string | null;
  identity_photo_refs?: string[];
  is_active: boolean;
  created_at: string;
}

export interface CustomerDetail extends Customer {
  stats: {
    total_sold_to_shop: number;
    total_bought_from_shop: number;
    total_purchase_value_dkk: string;
    total_sale_value_dkk: string;
  };
  risk: {
    score: number;
    level: 'low' | 'medium' | 'high' | string;
    warnings: string[];
    transactions_30d: number;
    distinct_addresses_30d: number;
    distinct_identity_docs_30d: number;
    melted_items_30d: number;
  };
}

export interface CustomerWooImportResponse {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  deleted_mock_seed: number;
  imported_customer_ids: string[];
  errors: string[];
}

export interface CustomerPortalTransaction {
  product_id: string;
  product_number: string;
  reference_number?: string | null;
  side: 'sold_to_shop' | 'bought_from_shop';
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  amount_dkk: string;
  status: ProductStatus;
  transaction_at: string;
}

export interface CustomerPortalSummary {
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  total_transactions: number;
  sold_to_shop_count: number;
  bought_from_shop_count: number;
  sold_to_shop_value_dkk: string;
  bought_from_shop_value_dkk: string;
  active_site_listings_count: number;
  current_rates_dkk_per_gram: Record<string, string>;
  recent_transactions: CustomerPortalTransaction[];
}

export interface CustomerPortalProduct {
  id: string;
  product_number: string;
  reference_number?: string | null;
  side: 'sold_to_shop' | 'bought_from_shop';
  product_type: ProductType;
  metal_type: MetalType;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  status: ProductStatus;
  amount_dkk: string;
  transaction_at: string;
  is_published_to_site: boolean;
}
