import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openaiProxy } from './openai-proxy';

type Route = (req: any, res: any, next?: any) => void;

function routesFor(env: Record<string, string>): Map<string, Route> {
  const routes = new Map<string, Route>();
  const plugin = openaiProxy(env);
  (plugin.configureServer as any)?.({
    middlewares: {
      use(path: string, handler: Route) {
        routes.set(path, handler);
      },
    },
  } as any);
  return routes;
}

function makeReq(method: string, body = ''): any {
  const req: any = Readable.from(body);
  req.method = method;
  return req;
}

function makeRes() {
  let resolve!: (value: any) => void;
  const done = new Promise<any>((r) => {
    resolve = r;
  });
  const headers = new Map<string, string>();
  const res = {
    statusCode: 0,
    body: '',
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    end(payload = '') {
      this.body = String(payload);
      resolve({ statusCode: this.statusCode, body: this.body, headers });
    },
  };
  return { res, done };
}

async function invoke(route: Route, method: string, body = '') {
  const { res, done } = makeRes();
  route(makeReq(method, body), res);
  return done;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openaiProxy', () => {
  it('reports server-side key availability without exposing the key', async () => {
    const routes = routesFor({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-test' });
    const result = await invoke(routes.get('/api/openai/health')!, 'GET');

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true, hasKey: true, model: 'gpt-test' });
    expect(result.body).not.toContain('sk-test');
  });

  it('rejects chat completion calls when the server-side key is missing', async () => {
    const routes = routesFor({});
    const result = await invoke(routes.get('/api/openai/chat/completions')!, 'POST', '{"messages":[]}');

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.message).toContain('OPENAI_API_KEY');
  });

  it('forwards chat completion requests to the configured upstream', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 201,
      text: async () => '{"id":"chatcmpl-test"}',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const routes = routesFor({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://example.test/v1/',
    });

    const result = await invoke(routes.get('/api/openai/chat/completions')!, 'POST', '{"messages":[]}');

    expect(result.statusCode).toBe(201);
    expect(result.headers.get('Content-Type')).toBe('application/json');
    expect(result.body).toBe('{"id":"chatcmpl-test"}');
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
      body: '{"messages":[]}',
    });
  });
});
