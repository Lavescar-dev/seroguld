import type { OfficeDocumentPageProps } from '@/make/office/OfficeDocumentPage';
import { formatDate, formatRelativeTime } from '@/lib/format';

import type {
  ModernResolutionField,
  ModernRevisionBadge,
  ModernSyncBadge,
  TransitionBlockerDescriptor,
} from './types';

export interface ModernOfficeViewModel {
  state: OfficeDocumentPageProps;
  title: string;
  subtitle: string;
  isOpen: boolean;
  isExpanded: boolean;
  onToggleOpen?: () => void;
  onToggleExpanded?: () => void;
  onClose?: () => void;
  revisions: ModernRevisionBadge[];
  syncBadges: ModernSyncBadge[];
  resolutionFields: ModernResolutionField[];
  blocker: TransitionBlockerDescriptor | null;
}

export function createOfficeTransitionBlocker(
  state: OfficeDocumentPageProps,
  options?: { hasConflict?: boolean; hasDirtyImport?: boolean; isDirty?: boolean },
): TransitionBlockerDescriptor | null {
  const reasons: string[] = [];
  if (options?.isDirty || state.isLivePreviewDirty) reasons.push('Workbook içinde kaydedilmemiş değişiklik var');
  if (state.isLivePreviewSyncing || state.isSessionRefreshing) reasons.push('Senkron veya session refresh devam ediyor');
  if (options?.hasConflict || state.hasExternalUpdate || Boolean(state.importReconcilePreview?.blocking_errors?.length)) reasons.push('Conflict veya reconcile uyarısı çözülmedi');
  if (options?.hasDirtyImport || state.isImporting || state.isPreviewingImport) reasons.push('Import/reconcile akışı henüz tamamlanmadı');
  if (reasons.length === 0) return null;
  return {
    id: 'office-document',
    when: true,
    title: 'Office Belge Koruması',
    description: 'Office paneli kapanmadan veya route değişmeden önce workbook sync ve conflict akışının tamamlanması gerekiyor.',
    severity: reasons.some((item) => item.includes('Conflict')) ? 'danger' : 'warning',
    reasons,
  };
}

export function createModernOfficeViewModel(
  state: OfficeDocumentPageProps,
  options?: {
    isOpen?: boolean;
    isExpanded?: boolean;
    onToggleOpen?: () => void;
    onToggleExpanded?: () => void;
    onClose?: () => void;
    crmRevision?: string;
    workbookRevision?: string;
    baseRevision?: string;
    checksum?: string | null;
    hasConflict?: boolean;
    isDirty?: boolean;
    resolutionFields?: ModernResolutionField[];
  },
): ModernOfficeViewModel {
  const artifact = state.status?.artifact || state.launch?.artifact || null;
  const conflict =
    options?.hasConflict ||
    state.hasExternalUpdate ||
    Boolean(state.importReconcilePreview?.blocking_errors?.length) ||
    Boolean(state.lastEditorError);

  return {
    state,
    title: state.launch?.title || artifact?.file_name || 'Office Belgesi',
    subtitle: state.launch?.subtitle || state.runtimeWarnings[0] || 'Gerçek Office oturumu modern module route içinde host edilir.',
    isOpen: options?.isOpen ?? true,
    isExpanded: options?.isExpanded ?? false,
    onToggleOpen: options?.onToggleOpen,
    onToggleExpanded: options?.onToggleExpanded,
    onClose: options?.onClose,
    revisions: [
      { id: 'crm', label: 'CRM Revision', value: options?.crmRevision || formatRelativeTime(state.appRuntimeStatus?.backend_started_at) || '—', tone: 'neutral' },
      { id: 'workbook', label: 'Workbook Revision', value: options?.workbookRevision || formatRelativeTime(artifact?.updated_at) || '—', tone: state.hasExternalUpdate ? 'warning' : 'success' },
      { id: 'base', label: 'Base Revision', value: options?.baseRevision || `Contract v${state.status?.contract_version || state.launch?.contract_version || '1'}`, tone: 'neutral' },
      { id: 'checksum', label: 'Checksum', value: options?.checksum || 'Sağlanmadı', tone: options?.checksum ? 'success' : 'warning' },
    ],
    syncBadges: [
      { id: 'provider', label: 'Provider', value: state.runtimeStatus?.provider_label || state.launch?.provider_label || 'Unknown', tone: state.runtimeStatus?.runtime_available === false ? 'danger' : 'neutral' },
      { id: 'autosave', label: 'Autosave', value: state.isLivePreviewSyncing ? 'Syncing' : state.isLivePreviewDirty || options?.isDirty ? 'Pending' : 'Stable', tone: state.isLivePreviewSyncing ? 'warning' : state.isLivePreviewDirty || options?.isDirty ? 'warning' : 'success' },
      { id: 'callback', label: 'Son Callback', value: state.status?.last_callback_at ? formatDate(state.status.last_callback_at) : 'Yok', tone: state.status?.last_callback_at ? 'neutral' : 'warning' },
      { id: 'conflict', label: 'Conflict', value: conflict ? 'Var' : 'Yok', tone: conflict ? 'danger' : 'success' },
    ],
    resolutionFields: options?.resolutionFields || [],
    blocker: createOfficeTransitionBlocker(state, {
      hasConflict: options?.hasConflict,
      isDirty: options?.isDirty,
    }),
  };
}
