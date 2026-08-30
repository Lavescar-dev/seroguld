import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src-v2'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src-v2/__tests__/setup.ts'],
    include: ['src-v2/**/__tests__/*.{test,spec}.{ts,tsx}'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src-v2/**/*.{ts,tsx}'],
      exclude: [
        'src-v2/**/__tests__/**',
        'src-v2/**/types.ts',
        'src-v2/main.tsx',
        'src-v2/vite-env.d.ts',
        'src-v2/i18n/legacyCopy.generated.ts',
      ],
      // Baseline 2026-08-30 (tam ağaç): 23.8 satır / 14.9 branch / 17.3 fonksiyon / 22.3 statement
      // — test eklendikçe yukarı çekilir (ratchet).
      thresholds: { lines: 23, branches: 14, functions: 17, statements: 22 },
    },
  },
});
