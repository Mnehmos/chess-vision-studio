/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Stockfish WASM needs cross-origin isolation (SharedArrayBuffer) in the browser.
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['engine/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
