import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from '@/app';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { DesktopLifecycle } from '@/components/DesktopLifecycle';
import { ToastProvider } from '@/lib/toast';
import { UiVariantProvider, uiVariantTransitionRegistry } from '@/ui-variants';
import { AppLocaleProvider } from '@/i18n';
import '@/styles/tokens.css';
import '@/styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

function displayRouteVariant() {
  const [route, query = ''] = window.location.hash.slice(1).split('?');
  if (!route.startsWith('/display/')) return undefined;
  const candidate = new URLSearchParams(query).get('ui');
  return candidate === 'modern' || candidate === 'classic' ? candidate : undefined;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppLocaleProvider>
        <ToastProvider>
          <ConfirmProvider>
            <UiVariantProvider
              registry={uiVariantTransitionRegistry}
              initialVariant={displayRouteVariant()}
              frontendMode={__SERO_FRONTEND_MODE__}
              frontendBuiltAt={__SERO_FRONTEND_BUILT_AT__}
            >
              <DesktopLifecycle>
                <App />
              </DesktopLifecycle>
            </UiVariantProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AppLocaleProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
