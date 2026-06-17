// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenAIProxyHealth } from './openai-client';

afterEach(() => vi.restoreAllMocks());

describe('getOpenAIProxyHealth', () => {
  it('reads the dev-server proxy health response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, hasKey: true, model: 'gpt-test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getOpenAIProxyHealth('fallback-model')).resolves.toEqual({
      ok: true,
      hasKey: true,
      model: 'gpt-test',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/openai/health');
  });

  it('uses the caller fallback model when the proxy omits a model', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, hasKey: false }), { status: 200 }),
    );

    await expect(getOpenAIProxyHealth('fallback-model')).resolves.toEqual({
      ok: true,
      hasKey: false,
      model: 'fallback-model',
    });
  });

  it('rejects non-OK health responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));

    await expect(getOpenAIProxyHealth('fallback-model')).rejects.toThrow(
      /OpenAI proxy health failed \(500\)/,
    );
  });
});
