import { Component, type ErrorInfo, type ReactNode } from 'react';

import { buildUiVariantRootFingerprint, getCurrentHash, normalizeHashRoute } from './fingerprint';
import { type UiVariantStorageAdapter } from './storage';
import { openRuntimeDiagnostics } from '@/lib/desktop';
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

    void captureFailure(this.props.diagnosticAdapter, diagnostic).then((supportPath) => {
      this.setState({ diagnostic, supportPath });
    });
  }

  private retry = () => {
    this.setState({ diagnostic: null, supportPath: null });
  };

  private openDiagnostics = () => {
    void openRuntimeDiagnostics();
  }

  render() {
    const diagnostic = this.state.diagnostic;
    if (!diagnostic) {
      return this.props.children;
    }

    return (
      <section className="flex min-h-[60vh] items-center justify-center bg-sg-bg px-5 py-10 font-sg text-sg-text">
        <div className="w-full max-w-2xl rounded-sg-lg border border-sg-border bg-sg-surface px-6 py-7 shadow-sg-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sg-accent">
            Modern çalışma alanı
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-sg-text">
            Yeni arayüz yüklenemedi
          </h2>
          <p className="mt-3 text-sm leading-6 text-sg-text-soft">
            Modern görünüm beklenmeyen bir hatayla karşılaştı. Tercihiniz korunuyor; tekrar deneyebilir,
            tanı bilgilerini açabilir veya klasik arayüze kendiniz geçebilirsiniz.
          </p>
          <div className="mt-5 space-y-2 rounded-sg-md border border-sg-border-soft bg-sg-surface-soft px-4 py-3 text-sm text-sg-text">
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
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.retry}
              className="rounded-sg-sm bg-sg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sg-accent-dark"
            >
              Tekrar dene
            </button>
            <button
              type="button"
              onClick={this.openDiagnostics}
              className="rounded-sg-sm border border-sg-border bg-sg-surface px-4 py-2.5 text-sm font-semibold text-sg-text transition hover:bg-sg-surface-soft"
            >
              Tanı bilgilerini aç
            </button>
            <button
              type="button"
              onClick={() =>
                this.props.onReturnToClassic({
                  diagnostic,
                  supportPath: this.state.supportPath,
                  hash: diagnostic.hash,
                })
              }
              className="rounded-sg-sm border border-sg-red/30 bg-sg-red-soft px-4 py-2.5 text-sm font-semibold text-sg-red transition hover:bg-sg-red/10"
            >
              Klasik arayüze dön
            </button>
          </div>
        </div>
      </section>
    );
  }
}

export function UiVariantBoundary({
  children,
  diagnosticAdapter,
  autoReturnDelayMs: _autoReturnDelayMs,
  storage,
}: {
  children: ReactNode;
  diagnosticAdapter?: ModernUiDiagnosticAdapter;
  /** Retained for source compatibility; modern failures are never automatic. */
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
          onReturnToClassic={(event) => reportModernBootstrapFailure({ ...event, explicitClassic: true })}
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
