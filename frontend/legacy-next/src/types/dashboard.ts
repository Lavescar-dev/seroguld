export interface DashboardSummary {
  total_products: number;
  locked_products: number;
  free_products: number;
  for_sale_products: number;
  sold_this_month: number;
  melted_this_month: number;
}

export interface DashboardProfit {
  monthly_profit_dkk: string;
  top_category: string | null;
  top_category_profit_dkk: string;
  melted_ratio_percent: string;
}

export interface DashboardStock {
  total_stock_value_dkk: string;
  today_change_dkk: string;
}

export interface DashboardCalendar {
  items: Array<{
    product_id: string;
    product_number: string;
    product_type: string;
    metal_type: string;
    gdpr_release_date: string;
    days_remaining: number;
  }>;
}

export interface DashboardAICost {
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost_usd: string;
  average_cost_per_request_usd: string;
  this_month_cost_usd: string;
  last_call_at?: string | null;
}

export interface DashboardOps {
  active_products: number;
  products_with_photo: number;
  products_without_photo: number;
  photo_coverage_percent: string;
  for_sale_without_photo: number;
  needs_cleaning_queue: number;
  pending_ai_description: number;
  pending_ai_approval: number;
  pending_publish: number;
  stale_gdpr_lock: number;
  ready_for_sale: number;
  avg_active_age_days: string;
  urgent_action_count: number;
}

export interface DashboardCharts {
  stock_flow_30d: Array<{
    day: string;
    stock_value_dkk: string;
    purchases_dkk: string;
    removals_dkk: string;
    net_change_dkk: string;
  }>;
  status_distribution: Array<{
    key: string;
    label: string;
    count: number;
  }>;
  active_metal_distribution: Array<{
    key: string;
    label: string;
    count: number;
  }>;
  monthly_profit_12m: Array<{
    month: string;
    profit_dkk: string;
    sold_count: number;
  }>;
}

export interface DashboardIntegrations {
  openai_configured: boolean;
  woocommerce_configured: boolean;
  wordpress_media_configured: boolean;
  webhook_secret_set: boolean;
  total_published_products: number;
  sync_success_24h: number;
  sync_failed_24h: number;
  last_sync_at?: string | null;
  backup_latest_at?: string | null;
  backup_recent_ok: boolean;
  backup_age_minutes?: number | null;
  offsite_enabled: boolean;
  offsite_last_sync_at?: string | null;
  offsite_recent_ok?: boolean | null;
  offsite_age_minutes?: number | null;
  restore_drill_last_at?: string | null;
  restore_drill_recent_ok: boolean;
  restore_drill_age_hours?: number | null;
}
