export type UiVariant = 'classic' | 'modern';

export type UiVariantNoticeTone = 'info' | 'success' | 'warning' | 'error';

export type UiVariantTransitionStatus = 'ready' | 'settling' | 'blocked';

export type UiVariantStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type UiVariantTransitionIntent = {
  fromVariant: UiVariant;
  toVariant: UiVariant;
  route: string;
  hash: string;
};

export type UiVariantTransitionDecision =
  | { status: 'ready' }
  | { status: 'settling'; reason: string }
  | { status: 'blocked'; reason: string };

export type UiVariantTransitionSnapshot = {
  status: UiVariantTransitionStatus;
  reasons: string[];
  guardIds: string[];
  intent: UiVariantTransitionIntent;
};

export type UiVariantTransitionGuard = {
  id: string;
  evaluate: (
    intent: UiVariantTransitionIntent,
  ) => UiVariantTransitionDecision | Promise<UiVariantTransitionDecision>;
  flush?: (intent: UiVariantTransitionIntent) => void | Promise<void>;
};

export type UiVariantSwitchCopy = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
};

export type UiVariantSwitchRequest = {
  id: number;
  intent: UiVariantTransitionIntent;
  copy: UiVariantSwitchCopy;
};

export type UiVariantNotice = {
  id: number;
  tone: UiVariantNoticeTone;
  message: string;
  description?: string;
};

export type UiVariantNoticeInput = Omit<UiVariantNotice, 'id'>;

export type UiVariantConfirmResult =
  | { status: 'applied'; variant: UiVariant }
  | { status: 'blocked' | 'settling'; snapshot: UiVariantTransitionSnapshot }
  | { status: 'idle' };

export type UiVariantRequestResult =
  | { status: 'noop'; variant: UiVariant }
  | { status: 'pending'; request: UiVariantSwitchRequest };

export type ModernUiFailureDiagnostic = {
  variant: UiVariant;
  hash: string;
  route: string;
  fingerprint: string;
  timestamp: string;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  componentStack?: string;
};

export type ModernUiFailureCaptureResult = {
  supportPath?: string | null;
};

export type ModernUiDiagnosticAdapter = {
  capture: (
    diagnostic: ModernUiFailureDiagnostic,
  ) => ModernUiFailureCaptureResult | Promise<ModernUiFailureCaptureResult | void> | void;
};

export type ModernUiFallbackEvent = {
  diagnostic: ModernUiFailureDiagnostic;
  supportPath?: string | null;
  hash: string;
  /** Set only when the operator explicitly chooses the classic recovery action. */
  explicitClassic?: boolean;
};

/**
 * Older desktop builds wrote v1 and v2 preferences. Neither key is read by
 * the 0.3.1 build: a stale classic value must not make a fresh install open
 * the retired shell.
 */
export const UI_VARIANT_LEGACY_STORAGE_KEYS = [
  'seroguld.ui.variant.v1',
  'seroguld.ui.variant.v2',
] as const;
/** Explicit modern/classic choices made in the 0.3.1 build are persisted here. */
export const UI_VARIANT_STORAGE_KEY = 'seroguld.ui.variant.v3';
export const UI_VARIANT_MODERN_BANNER_DISMISSED_KEY =
  'seroguld.ui.modern-banner.dismissed.v1';

export const UI_VARIANT_LABELS: Record<UiVariant, string> = {
  classic: 'Klasik Sero Guld',
  modern: 'Yeni Sero Guld (Önizleme)',
};

export const UI_VARIANT_SETTINGS_CARDS = {
  classic: {
    eyebrow: 'Klasik',
    description: 'Bugün kullanılan, mevcut iş akışlarını koruyan Sero Guld arayüzü.',
    activeText: 'Şu anda kullanılıyor',
    actionText: 'Klasik arayüze dön',
  },
  modern: {
    eyebrow: 'Önizleme',
    description: 'Daha açık, modern, responsive ve operasyon odaklı yeni deneyim.',
    activeText: 'Şu anda kullanılıyor',
    actionText: 'Yeni arayüzü dene',
  },
} as const;

export const UI_VARIANT_SWITCH_COPY: Record<
  `${UiVariant}->${UiVariant}`,
  UiVariantSwitchCopy
> = {
  'classic->classic': {
    title: '',
    message: '',
    confirmText: '',
    cancelText: '',
  },
  'classic->modern': {
    title: 'Yeni Sero Guld arayüzüne geçilsin mi?',
    message:
      'İş akışları ve veriler değişmez. Açık taslaklarınız ve kaydedilmiş işlemleriniz korunur. İstediğiniz zaman Ayarlar > Görünüm bölümünden klasik arayüze dönebilirsiniz.',
    confirmText: 'Yeni arayüze geç',
    cancelText: 'Şimdilik değil',
  },
  'modern->classic': {
    title: 'Klasik Sero Guld arayüzüne dönülsün mü?',
    message:
      'Yalnızca bu cihazdaki arayüz tercihi değişir. Verileriniz, açık taslaklarınız ve entegrasyon durumları korunur.',
    confirmText: 'Klasik arayüze dön',
    cancelText: 'Vazgeç',
  },
  'modern->modern': {
    title: '',
    message: '',
    confirmText: '',
    cancelText: '',
  },
};

export const UI_VARIANT_CLASSIC_BANNER_COPY = {
  title: 'Yeni Sero Guld hazır',
  message:
    'Daha açık ve modern deneyimi önizleyin. İstediğiniz zaman geri dönebilirsiniz.',
  dismissText: 'Şimdi değil',
  actionText: 'Yeni arayüzü dene',
} as const;

export const UI_VARIANT_MODERN_RETURN_TEXT = 'Klasik arayüze dön';

export const UI_VARIANT_BLOCKED_NOTICE = 'Arayüz değişikliği şu anda tamamlanamadı.';
export const UI_VARIANT_SETTLING_NOTICE = 'Kaydetme tamamlanıyor.';
export const UI_VARIANT_MODERN_BOOTSTRAP_FAILED_NOTICE =
  'Yeni arayüz başlatılamadı. Klasik arayüze yalnızca açık seçiminizle dönebilirsiniz.';
