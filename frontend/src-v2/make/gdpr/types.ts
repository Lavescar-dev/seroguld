import type { CustomerOut } from '@/types';

export interface RuntimeReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string | null;
}

export interface GdprOverview {
  open_request_count: number;
  due_soon_count: number;
  overdue_count: number;
  completed_30d_count: number;
  eligible_pseudonymize_count: number;
  locked_product_count: number;
  processor_warning_count: number;
  queued_job_count: number;
  failed_job_count: number;
  last_scan_at?: string | null;
  last_run_at?: string | null;
  readiness_checks: RuntimeReadinessCheck[];
}

export interface GdprRequestListItem {
  id: string;
  reference_number: string;
  request_type: string;
  status: string;
  channel: string;
  subject_name?: string | null;
  subject_email?: string | null;
  subject_phone?: string | null;
  verified_customer_id?: string | null;
  verified_customer_name?: string | null;
  due_at?: string | null;
  submitted_at: string;
  completed_at?: string | null;
}

export interface GdprRequestEvent {
  id: string;
  event_type: string;
  actor_type: string;
  actor_user_id?: string | null;
  message?: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
}

export interface GdprJob {
  id: string;
  request_id?: string | null;
  request_reference_number?: string | null;
  job_type: string;
  status: string;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

// Backend: app/models/gdpr_copy_task.py — completion gate yalnız bu üç durumda açılır.
export const GDPR_COPY_COMPLETION_STATES: ReadonlyArray<string> = ['deleted', 'pseudonymized', 'legally_retained'];
// Backend: update_gdpr_copy_task — bu hedef durumlara geçiş için gerekçe zorunlu.
export const GDPR_COPY_REASON_REQUIRED_STATES: ReadonlyArray<string> = ['failed', 'manual_action_required', 'legally_retained'];
export const GDPR_COPY_TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  running: 'Çalışıyor',
  deleted: 'Silindi',
  pseudonymized: 'Pseudonymize edildi',
  legally_retained: 'Yasal saklamada',
  manual_action_required: 'Manuel aksiyon gerekli',
  failed: 'Başarısız',
};

export function gdprCopyTaskStatusLabel(status: string): string {
  return GDPR_COPY_TASK_STATUS_LABELS[status] || status;
}

export function gdprRequestTypeLabel(requestType: string): string {
  const labels: Record<string, string> = {
    access_export: 'Erişim / Export',
    erasure_pseudonymize: 'Silme / Pseudonymize',
    rectification: 'Düzeltme (rectification)',
    objection_restriction: 'İtiraz / Kısıtlama',
    marketing_opt_out: 'Pazarlama çıkışı',
    cookie_privacy_contact: 'Çerez / gizlilik iletişimi',
  };
  return labels[requestType] || requestType;
}

export function gdprRequestStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    identity_pending: 'Kimlik doğrulaması bekliyor',
    verified: 'Doğrulandı',
    approved: 'Onaylandı',
    queued: 'Kuyrukta',
    executing: 'Yürütülüyor',
    completed: 'Tamamlandı',
    completed_with_warnings: 'Uyarıyla tamamlandı',
    rejected: 'Reddedildi',
    failed: 'Başarısız',
    manual_action_required: 'Manuel aksiyon gerekli',
  };
  return labels[status] || status;
}

export interface GdprCopyTask {
  id: string;
  request_id: string;
  task_key: string;
  system_name: string;
  copy_scope: string;
  applicable: boolean;
  status: string;
  is_terminal: boolean;
  completion_eligible: boolean;
  reason?: string | null;
  metadata_json: Record<string, unknown>;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GdprRequestDetail extends GdprRequestListItem {
  message?: string | null;
  decision_reason?: string | null;
  request_meta: Record<string, unknown>;
  match_candidates: CustomerOut[];
  events: GdprRequestEvent[];
  latest_job?: GdprJob | null;
  export_download_path?: string | null;
  copy_tasks: GdprCopyTask[];
}

export interface GdprRetentionPolicy {
  id: string;
  policy_key: string;
  title: string;
  description?: string | null;
  applies_to: string;
  action: string;
  retention_days: number;
  is_enabled: boolean;
  updated_at: string;
}

export interface GdprProcessor {
  id: string;
  processor_key: string;
  title: string;
  category: string;
  system_name: string;
  status: string;
  configured: boolean;
  endpoint_url?: string | null;
  detail?: string | null;
  notes?: string | null;
  last_checked_at?: string | null;
}

export interface GdprPublicSiteConfig {
  company_name: string;
  company_email?: string | null;
  company_phone?: string | null;
  company_address?: string | null;
  company_cvr?: string | null;
  website_url?: string | null;
  wordpress_url?: string | null;
  privacy_email?: string | null;
  privacy_request_url: string;
  privacy_policy_url: string;
  cookies_url: string;
}

export interface GdprPublicCookieCategory {
  key: string;
  title: string;
  required: boolean;
  description: string;
}

export interface GdprPublicCookieConfig {
  categories: GdprPublicCookieCategory[];
}

export interface GdprPublicBridgeConfig {
  version: string;
  updated_at: string;
  company_name: string;
  company_email?: string | null;
  company_phone?: string | null;
  company_address?: string | null;
  company_cvr?: string | null;
  website_url?: string | null;
  wordpress_url?: string | null;
  privacy_request_url: string;
  privacy_policy_url: string;
  cookies_url: string;
  cookie_config_url: string;
  cookie_categories: GdprPublicCookieCategory[];
}

export interface GdprPublicRequestCreateOut {
  reference_number: string;
  tracking_token: string;
  status: string;
  due_at: string;
}

export interface GdprPublicRequestStatus {
  reference_number: string;
  request_type: string;
  status: string;
  submitted_at: string;
  due_at?: string | null;
  completed_at?: string | null;
  last_message?: string | null;
}
