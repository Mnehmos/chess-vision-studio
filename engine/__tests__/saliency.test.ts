// M4 DoD (CROWN JEWEL) — all three required, and NOT validated on a capture
// (Invariant 9). Evals are injected as stubs so these tests are deterministic
// and discriminate the ranker, not the engine.
import { describe, it, expect } from 'vitest';
import { analyzeMove } from '../saliency';
import type { Eval } from '../types';

const ev = (cp: number, pv: string[]): Eval => ({ cp, depth: 14, pv });

// Base position: a quiet White knight move (Nd4) leaves the e5 pawn undefended.
// 7 relationships change; exactly one (e5) is a material loss.
const FEN_BEFORE = 'r2q1rk1/ppp2ppp/2np1n2/4P3/8/5N2/PPP1BPPP/R2Q1RK1 w - - 0 1';
const FEN_AFTER_Nd4 = 'r2q1rk1/ppp2ppp/2np1n2/4P3/3N4/8/PPP1BPPP/R2Q1RK1 b - - 1 1';

describe('M4.1 — quiet move, ~10 changes: the ranker names the material one', () => {
  const result = analyzeMove({
    fenBefore: FEN_BEFORE,
    fenAfter: FEN_AFTER_Nd4,
    san: 'Nd4', // NOT a capture (Invariant 9)
    evalBefore: ev(20, ['Re1', 'Re8']),
    // quiet PV (does NOT punish e5) so this isolates the diff-attribution path
    evalAfter: ev(80, ['Rf8e8', 'Nf3']),
  });

  it('passes the gate and surfaces several changed relationships', () => {
    expect(result.cpLoss).toBeCloseTo(1.0, 5);
    expect(result.rankedInsights.length).toBeGreaterThanOrEqual(6);
  });

  it('the TOP insight is the hung e5 pawn, not one of the ~6 noise changes', () => {
    const top = result.rankedInsights[0];
    expect(top.squares).toContain('e5');
    expect(top.materialSwing).toBe(1);
    expect(top.kind).toBe('changed_relation');
    expect(top.source).toBe('played_move');
    expect(result.topExplanation.toLowerCase()).toContain('e5');
    expect(result.topExplanation.toLowerCase()).toContain('losing material');
  });

  it('the noise changes rank below the material one (saliency ordering)', () => {
    const top = result.rankedInsights[0];
    const rest = result.rankedInsights.slice(1);
    expect(rest.every((r) => r.saliency <= top.saliency)).toBe(true);
    expect(rest.every((r) => r.materialSwing === 0)).toBe(true);
  });
});

describe('M4.2 — silence: a solid equal move says nothing', () => {
  it('cpLoss below the gate → explicit silence, no insights', () => {
    const result = analyzeMove({
      fenBefore: FEN_BEFORE,
      fenAfter: 'r2q1rk1/ppp2ppp/2np1n2/4P3/3N4/8/PPP1BPPP/R2Q1RK1 b - - 1 1',
      san: 'Nd4',
      evalBefore: ev(20, ['Re1']),
      evalAfter: ev(-20, ['Re8']), // opponent sees ≈ −0.2 → cpLoss ≈ 0
    });
    expect(result.cpLoss).toBeLessThan(0.3);
    expect(result.rankedInsights).toEqual([]);
    expect(result.topExplanation).toBe('Solid move — nothing important changed.');
  });
});

describe('M4.3 — refutation: the punishment is the opponent’s best reply', () => {
  // Same hung-pawn position, but now the injected PV PUNISHES it: ...dxe5.
  const result = analyzeMove({
    fenBefore: FEN_BEFORE,
    fenAfter: FEN_AFTER_Nd4,
    san: 'Nd4',
    evalBefore: ev(20, ['Re1']),
    evalAfter: ev(80, ['dxe5', 'Qd4']), // opponent's best reply wins the pawn
  });

  it('the salient change is tagged source:refutation and ties the loss to the reply', () => {
    const top = result.rankedInsights[0];
    expect(top.source).toBe('refutation');
    expect(top.inPV).toBe(true);
    expect(top.squares).toContain('e5');
    expect(top.materialSwing).toBe(1);
    expect(top.evidence.join(' ')).toContain('dxe5'); // names the exploiting reply
  });

  it('a refutation outranks the bare before/after diff for the same square (no double-count)', () => {
    const e5Insights = result.rankedInsights.filter((r) => r.squares.includes('e5'));
    expect(e5Insights).toHaveLength(1); // the played_move diff was subsumed
    expect(e5Insights[0].source).toBe('refutation');
  });
});
