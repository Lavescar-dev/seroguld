export interface WooManualSyncResult {
  ok: boolean;
  orders_scanned: number;
  line_items_scanned: number;
  processed: number;
  ignored: number;
}

export interface ReportSummary {
  period_start: string;
  period_end: string;
  purchased_count: number;
  sold_count: number;
  melted_count: number;
  total_purchase_value_dkk: string;
  total_sale_value_dkk: string;
  total_profit_dkk: string;
}
