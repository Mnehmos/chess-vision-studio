import type { Plugin } from 'vite';
import { sendJson as json } from './http';

/**
 * Dev-server OpenAI proxy. The key stays in .env (plain OPENAI_API_KEY, server-side)
 * and is never sent to or bundled into the browser.
 */
export function openaiProxy(env: Record<string, string>): Plugin {
  const key = env.OPENAI_API_KEY || '';
  const model = env.OPENAI_MODEL || 'gpt-5.5';
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    name: 'openai-proxy',
    configureServer(server) {
      server.middlewares.use('/api/openai/health', (_req, res) => {
        json(res, 200, { ok: true, hasKey: !!key, model });
      });
      server.middlewares.use('/api/openai/chat/completions', (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: { message: 'POST only' } });
        if (!key) {
          return json(res, 500, {
            error: {
              message:
                'OPENAI_API_KEY is not set in .env (server-side). Add it and restart the dev server.',
            },
          });
        }
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
