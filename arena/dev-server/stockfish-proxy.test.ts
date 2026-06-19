import { describe, expect, it, vi } from 'vitest';
import {
  completeStockfishRequest,
  expireStockfishRequest,
  type SfPending,
} from './stockfish-proxy';

function pending(overrides: Partial<SfPending> = {}): SfPending {
  return {
    fen: 'startpos',
    depth: 24,
    resolve: vi.fn(),
    reject: vi.fn(),
    timer: setTimeout(() => {}, 60_000),
    best: null,
    settled: false,
    ...overrides,
  };
}

describe('Stockfish request lifecycle', () => {
  it('keeps a timed-out active search current until its late bestmove is drained', () => {
    const active = pending();
    const next = pending({ fen: 'next position' });
    const state = { busy: true, current: active, queue: [next] };
    const stop = vi.fn();
    const pump = vi.fn();

    expireStockfishRequest(state, active, stop);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(active.reject).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stockfish request timed out' }));
    expect(active.settled).toBe(true);
    expect(state.current).toBe(active);
    expect(state.busy).toBe(true);
    expect(state.queue).toEqual([next]);

    completeStockfishRequest(state, 'e2e4', pump);

    expect(active.resolve).not.toHaveBeenCalled();
    expect(state.current).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.queue).toEqual([next]);
    expect(pump).toHaveBeenCalledTimes(1);
    clearTimeout(next.timer);
  });

  it('removes a queued timeout without stopping the active search', () => {
    const active = pending();
    const queued = pending({ fen: 'queued position' });
    const state = { busy: true, current: active, queue: [queued] };
    const stop = vi.fn();

    expireStockfishRequest(state, queued, stop);

    expect(stop).not.toHaveBeenCalled();
    expect(state.queue).toEqual([]);
    expect(state.current).toBe(active);
    expect(queued.reject).toHaveBeenCalledTimes(1);
    clearTimeout(active.timer);
    clearTimeout(queued.timer);
  });

  it('resolves a normal completed search with the latest info line', () => {
    const active = pending({
      best: { depth: 24, scoreCp: 31, mate: null, pv: ['e2e4', 'e7e5'] },
    });
    const state = { busy: true, current: active, queue: [] as SfPending[] };

    completeStockfishRequest(state, 'e2e4', vi.fn());

    expect(active.resolve).toHaveBeenCalledWith({
      fen: 'startpos',
      bestmove: 'e2e4',
      scoreCp: 31,
      mate: null,
      pv: ['e2e4', 'e7e5'],
      depth: 24,
    });
    expect(active.settled).toBe(true);
  });
});
