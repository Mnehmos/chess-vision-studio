import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithCvsEngineRequest } from '../cvs-engine-client';

// Capture the JSON body the client POSTs to /api/cvs-engine/analyze, so we can
// assert history (initialFen/moves) serialization without a dev server (PR-04).
function installFetchSpy(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  const spy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        fen: 'x',
        uci: null,
        scoreCp: 0,
        mate: null,
        pv: [],
        depth: 1,
        nodes: 0,
        qNodes: 0,
        ttHits: 0,
        timeMs: 0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return { bodies };
}

describe('analyzeWithCvsEngineRequest history serialization (PR-04)', () => {
  let saved: typeof fetch;
  beforeEach(() => {
    saved = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = saved;
  });

  it('forwards initialFen + moves (and movetime) when history is present', async () => {
    const { bodies } = installFetchSpy();
    await analyzeWithCvsEngineRequest({
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      initialFen: 'startpos',
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      budget: { kind: 'movetime', milliseconds: 500 },
    });
    expect(bodies[0]).toMatchObject({
      initialFen: 'startpos',
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
      movetimeMs: 500,
    });
  });

  it('omits history for a bare-FEN request (no regression to standalone analysis)', async () => {
    const { bodies } = installFetchSpy();
    await analyzeWithCvsEngineRequest({ fen: 'F', budget: { kind: 'depth', depth: 12 } });
    expect('initialFen' in bodies[0]).toBe(false);
    expect('moves' in bodies[0]).toBe(false);
    expect(bodies[0]).toMatchObject({ fen: 'F', depth: 12 });
  });
});
