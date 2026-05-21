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
  },
});
