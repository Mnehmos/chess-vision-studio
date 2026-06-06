// Proof obligations: the gate is the fix. No mate obligation from the start
// position (no check, roomy king) → the expensive solver is never invoked there.
import { describe, it, expect } from 'vitest';
import {
  gateMateObligation,
  dischargeMate,
  proveMate,
  sideToMoveHasCheck,
  kingEscapeSquares,
} from '../proof';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const R1E7 = '4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 1';
const BACKRANK = '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1';

describe('cheap gates', () => {
  it('the start position has no check available (so no obligation, regardless of escapes)', () => {
    expect(sideToMoveHasCheck(START)).toBe(false);
    // the king is boxed by its OWN army (0 flee squares) but is not in danger —
    // which is exactly why the gate also requires a check before firing.
    expect(kingEscapeSquares(START, 'b')).toBe(0);
  });
  it('a mating position has a check available and a cramped enemy king', () => {
    expect(sideToMoveHasCheck(BACKRANK)).toBe(true);
    expect(kingEscapeSquares(BACKRANK, 'b')).toBeLessThanOrEqual(2);
  });
});

describe('gateMateObligation — the obligation queue', () => {
  it('creates ZERO mate obligations from the start position', () => {
    expect(gateMateObligation(START)).toBeNull();
  });
  it('creates an obligation when mate pressure exists', () => {
    const ob = gateMateObligation(BACKRANK);
    expect(ob).not.toBeNull();
    expect(ob!.type).toBe('mate_proof');
  });
  it('a Stockfish mate score is the strongest gate (highest priority)', () => {
    const ob = gateMateObligation(R1E7, { stockfishMate: 1 });
    expect(ob).not.toBeNull();
    expect(ob!.priority).toBeGreaterThanOrEqual(100);
  });
});

describe('dischargeMate — proved / timeout', () => {
  it('proves the back-rank mate-in-1', () => {
    const ob = gateMateObligation(BACKRANK)!;
    const r = dischargeMate(ob);
    expect(r.status).toBe('proved');
    expect(r.mateInMoves).toBe(1);
    expect(r.line![0]).toBe('Re8#');
  });
  it('proveMate returns the mate, or null when there is none/no obligation', () => {
    expect(proveMate(R1E7)?.mateInMoves).toBe(1);
    expect(proveMate(START)).toBeNull(); // no obligation → never searches
  });
});
