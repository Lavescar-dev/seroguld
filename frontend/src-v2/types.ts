export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  address?: string | null;
  cpr_number_masked?: string | null;
  is_active: boolean;
  must_change_password: boolean;
  password_changed_at?: string | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface DashboardSummary {
  total_products: number;
  locked_products: number;
  free_products: number;
  for_sale_products: number;
  sold_this_month: number;
  melted_this_month: number;
}

export interface StockValue {
  total_stock_value_dkk: string;
  today_change_dkk: string;
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

export interface MetalRates {
  yellow_gold: string;
  white_gold: string;
  silver: string;
  platinum: string;
  palladium: string;
}

export interface DesktopBootstrap {
  user: AppUser;
  app: {
    app_name: string;
    app_url: string;
    seller_name: string;
    seller_city: string;
    seller_country: string;
    currency_code: string;
  };
  navigation: {
    total_documents: number;
    pending_documents: number;
    total_inventory: number;
    total_customers: number;
    locked_products: number;
    pending_ai: number;
  };
  summary: DashboardSummary;
  stock_value: StockValue;
  ops: DashboardOps;
  integrations: DashboardIntegrations;
  market_rates: MetalRates;
}

export interface AuthTokenResponse {
  access_token: string;
  refresh_token: string;
  user: AppUser;
}

export interface AuthBootstrapState {
  email: string;
  initial_login_pending: boolean;
}

export interface CustomerOut {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  postal_code?: string | null;
  cpr_number?: string | null;
  cpr_number_masked?: string | null;
  identity_doc_type?: string | null;
  identity_doc_number?: string | null;
  identity_doc_number_masked?: string | null;
  identity_doc_country?: string | null;
  identity_photo_refs: string[];
  gdpr_status?: string;
  gdpr_pseudonymized_at?: string | null;
  marketing_opt_out_at?: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CustomerDetailOut extends CustomerOut {
  stats: {
    total_sold_to_shop: number;
    total_bought_from_shop: number;
    total_purchase_value_dkk: string;
    total_sale_value_dkk: string;
  };
  risk: {
    score: number;
    level: string;
    warnings: string[];
    transactions_30d: number;
    distinct_addresses_30d: number;
    distinct_identity_docs_30d: number;
    melted_items_30d: number;
  };
}

export interface ProductPhoto {
  id?: string | null;
  url: string;
  filename?: string | null;
  is_primary: boolean;
  uploaded_at?: string | null;
  avif_url?: string | null;
  original_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
}

export interface ProductOut {
  id: string;
  product_number: string;
  reference_number?: string | null;
  display_name?: string | null;
  product_type: string;
  metal_type: string;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  pure_gold_grams?: string | null;
  unit_count: number;
  total_weight_grams?: string | null;
  purchase_date: string;
  purchase_price_dkk: string;
  seller_name?: string | null;
  gdpr_release_date: string;
  is_gdpr_locked: boolean;
  status: string;
  updated_at?: string | null;
  sale_date?: string | null;
  sale_price_dkk?: string | null;
  buyer_name?: string | null;
  profit_dkk?: string | null;
  ai_description?: string | null;
  ai_description_approved: boolean;
  woocommerce_product_id?: number | null;
  is_published_to_site: boolean;
  published_at?: string | null;
  photos: ProductPhoto[];
  notes?: string | null;
  storage_location?: string | null;
  needs_cleaning: boolean;
  shop_price_dkk?: string | null;
  shop_sync_status?: string | null;
  length_cm?: string | null;
  width_mm?: string | null;
  thickness_mm?: string | null;
  producer?: string | null;
  inventory_category?: string | null;
  inventory_subcategory?: string | null;
  operation_destination?: string | null;
  operation_classification?: string | null;
  manual_review_required?: boolean;
  manual_review_reasons?: string[];
  import_source_type?: string | null;
}

export interface ProductPublishResponse {
  wc_product_id: number;
  wc_permalink?: string | null;
  product: ProductOut;
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
  status: string;
  error_message?: string | null;
  created_at: string;
}

export interface WooRawResponse {
  crm_product_id: string;
  crm_product_number: string;
  wc_product_id: number;
  fetched_at: string;
  summary?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
}

export interface WooWorkspaceSummary {
  total_products: number;
  published_products: number;
  draft_products: number;
  unpublished_products: number;
  photo_pending_products: number;
}

export interface WooWorkspace {
  summary: WooWorkspaceSummary;
  rows: InventoryGridRow[];
}

export interface PosSession {
  id: string;
  session_code: string;
  display_token: string;
  customer_id?: string | null;
  customer_name?: string | null;
  trade_side: 'buy_from_customer' | 'sell_to_customer';
  product_type?: string | null;
  metal_type?: string | null;
  weight_grams?: string | null;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  live_rate_dkk?: string | null;
  manual_rate_dkk?: string | null;
  active_rate_dkk?: string | null;
  rate_source: 'live' | 'manual';
  margin_percent_internal: string;
  final_offer_dkk?: string | null;
  status: 'draft' | 'confirmed' | 'cancelled';
  created_at: string;
  updated_at: string;
  confirmed_at?: string | null;
}

export interface PosSessionLine {
  id: string;
  pos_session_id: string;
  line_no: number;
  product_type: string;
  metal_type: string;
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

export interface PosNumberingPreview {
  product_number_next: string;
  reference_number_next: string;
  afregnings_number_next: string;
  invoice_number_next: string;
}

export interface PosConfirmResponse {
  session: PosSession;
  product_id: string;
  product_number: string;
  product_ids: string[];
  product_numbers: string[];
}

export interface PosDocumentListItem {
  sequence_no: number;
  session_id: string;
  session_code: string;
  trade_side: string;
  status: string;
  document_type: string;
  document_kind: string;
  document_title: string;
  document_number: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  currency_code: string;
  gross_amount_dkk: string;
  net_amount_dkk: string;
  vat_rate_percent: string;
  vat_amount_dkk: string;
  line_count: number;
  total_weight_grams?: string | null;
  total_pure_gold_grams?: string | null;
  product_ids: string[];
  product_numbers: string[];
  product_status_counts: Record<string, number>;
  operation_state: string;
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

export interface PosDocumentDetail extends PosDocumentListItem {
  customer_address?: string | null;
  customer_postal_code?: string | null;
  customer_city?: string | null;
  customer_cpr?: string | null;
  customer_cpr_masked?: string | null;
  customer_identity_doc_number?: string | null;
  customer_identity_doc_number_masked?: string | null;
  bank_reg_number?: string | null;
  bank_account_number?: string | null;
  notes?: string | null;
  payment_method?: 'bank' | null;
  market_rates: PosWorkspaceMarketRates;
  numbering_preview: PosWorkspaceNumbering;
  invoice_gold: PosWorkspaceInvoiceGoldSheet;
  invoice_misc: PosWorkspaceInvoiceMiscSheet;
  can_edit: boolean;
  can_delete: boolean;
  lines: PosDocumentDetailLine[];
}

export interface AfgWorkspaceLine {
  id: string;
  transaction_id: string;
  document_sequence_no: number;
  document_number: string;
  session_id: string;
  session_code: string;
  line_no: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  issued_at: string;
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
  operation_destination?: string | null;
  operation_classification?: string | null;
  is_gdpr_locked: boolean;
  product_notes?: string | null;
  created_at: string;
}

export interface AfgWorkspaceDocument {
  sequence_no: number;
  document_number: string;
  session_id: string;
  document_kind: string;
  document_title: string;
  status: string;
  trade_side: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  issued_at: string;
  confirmed_at?: string | null;
  gross_amount_dkk: string;
  net_amount_dkk: string;
  total_weight_grams: string;
  total_pure_gold_grams: string;
  line_count: number;
  operation_state: string;
  has_locked_products: boolean;
  lines: AfgWorkspaceLine[];
}

export interface AfgWorkspaceSummary {
  total_documents: number;
  awaiting_documents: number;
  inventory_documents: number;
  undecided_documents: number;
  melted_documents: number;
  total_amount_dkk: string;
  total_pure_gold_grams: string;
}

export interface AfgWorkspace {
  summary: AfgWorkspaceSummary;
  gold_documents: AfgWorkspaceDocument[];
  silver_documents: AfgWorkspaceDocument[];
}

export interface AfgRouteResponse {
  processed_line_ids: string[];
  product_ids: string[];
  statuses: Record<string, number>;
}

export interface LogBucketSummary {
  total_documents: number;
  total_lines: number;
  awaiting_lines: number;
  routed_lines: number;
  split_line_count: number;
  melt_line_count: number;
  melt_lot_count: number;
  total_weight_grams: string;
  total_pure_gold_grams: string;
  total_amount_dkk: string;
}

export interface LogSplitGroup {
  key: 'standard' | 'jewelry_cleaning' | 'white_gold' | 'separate_storage';
  label: string;
  line_count: number;
  total_weight_grams: string;
  total_pure_gold_grams: string;
  total_amount_dkk: string;
  document_numbers: string[];
}

export interface LogMeltQueue {
  line_count: number;
  total_weight_grams: string;
  total_pure_gold_grams: string;
  total_amount_dkk: string;
  earliest_purchase_date?: string | null;
  latest_purchase_date?: string | null;
  document_numbers: string[];
}

export interface LogMeltLot {
  id: string;
  metal_bucket: 'gold' | 'silver';
  sent_date: string;
  purchased_from_date?: string | null;
  before_weight_grams: string;
  before_amount_dkk: string;
  before_pure_gold_grams: string;
  after_pure_gold_grams: string;
  insurance_dkk: string;
  shipping_dkk: string;
  refining_dkk: string;
  sale_date?: string | null;
  quote_eur?: string | null;
  exchange_rate_dkk: string;
  payout_total_dkk?: string | null;
  notes?: string | null;
  cost_total_dkk: string;
  estimated_sale_value_dkk?: string | null;
  net_after_costs_dkk?: string | null;
  bridge_difference_dkk?: string | null;
  advance_per_gram_dkk?: string | null;
  status?: string;
  finalized_at?: string | null;
  finalized_by_user_id?: string | null;
  line_count?: number;
  created_at: string;
  updated_at: string;
}

export interface LogMeltLotHistory {
  id: string;
  lot_id: string;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  performed_by?: string | null;
  performed_by_email?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface LogMeltLotLine {
  line_id: string;
  document_sequence_no: number;
  document_number: string;
  line_no: number;
  weight_grams?: string | null;
  pure_gold_grams?: string | null;
  line_total_dkk?: string | null;
  customer_name?: string | null;
  product_number?: string | null;
  reference_number?: string | null;
}

export interface LogRouteBatchApplyResponse {
  workspace: LogWorkspace;
  succeeded: number;
  failed: number;
  failures: Array<{ line_id: string; error: string }>;
}

export interface LogBucketWorkspace {
  metal_bucket: 'gold' | 'silver';
  summary: LogBucketSummary;
  documents: AfgWorkspaceDocument[];
  split_groups: LogSplitGroup[];
  melt_queue: LogMeltQueue;
  melt_lots: LogMeltLot[];
}

export interface LogWorkspace {
  summary: AfgWorkspaceSummary;
  gold: LogBucketWorkspace;
  silver: LogBucketWorkspace;
}

export interface InventoryMarketPrices {
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
}

export interface InventoryWorkspaceSummary {
  total_items: number;
  total_purchase_value_dkk: string;
  total_spot_value_dkk: string;
  total_pure_metal_grams: string;
  total_fine_silver_grams: string;
  total_gold_related_grams: string;
}

export interface InventoryGridRow {
  id: string;
  product_number: string;
  reference_number?: string | null;
  main_category: string;
  subcategory?: string | null;
  product_type: string;
  metal_type: string;
  status: string;
  operation_destination?: string | null;
  operation_classification?: string | null;
  lager_dato: string;
  urun: string;
  saflik_label: string;
  purity_percentage?: string | null;
  birim_gram: string;
  adet: number;
  toplam_gram: string;
  has_metal_grams?: string | null;
  alis_fiyati_dkk: string;
  spot_degeri_dkk: string;
  shop_fiyati_dkk?: string | null;
  shop_sync_status?: string | null;
  is_published_to_site: boolean;
  length_cm?: string | null;
  width_mm?: string | null;
  thickness_mm?: string | null;
  producer?: string | null;
  storage_location?: string | null;
  needs_cleaning: boolean;
  is_gdpr_locked: boolean;
  primary_photo?: string | null;
  photo_count: number;
  has_ai_description: boolean;
  ai_description_approved: boolean;
  notes?: string | null;
}

export interface InventoryWorkspace {
  market_prices: InventoryMarketPrices;
  summary: InventoryWorkspaceSummary;
  rows: InventoryGridRow[];
}

export interface ProductHistoryEntry {
  id: string;
  product_id: string;
  action: string;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  performed_by?: string | null;
  performed_by_email?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface ProductSourceAfg {
  pos_session_id: string;
  sequence_no?: number | null;
  document_number?: string | null;
  issued_at?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  line_no?: number | null;
  line_weight_grams?: string | null;
  line_pure_gold_grams?: string | null;
  line_total_dkk?: string | null;
  rate_dkk?: string | null;
  transaction_id?: string | null;
}

export interface DocumentArtifactRecord {
  id: string;
  artifact_key: string;
  module_name: string;
  document_type: string;
  business_key: string;
  version_kind: string;
  is_live: boolean;
  file_name: string;
  mime_type: string;
  template_name?: string | null;
  size_bytes: number;
  checksum_sha256?: string | null;
  workbook_revision?: string | null;
  base_revision?: string | null;
  crm_revision?: string | null;
  conflict_state?: string | null;
  revision?: number;
  updated_at: string;
}

export interface DocumentArtifactSheetPreview {
  name: string;
  mode: string;
  system_sync: boolean;
  columns: string[];
  rows: string[][];
  note?: string | null;
}

export interface DocumentArtifactEditableCell {
  sheet: string;
  cell_ref: string;
  label: string;
  input_kind: string;
}

export interface DocumentArtifactCellEdit {
  sheet: string;
  cell_ref: string;
  value?: string | null;
}

export interface DocumentArtifactCellChange {
  field_id?: string | null;
  sheet: string;
  cell_ref: string;
  label: string;
  old_value: string;
  new_value: string;
}

export interface DocumentArtifactCellError {
  sheet: string;
  cell_ref: string;
  message: string;
}

export interface DocumentArtifactCellsPatchOut {
  revision: number;
  status: 'applied' | 'rejected';
  applied_changes: Array<{ sheet: string; cell_ref: string; value: string }>;
  warnings: string[];
  cell_errors: DocumentArtifactCellError[];
}

export interface DocumentArtifactReconcilePreview {
  editable: boolean;
  changes: DocumentArtifactCellChange[];
  warnings: string[];
  blocking_errors?: string[];
}

export interface DocumentArtifactPreview {
  title: string;
  subtitle?: string | null;
  contract_version?: string;
  artifact?: DocumentArtifactRecord | null;
  revision?: number;
  download_path: string;
  module_route?: string | null;
  import_supported: boolean;
  external_edit_supported: boolean;
  editable_cells: DocumentArtifactEditableCell[];
  sheets: DocumentArtifactSheetPreview[];
}

export interface OfficeDocumentLaunch {
  kind: string;
  key: string;
  launch_mode?: 'embedded-workbook' | 'download' | string;
  provider: string;
  provider_label: string;
  provider_branding_level: string;
  title: string;
  subtitle?: string | null;
  contract_version?: string;
  module_route?: string | null;
  fallback_route: string;
  download_path: string;
  artifact?: DocumentArtifactRecord | null;
  can_write: boolean;
  import_supported: boolean;
  sheets: DocumentArtifactSheetPreview[];
  office_available: boolean;
  office_reason?: string | null;
  editor_url?: string | null;
  access_token?: string | null;
  access_token_ttl?: number | null;
}

export interface OfficeDocumentStatus {
  kind: string;
  key: string;
  provider: string;
  provider_label: string;
  provider_branding_level: string;
  contract_version?: string;
  artifact?: DocumentArtifactRecord | null;
  can_write: boolean;
  import_supported: boolean;
  office_available: boolean;
  live_sync_state?: 'idle' | 'pending' | 'syncing' | 'applied' | 'rejected' | 'error';
  live_sync_message?: string | null;
  last_callback_at?: string | null;
  launch_revision?: number | null;
  applied_revision?: number | null;
  last_requested_save_id?: number;
  last_applied_save_id?: number;
}

export interface OfficeRuntimeStatus {
  provider: string;
  provider_label: string;
  provider_branding_level: string;
  runtime_available: boolean;
  discovery_cached: boolean;
  last_discovery_checked_at?: string | null;
  runtime_url: string;
  wopi_base_url: string;
  callback_base_url?: string | null;
  reason?: string | null;
}

export interface DesktopDevSessionStatus {
  mode: string;
  started_at: string;
  backend_url: string;
  frontend_url: string;
  frontend_mode: string;
  tauri_mode: string;
  backend_pid?: number | null;
  frontend_pid?: number | null;
  tauri_pid?: number | null;
}

export interface RuntimeStatus {
  app_name: string;
  env: string;
  backend_pid: number;
  backend_started_at: string;
  backend_url: string;
  office_runtime_url: string;
  office_wopi_base_url: string;
  desktop_session?: DesktopDevSessionStatus | null;
}

export interface PosDisplayLine {
  line_no: number;
  product_type: string;
  metal_type: string;
  weight_grams: string;
  purity_karat?: string | null;
  purity_percentage: string;
  type_label?: string | null;
  lodighed?: string | null;
  rate_dkk?: string | null;
  unit_price_dkk?: string | null;
  line_offer_dkk?: string | null;
  notes?: string | null;
}

export interface PosDisplaySnapshot {
  session_code: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  trade_side: 'buy_from_customer' | 'sell_to_customer';
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_postal_code?: string | null;
  customer_city?: string | null;
  customer_cpr?: string | null;
  customer_cpr_masked?: string | null;
  customer_identity_doc_number?: string | null;
  customer_identity_doc_number_masked?: string | null;
  preview_sequence?: number | null;
  workspace_revision?: number;
  product_type?: string | null;
  metal_type?: string | null;
  weight_grams?: string | null;
  purity_karat?: string | null;
  purity_percentage?: string | null;
  rate_dkk?: string | null;
  final_offer_dkk?: string | null;
  line_count: number;
  lines_total_dkk?: string | null;
  total_weight_grams?: string | null;
  total_pure_gold_grams?: string | null;
  document_kind?: string | null;
  document_number?: string | null;
  gold_rows?: PosWorkspaceGoldRow[];
  silver_rows?: PosWorkspaceSilverRow[];
  lines: PosDisplayLine[];
  updated_at: string;
}

export interface PosDisplayPreview {
  display_token?: string | null;
  snapshot?: PosDisplaySnapshot | null;
}

export interface PosWorkspaceBankInfo {
  reg_number?: string | null;
  account_number?: string | null;
}

export interface PosWorkspaceRateMatrixEntry {
  row_key: string;
  label: string;
  lodighed: string;
  eur_per_gram: string;
  dkk_per_gram: string;
  karat?: string | null;
  type_code?: string | null;
}

export interface PosWorkspaceMarketRates {
  eur_dkk_fx: string;
  gold_rates_eur: Record<string, string>;
  silver_rates_eur: Record<string, string>;
  gold_24k_dkk: string;
  silver_dkk: string;
  gold_matrix: PosWorkspaceRateMatrixEntry[];
  silver_matrix: PosWorkspaceRateMatrixEntry[];
}

export interface PosWorkspaceNumbering {
  product_number_next: string;
  reference_number_next: string;
  afregnings_number_next: string;
  invoice_number_next: string;
}

export interface PosWorkspaceInvoiceGoldRow {
  row_key: string;
  code?: string | null;
  label?: string | null;
  fineness?: string | null;
  lodighed?: string | null;
  gram: string;
  unit_price_dkk: string;
  line_total_dkk: string;
}

export interface PosWorkspaceInvoiceGoldSheet {
  rows: PosWorkspaceInvoiceGoldRow[];
  footer_lines: string[];
  total_grams: string;
  total_amount_dkk: string;
}

export interface PosWorkspaceInvoiceMiscRow {
  row_key: string;
  text?: string | null;
  quantity?: string | null;
  unit_price_dkk: string;
  line_total_dkk: string;
}

export interface PosWorkspaceInvoiceMiscSheet {
  rows: PosWorkspaceInvoiceMiscRow[];
  total_amount_dkk: string;
}

export interface PosWorkspaceCustomer {
  customer_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  cpr_number?: string | null;
  identity_doc_type?: string | null;
  identity_doc_number?: string | null;
  identity_doc_country?: string | null;
}

export interface PosPostalLookup {
  postal_code: string;
  found: boolean;
  available: boolean;
  postal_district?: string | null;
  municipality_name?: string | null;
  region_name?: string | null;
}

export interface PosAddressSearchSuggestion {
  id: string;
  type: string;
  title: string;
}

export interface PosAddressSearchResponse {
  available: boolean;
  results: PosAddressSearchSuggestion[];
}

export interface PosAddressResolveResponse {
  address: string;
  postal_code: string;
  city: string;
}

export interface PosCustomerMatchItem {
  id: string;
  name: string;
  matched_by?: string | null;
}

export interface PosCustomerMatchResponse {
  status: 'none' | 'single' | 'conflict';
  matches: PosCustomerMatchItem[];
}

export interface PosWorkspaceGoldRow {
  row_key: string;
  line_id?: string | null;
  line_no?: number | null;
  karat: string;
  label: string;
  lodighed: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
}

export interface PosWorkspaceSilverRow {
  row_key: string;
  line_id?: string | null;
  line_no?: number | null;
  type_code: string;
  label: string;
  lodighed: string;
  purity_percentage: string;
  gram: string;
  avance_percent: string;
  rate_dkk: string;
  unit_price_dkk: string;
  line_total_dkk: string;
}

export interface PosWorkspaceSummary {
  active_line_count: number;
  total_weight_grams: string;
  total_pure_gold_grams: string;
  gold_weight_grams: string;
  silver_weight_grams: string;
  total_amount_dkk: string;
  net_amount_dkk: string;
  vat_rate_percent: string;
  vat_amount_dkk: string;
  gross_amount_dkk: string;
}

export interface PosWorkspaceCalculatorRow {
  row_key: string;
  unit_weight: string;
  count: string;
  total_weight: string;
  target_row_key?: string | null;
}

export interface PosWorkspaceCalculators {
  gold_rows: PosWorkspaceCalculatorRow[];
  silver_rows: PosWorkspaceCalculatorRow[];
}

export interface PosWorkspace {
  workspace_revision?: number;
  needs_price_repair?: boolean;
  artifact_sync_state?: 'synced' | 'pending' | 'error';
  artifact_workspace_revision?: number | null;
  session: PosSession;
  customer: PosWorkspaceCustomer;
  bank_info: PosWorkspaceBankInfo;
  payment_method: 'bank';
  market_rates: PosWorkspaceMarketRates;
  afg_note?: string | null;
  purchase_vat_enabled: boolean;
  purchase_vat_rate_percent: string;
  calculators: PosWorkspaceCalculators;
  numbering_preview: PosWorkspaceNumbering;
  invoice_gold_mode: 'auto' | 'manual';
  gold_rows: PosWorkspaceGoldRow[];
  silver_rows: PosWorkspaceSilverRow[];
  invoice_gold: PosWorkspaceInvoiceGoldSheet;
  invoice_misc_mode: 'auto' | 'manual';
  invoice_misc: PosWorkspaceInvoiceMiscSheet;
  quick_mode_editable: boolean;
  summary: PosWorkspaceSummary;
}

export interface PosWorkspaceFinalizeResponse {
  session: PosSession;
  document_sequence_no: number;
  document_number: string;
  transaction_id: string;
  line_count: number;
}

export interface PosSavedPurchasePreviewRow {
  line_no: number;
  type_label: string;
  weight_grams: string;
  purity_label?: string | null;
  line_total_dkk: string;
}

export interface PosSavedPurchaseListItem {
  sequence_no: number;
  session_id: string;
  session_code: string;
  document_number: string;
  issued_at: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_postal_code?: string | null;
  customer_city?: string | null;
  customer_cpr?: string | null;
  customer_cpr_masked?: string | null;
  customer_identity_doc_number?: string | null;
  gross_amount_dkk: string;
  total_weight_grams?: string | null;
  line_count: number;
  payment_method?: 'bank' | null;
  gold_preview_items: PosSavedPurchasePreviewRow[];
  silver_preview_items: PosSavedPurchasePreviewRow[];
  can_edit: boolean;
  can_delete: boolean;
  uniconta_sync_status?: string | null;
  uniconta_invoice_number?: string | null;
  uniconta_sync_error?: string | null;
  uniconta_credit_note_number?: string | null;
  uniconta_cancelled_at?: string | null;
  uniconta_cancel_reason?: string | null;
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

export interface AISettingsOut {
  openai_api_key_set: boolean;
  openai_api_key_masked?: string | null;
  openai_base_url: string;
  openai_model: string;
  openai_timeout_seconds: number;
  model_options: { value: string; label: string; note: string }[];
}

export interface AntiFraudSummary {
  total_orders: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  unknown_risk_count: number;
  manual_review_count: number;
}

export interface AntiFraudHumanField {
  key: string;
  label: string;
  value: string;
}

export interface AntiFraudRiskReason {
  code: string;
  reason: string;
}

export interface AntiFraudRiskMeta {
  key: string;
  value: unknown;
}

export interface AntiFraudOrdersResponse {
  source: string;
  generated_at: string;
  summary: AntiFraudSummary;
  items: AntiFraudOrder[];
}

export interface AntiFraudCustomerHistory {
  customer_id?: number | null;
  total_orders: number;
  successful_orders: number;
  cancelled_orders: number;
  failed_orders: number;
  first_order_at?: string | null;
  last_order_at?: string | null;
  known_safe: boolean;
  matched_by?: string | null;
}

export type RiskScoreSource =
  | 'opmc'
  | 'ai'
  | 'manual_override'
  | 'whitelist'
  | 'blacklist'
  | 'known_customer'
  | 'other'
  | 'unknown';

export interface AntiFraudOrder {
  order_id: number;
  order_number?: string | null;
  status: string;
  total?: string | null;
  currency?: string | null;
  date_created?: string | null;
  payment_method?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_id?: number | null;
  ip_address?: string | null;
  billing_country?: string | null;
  billing_city?: string | null;
  shipping_country?: string | null;
  shipping_city?: string | null;
  risk_level?: string | null;
  risk_score?: number | null;
  ai_risk_score?: number | null;
  opmc_risk_score?: number | null;
  risk_score_source?: RiskScoreSource | null;
  raw_risk_score?: number | null;
  requires_manual_review: boolean;
  risk_meta: AntiFraudRiskMeta[];
  risk_reasons: AntiFraudRiskReason[];
  notes: string[];
  notes_human: string[];
  ai_explanations_human: string[];
  risk_meta_human: AntiFraudHumanField[];
  whitelist_action_human?: string | null;
  override_reasons?: string[];
  is_whitelisted?: boolean;
  is_blacklisted?: boolean;
  has_manual_override?: boolean;
  customer_history?: AntiFraudCustomerHistory | null;
}
