export type ModernAsyncPhase = 'ready' | 'loading' | 'empty' | 'error';

export interface TransitionBlockerDescriptor {
  id: string;
  when: boolean;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'danger';
  reasons: string[];
}

export interface UnsupportedControlDescriptor {
  id: string;
  label: string;
  reason: string;
}

export interface ModernResolutionField {
  id: string;
  label: string;
  crmValue: string;
  workbookValue: string;
  onKeepCrm?: () => void;
  onKeepWorkbook?: () => void;
}

export interface ModernRevisionBadge {
  id: string;
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface ModernSyncBadge {
  id: string;
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}
