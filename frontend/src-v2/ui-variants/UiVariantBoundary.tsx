import { Component, type ErrorInfo, type ReactNode } from 'react';

import { buildUiVariantRootFingerprint, getCurrentHash, normalizeHashRoute } from './fingerprint';
import { createUiVariantStorage, type UiVariantStorageAdapter } from './storage';
import {
  type ModernUiDiagnosticAdapter,
  type ModernUiFailureDiagnostic,
  type ModernUiFallbackEvent,
} from './types';
import { useUiVariant } from './UiVariantProvider';

type ModernUiErrorBoundaryProps = {
  children: ReactNode;
  storage?: UiVariantStorageAdapter;
  diagnosticAdapter?: ModernUiDiagnosticAdapter;
  autoReturnDelayMs?: number;
  onReturnToClassic: (event: ModernUiFallbackEvent) => void;
  rootFingerprint: string;
};

type ModernUiErrorBoundaryState = {
  diagnostic: ModernUiFailureDiagnostic | null;
  supportPath?: string | null;
};

function sanitizeStack(value: string | null | undefined) {
  if (!value) return undefined;
  return value
    .split('\n')
    .slice(0, 8)
    .map((line) => line.trim())
    .join('\n');
}

async function captureFailure(
  adapter: ModernUiDiagnosticAdapter | undefined,
  diagnostic: ModernUiFailureDiagnostic,
) {
  try {
    const result = await adapter?.capture(diagnostic);
    return result?.supportPath ?? null;
  } catch {
    return null;
  }
}

export class ModernUiErrorBoundary extends Component<
  ModernUiErrorBoundaryProps,
  ModernUiErrorBoundaryState
> {
  state: ModernUiErrorBoundaryState = {
    diagnostic: null,
    supportPath: null,
  };

  private autoReturnTimer: number | null = null;

  static getDerivedStateFromError(error: unknown) {
    const hash = getCurrentHash();
    const route = normalizeHashRoute(hash);
    return {
      diagnostic: {
        variant: 'modern',
        hash,
        route,
        fingerprint: '',
        timestamp: new Date().toISOString(),
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
          stack: sanitizeStack(error instanceof Error ? error.stack : undefined),
        },
      },
      supportPath: null,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const hash = getCurrentHash();
    const route = normalizeHashRoute(hash);
    const diagnostic: ModernUiFailureDiagnostic = {
      variant: 'modern',
      hash,
      route,
      fingerprint:
        this.props.rootFingerprint ||
        buildUiVariantRootFingerprint({
          variant: 'modern',
          route,
          hash,
        }),
      timestamp: new Date().toISOString(),
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        stack: sanitizeStack(error instanceof Error ? error.stack : undefined),
      },
      componentStack: sanitizeStack(info.componentStack),
    };

    (this.props.storage ?? createUiVariantStorage()).writeVariant('classic');
    void captureFailure(this.props.diagnosticAdapter, diagnostic).then((supportPath) => {
      this.setState({ diagnostic, supportPath });
      if (this.props.autoReturnDelayMs && this.props.autoReturnDelayMs > 0) {
        this.autoReturnTimer = window.setTimeout(() => {
          this.props.onReturnToClassic({ diagnostic, supportPath, hash });
        }, this.props.autoReturnDelayMs);
      }
    });
  }

  componentWillUnmount() {
    if (this.autoReturnTimer) {
      window.clearTimeout(this.autoReturnTimer);
    }
  }

  render() {
    const diagnostic = this.state.diagnostic;
    if (!diagnostic) {
      return this.props.children;
    }

    return (
      <section className="flex min-h-[45vh] items-center justify-center bg-rose-50 px-6 py-10 text-rose-950">
        <div className="w-full max-w-2xl border border-rose-300 bg-white px-6 py-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-rose-700">
            Yeni arayüz yüklenemedi
          </p>
          <h2 className="mt-2 text-xl font-black text-rose-950">
            Modern görünüm güvenli biçimde kapatıldı
          </h2>
          <p className="mt-3 text-sm leading-6 text-rose-900">
            Yeni arayüz başlatılırken bir render veya bootstrap hatası oluştu. Bu cihaz için tercih klasik
            arayüze geri alındı.
          </p>
          <div className="mt-4 space-y-2 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <p>
              <strong>Hata:</strong> {diagnostic.error.message}
            </p>
            <p>
              <strong>Route:</strong> {diagnostic.route}
            </p>
            {this.state.supportPath ? (
              <p>
                <strong>Destek paketi:</strong> {this.state.supportPath}
              </p>
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                this.props.onReturnToClassic({
                  diagnostic,
                  supportPath: this.state.supportPath,
                  hash: diagnostic.hash,
                })
              }
              className="border border-rose-700 bg-rose-700 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-white transition hover:bg-rose-800"
            >
              Klasik arayüze dön
            </button>
            {this.props.autoReturnDelayMs && this.props.autoReturnDelayMs > 0 ? (
              <p className="self-center text-xs font-semibold text-rose-700">
                Klasik arayüze otomatik dönüş hazırlanıyor.
              </p>
            ) : null}
          </div>
        </div>
      </section>
    );
  }
}

export function UiVariantBoundary({
  children,
  diagnosticAdapter,
  autoReturnDelayMs = 2500,
  storage,
}: {
  children: ReactNode;
  diagnosticAdapter?: ModernUiDiagnosticAdapter;
  autoReturnDelayMs?: number;
  storage?: UiVariantStorageAdapter;
}) {
  const { variant, rootAttributes, rootFingerprint, reportModernBootstrapFailure } = useUiVariant();

  return (
    <div {...rootAttributes}>
      {variant === 'modern' ? (
        <ModernUiErrorBoundary
          storage={storage}
          diagnosticAdapter={diagnosticAdapter}
          autoReturnDelayMs={autoReturnDelayMs}
          onReturnToClassic={reportModernBootstrapFailure}
          rootFingerprint={rootFingerprint}
        >
          {children}
        </ModernUiErrorBoundary>
      ) : (
        children
      )}
    </div>
  );
}
