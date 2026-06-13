// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import allowedFork from '../fixtures/teaching-facts/v1/allowed-fork.json';
import { getTeachingFacts } from './cvs-engine-client';

afterEach(() => vi.restoreAllMocks());

describe('getTeachingFacts', () => {
  it('posts the V1 request and accepts the Rust fixture response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(allowedFork), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await getTeachingFacts({
      schemaVersion: 1,
      fenBefore: allowedFork.fenBefore,
      playedMoveUci: allowedFork.played.move.uci,
    });
    expect(result.provenance.factsRegistryVersion).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cvs-engine/facts',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a response with an incompatible schema', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ...allowedFork, schemaVersion: 2 }), { status: 200 }),
    );
    await expect(
      getTeachingFacts({
        schemaVersion: 1,
        fenBefore: allowedFork.fenBefore,
        playedMoveUci: allowedFork.played.move.uci,
      }),
    ).rejects.toThrow(/schema mismatch/);
  });
});
