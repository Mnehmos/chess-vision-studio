// Bounded forced-mate solver. The architecture GATES invocation (no obligation →
// no call); the node budget is the safety net so even an ungated call returns
// null promptly ("no proof within budget" = an acceptable timeout) instead of
// the catastrophic full-width explosion on a no-mate position.
import { describe, it, expect } from 'vitest';
import { forcedMate } from '../matesolver';

describe('forcedMate — correctness', () => {
  it('finds mate-in-1 (back rank)', () => {
    const r = forcedMate('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1')!;
    expect(r.mateInMoves).toBe(1);
    expect(r.line[0]).toBe('Re8#');
  });

  it('finds the sample-game R1e7# mate-in-1', () => {
    const r = forcedMate('4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31')!;
    expect(r.mateInMoves).toBe(1);
    expect(r.line.at(-1)).toContain('#');
  });

  it('finds a dataset mate-in-2 (queen + rook)', () => {
    const r = forcedMate('6k1/5ppp/8/7Q/8/8/6PP/5RK1 w - - 0 1', 3, 3000);
    expect(r).not.toBeNull();
    expect(r!.mateInMoves).toBeLessThanOrEqual(2);
  });
});

describe('forcedMate — bounded (no runaway, timeout is acceptable)', () => {
  it('returns null within the TIME budget on the start position (the 110s-runaway fix)', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const t0 = Date.now();
    const r = forcedMate(start, 7, 400); // 400ms wall-clock budget
    const ms = Date.now() - t0;
    expect(r).toBeNull(); // no forced mate
    expect(ms).toBeLessThan(1500); // gave up at the deadline, not after 110s
  });

  it('a wide no-mate middlegame times out fast rather than exploding', () => {
    const t0 = Date.now();
    const r = forcedMate('r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 1', 7, 400);
    expect(r).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
