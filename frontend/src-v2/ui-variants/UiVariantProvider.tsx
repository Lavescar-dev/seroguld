import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  buildUiVariantRootFingerprint,
  getCurrentHash,
  getCurrentHashRoute,
  getUiVariantRootAttributes,
} from './fingerprint';
import { UiVariantTransitionRegistry } from './registry';
import { createUiVariantStorage, type UiVariantStorageAdapter } from './storage';
import {
  UI_VARIANT_BLOCKED_NOTICE,
  UI_VARIANT_MODERN_BOOTSTRAP_FAILED_NOTICE,
  UI_VARIANT_SETTLING_NOTICE,
  UI_VARIANT_SWITCH_COPY,
  type ModernUiFallbackEvent,
  type UiVariant,
  type UiVariantConfirmResult,
  type UiVariantNotice,
  type UiVariantNoticeInput,
  type UiVariantRequestResult,
  type UiVariantSwitchRequest,
  type UiVariantTransitionIntent,
  type UiVariantTransitionSnapshot,
} from './types';

type UiVariantProviderProps = {
  children: ReactNode;
  storage?: UiVariantStorageAdapter;
  registry?: UiVariantTransitionRegistry;
  initialVariant?: UiVariant;
  frontendMode?: string | null;
  frontendBuiltAt?: string | null;
};

type UiVariantContextValue = {
  variant: UiVariant;
  pendingRequest: UiVariantSwitchRequest | null;
  transition: UiVariantTransitionSnapshot | null;
  notice: UiVariantNotice | null;
  requestVariantChange: (nextVariant: UiVariant) => UiVariantRequestResult;
  confirmRequestedChange: () => Promise<UiVariantConfirmResult>;
  cancelRequestedChange: () => void;
  forceVariant: (nextVariant: UiVariant, notice?: UiVariantNoticeInput) => void;
  dismissModernBanner: () => void;
  isModernBannerDismissed: boolean;
  consumeNotice: (id: number) => void;
  reportModernBootstrapFailure: (event: ModernUiFallbackEvent) => void;
  rootFingerprint: string;
  rootAttributes: Record<string, string>;
};

const UiVariantContext = createContext<UiVariantContextValue | null>(null);

function buildIntent(fromVariant: UiVariant, toVariant: UiVariant): UiVariantTransitionIntent {
  return {
    fromVariant,
    toVariant,
    route: getCurrentHashRoute(),
    hash: getCurrentHash(),
  };
}

function resolveSwitchCopy(intent: UiVariantTransitionIntent) {
  return UI_VARIANT_SWITCH_COPY[`${intent.fromVariant}->${intent.toVariant}`];
}

