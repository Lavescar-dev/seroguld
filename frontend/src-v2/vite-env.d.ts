/// <reference types="vite/client" />

export {};

declare global {
  const __SERO_FRONTEND_MODE__: string;
  const __SERO_FRONTEND_BUILT_AT__: string;

  interface ImportMetaEnv {
    readonly VITE_FEEDBACK_CHANNEL?: string;
    readonly VITE_FEEDBACK_EMAIL?: string;
  }

  interface Window {
    DocsAPI?: {
      DocEditor: new (elementId: string, config: Record<string, unknown>) => {
        destroyEditor?: () => void;
      };
    };
  }
}
