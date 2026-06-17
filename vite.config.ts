/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cvsEngineProxy } from './arena/dev-server/cvs-engine-proxy';
import { openaiProxy } from './arena/dev-server/openai-proxy';
import { stockfishProxy } from './arena/dev-server/stockfish-proxy';
import { trainingSupervisor } from './arena/dev-server/training-supervisor';

// Stockfish WASM needs cross-origin isolation (SharedArrayBuffer) in the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' = load ALL vars, incl. non-VITE_
  return {
    plugins: [
      react(),
      openaiProxy(env),
      cvsEngineProxy(env),
      stockfishProxy(env),
      trainingSupervisor(),
    ],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: [
        'engine/**/*.test.ts',
        'app/**/*.test.ts',
        'app/**/*.test.tsx',
        'llm/**/*.test.ts',
        'arena/**/*.test.ts',
      ],
      testTimeout: 30000,
    },
  };
});