export function UiVariantProvider({
  children,
  storage = createUiVariantStorage(),
  registry,
  initialVariant,
  frontendMode,
  frontendBuiltAt,
}: UiVariantProviderProps) {
  const internalRegistryRef = useRef<UiVariantTransitionRegistry | null>(null);
  if (!internalRegistryRef.current) {
    internalRegistryRef.current = registry ?? new UiVariantTransitionRegistry();
  }

  const requestCounterRef = useRef(0);
  const noticeCounterRef = useRef(0);
  const [variant, setVariant] = useState<UiVariant>(() => initialVariant ?? storage.readVariant());
  const [pendingRequest, setPendingRequest] = useState<UiVariantSwitchRequest | null>(null);
  const [transition, setTransition] = useState<UiVariantTransitionSnapshot | null>(null);
  const [isModernBannerDismissed, setIsModernBannerDismissed] = useState<boolean>(() =>
    storage.isModernBannerDismissed(),
  );
  const [noticeQueue, setNoticeQueue] = useState<UiVariantNotice[]>([]);
  const [hashVersion, setHashVersion] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHashChange = () => setHashVersion((current) => current + 1);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const enqueueNotice = useCallback((input: UiVariantNoticeInput) => {
    noticeCounterRef.current += 1;
    setNoticeQueue((current) => [...current, { id: noticeCounterRef.current, ...input }]);
  }, []);

  const applyVariant = useCallback(
    (nextVariant: UiVariant, nextNotice?: UiVariantNoticeInput) => {
      storage.writeVariant(nextVariant);
      setVariant(nextVariant);
      setPendingRequest(null);
      setTransition(null);
      if (nextNotice) {
        enqueueNotice(nextNotice);
      }
    },
    [enqueueNotice, storage],
  );

  const requestVariantChange = useCallback(
    (nextVariant: UiVariant): UiVariantRequestResult => {
      if (nextVariant === variant) {
        return { status: 'noop', variant };
      }

      requestCounterRef.current += 1;
      const intent = buildIntent(variant, nextVariant);
      const request = {
        id: requestCounterRef.current,
        intent,
        copy: resolveSwitchCopy(intent),
      } satisfies UiVariantSwitchRequest;
      setPendingRequest(request);
      setTransition(null);
      return { status: 'pending', request };
    },
    [variant],
  );

  const cancelRequestedChange = useCallback(() => {
    setPendingRequest(null);
    setTransition(null);
  }, []);

  const confirmRequestedChange = useCallback(async (): Promise<UiVariantConfirmResult> => {
    if (!pendingRequest) {
      return { status: 'idle' };
    }

    setPendingRequest(null);
    let snapshot = await internalRegistryRef.current!.inspect(pendingRequest.intent);
    setTransition(snapshot);

    if (snapshot.status === 'blocked') {
      enqueueNotice({
        tone: 'warning',
        message: UI_VARIANT_BLOCKED_NOTICE,
        description: snapshot.reasons.join(' '),
      });
      return { status: 'blocked', snapshot };
    }

    if (snapshot.status === 'settling') {
      enqueueNotice({
        tone: 'info',
        message: UI_VARIANT_SETTLING_NOTICE,
        description: snapshot.reasons.join(' '),
      });
      snapshot = await internalRegistryRef.current!.flush(pendingRequest.intent);
      setTransition(snapshot);
      if (snapshot.status !== 'ready') {
        if (snapshot.status === 'blocked') {
          enqueueNotice({
            tone: 'warning',
            message: UI_VARIANT_BLOCKED_NOTICE,
            description: snapshot.reasons.join(' '),
          });
        }
        return { status: snapshot.status, snapshot };
      }
    }

    applyVariant(pendingRequest.intent.toVariant);
    return { status: 'applied', variant: pendingRequest.intent.toVariant };
  }, [applyVariant, enqueueNotice, pendingRequest]);

  const dismissModernBanner = useCallback(() => {
    storage.dismissModernBanner();
    setIsModernBannerDismissed(true);
  }, [storage]);

  const consumeNotice = useCallback((id: number) => {
    setNoticeQueue((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const reportModernBootstrapFailure = useCallback(
    (event: ModernUiFallbackEvent) => {
      applyVariant('classic', {
        tone: 'error',
        message: UI_VARIANT_MODERN_BOOTSTRAP_FAILED_NOTICE,
        description: event.supportPath
          ? `Destek paketi: ${event.supportPath}`
          : undefined,
      });
    },
    [applyVariant],
  );

  const rootFingerprint = useMemo(
    () =>
      buildUiVariantRootFingerprint({
        variant,
        route: getCurrentHashRoute(),
        hash: getCurrentHash(),
        frontendMode,
        frontendBuiltAt,
      }),
    [frontendBuiltAt, frontendMode, hashVersion, variant],
  );

  const rootAttributes = useMemo(
    () =>
      getUiVariantRootAttributes({
        variant,
        route: getCurrentHashRoute(),
        hash: getCurrentHash(),
        frontendMode,
        frontendBuiltAt,
      }),
    [frontendBuiltAt, frontendMode, hashVersion, variant],
  );

  const contextValue = useMemo<UiVariantContextValue>(
    () => ({
      variant,
      pendingRequest,
      transition,
      notice: noticeQueue[0] ?? null,
      requestVariantChange,
      confirmRequestedChange,
      cancelRequestedChange,
      forceVariant: applyVariant,
      dismissModernBanner,
      isModernBannerDismissed,
      consumeNotice,
      reportModernBootstrapFailure,
      rootFingerprint,
      rootAttributes,
    }),
    [
      applyVariant,
      cancelRequestedChange,
      confirmRequestedChange,
      consumeNotice,
      dismissModernBanner,
      isModernBannerDismissed,
      noticeQueue,
      pendingRequest,
      reportModernBootstrapFailure,
      requestVariantChange,
      rootAttributes,
      rootFingerprint,
      transition,
      variant,
    ],
  );

  return <UiVariantContext.Provider value={contextValue}>{children}</UiVariantContext.Provider>;
}

export function useUiVariant() {
  const context = useContext(UiVariantContext);
  if (!context) {
    throw new Error('useUiVariant must be used inside UiVariantProvider');
  }
  return context;
}

export function useUiVariantRootAttributes() {
  return useUiVariant().rootAttributes;
}

export function useUiVariantRootFingerprint() {
  return useUiVariant().rootFingerprint;
}
