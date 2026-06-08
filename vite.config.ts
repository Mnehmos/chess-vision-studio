/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-server OpenAI proxy. The key stays in .env (plain OPENAI_API_KEY, server-side)
 * and is injected here — it is NEVER sent to or bundled into the browser. The client
 * calls /api/openai/chat/completions (same origin) and we forward to OpenAI with the
 * Authorization header attached. This is why you keep a .env: no VITE_ prefix needed.
 */
function openaiProxy(env: Record<string, string>): Plugin {
  const key = env.OPENAI_API_KEY || '';
  const model = env.OPENAI_MODEL || 'gpt-5.5';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const json = (res: import('http').ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };
  return {
    name: 'openai-proxy',
    configureServer(server) {
      // Lets the app discover whether a server-side key exists (no key leaves the box).
      server.middlewares.use('/api/openai/health', (_req, res) => {
        json(res, 200, { ok: true, hasKey: !!key, model });
      });
      server.middlewares.use('/api/openai/chat/completions', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: { message: 'POST only' } });
        if (!key)
          return json(res, 500, {
            error: { message: 'OPENAI_API_KEY is not set in .env (server-side). Add it and restart the dev server.' },
          });
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const upstream = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body,
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          } catch (e) {
            json(res, 502, { error: { message: String((e as Error)?.message ?? e) } });
          }
        });
      });
    },
  };
}

// Stockfish WASM needs cross-origin isolation (SharedArrayBuffer) in the browser.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' = load ALL vars, incl. non-VITE_
  return {
    plugins: [react(), openaiProxy(env)],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['engine/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx', 'llm/**/*.test.ts', 'arena/**/*.test.ts'],
      testTimeout: 30000,
    },
  };
});
