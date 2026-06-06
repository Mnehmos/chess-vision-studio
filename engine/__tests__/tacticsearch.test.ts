// The forcing-move tactical search is the independent ground-truth ORACLE used
// to cross-check the geometric motif detectors. These tests pin its behavior.
import { describe, it, expect } from 'vitest';
import { tacticalOutcome, forcedMateIn } from '../tacticsearch';

describe('tacticsearch — material', () => {
  it('wins a free queen (+9) and a free rook (+5)', () => {
    expect(tacticalOutcome('3q3k/8/8/8/8/8/8/3R3K w - - 0 1', 6).gain).toBe(9);
    expect(tacticalOutcome('3r3k/8/8/8/8/8/8/3R3K w - - 0 1', 6).gain).toBe(5);
  });

  it('sees the poisoned defender: …Nc2+ Qxc2?? …Bxc2 wins for Black', () => {
    // White to move, in check from …Nc2+ — White comes out materially worse.
    const out = tacticalOutcome(
      'r2qkbnr/ppp1pppp/8/3p1b2/1n1P1B2/2P1PN2/PPn2PPP/RN1QKB1R w KQkq - 0 6',
      6,
    );
    expect(out.gain).toBeLessThan(0); // the side to move (White) is losing material
  });

  it('accounts for insufficient-material draws (K+N v K = 0, not +3)', () => {
    // Winning the lone queen leaves K+N v K — a draw, which the search knows.
    const out = tacticalOutcome('6k1/8/8/8/6n1/8/8/3Q3K b - - 0 1', 8);
    expect(out.gain).toBe(6); // from −6 (down Q for N) up to 0 (draw), i.e. +6
  });
});

describe('tacticsearch — forced mate', () => {
  it('detects mate-in-1 (checks force the reply)', () => {
    expect(forcedMateIn('4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31', 5)).toBe(1);
    expect(forcedMateIn('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 5)).toBe(1);
  });

  it('returns null when there is no forced (forcing) mate', () => {
    expect(forcedMateIn('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 5)).toBeNull();
  });
});
