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

describe('delivering checkmate is the BEST move, never a blunder', () => {
  it('R1e7# is classified best with cpLoss 0 and a checkmate explanation', () => {
    const r = analyzeMove({
      fenBefore: '4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31',
      fenAfter: '4R3/3NRkpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/6K1 b - - 1 31',
      san: 'R1e7#',
      evalBefore: ev(0, ['R1e7#']), // (eval irrelevant — terminal short-circuit)
      evalAfter: ev(0, []), // Stockfish returns nothing for a mated position
    });
    expect(r.classification).toBe('best');
    expect(r.cpLoss).toBe(0);
    expect(r.topExplanation).toContain('Checkmate');
    expect(r.topExplanation).toContain('R1e7#');
    expect(r.rankedInsights).toEqual([]); // you did not "miss" any other mate
  });
});

describe('Invariant 4 — no insight may claim more material than the eval budget', () => {
  it('rejects a refutation that claims a rook when cpLoss is only ~1 (the ply-49 bug)', () => {
    // A deep-PV / isolated-SEE over-claim: materialSwing 5 with a tiny eval swing.
    const inflated = {
      id: 'inflated',
      kind: 'changed_relation' as const,
      type: 'now_see_losing' as const,
      side: 'black' as const,
      squares: ['b6'],
      arrows: [] as [string, string][],
      source: 'refutation' as const,
      materialSwing: 5, // "wins a rook" — but the eval says otherwise
      kingSafetyDelta: 0,
      inPV: true,
      saliency: 0,
      templateId: 'refutation_wins_material',
      evidence: ['bogus +5'],
    };
    const r = analyzeMove(
      {
        fenBefore: FEN_BEFORE,
        fenAfter: FEN_AFTER_Nd4,
        san: 'Nd4',
        evalBefore: ev(20, ['Re1']),
        evalAfter: ev(80, ['Re8']), // cpLoss ≈ 1.0 → budget 2.5, well under 5
      },
      [inflated],
    );
    expect(r.cpLoss).toBeCloseTo(1.0, 5);
    expect(r.rankedInsights.find((i) => i.id === 'inflated')).toBeUndefined();
    // a legitimately-sized insight (the e5 pawn, swing 1) survives
    expect(r.rankedInsights.some((i) => i.squares.includes('e5'))).toBe(true);
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

describe('pv_refutation fallback — a quiet/positional blunder no detector names', () => {
  // White plays a quiet a3; nothing hangs by SEE (all diffs are materialSwing 0),
  // but the injected eval says Black is winning via a QUIET line (no capture/mate/
  // motif in the first plies). The honest fallback must headline the oracle line,
  // not saliency-0 "now defended" trivia.
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const AFTER_a3 = 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1';
  const result = analyzeMove({
    fenBefore: START,
    fenAfter: AFTER_a3,
    san: 'a3',
    evalBefore: ev(20, ['e4']),
    evalAfter: ev(300, ['e5', 'd4']), // Black (to move) is +3 via a quiet push
  });

  it('classifies as a blunder by eval', () => {
    expect(result.cpLoss).toBeCloseTo(3.2, 5);
    expect(result.classification).toBe('blunder');
  });

  it('the headline is the honest oracle line, not saliency-0 trivia', () => {
    const top = result.rankedInsights[0];
    expect(top.type).toBe('pv_refutation');
    expect(top.saliency).toBeGreaterThanOrEqual(0.05);
    expect(top.inPV).toBe(true);
    expect(top.materialSwing).toBe(0); // honest: claims no proven material
    expect(result.topExplanation.toLowerCase()).toContain('quiet refutation');
    expect(result.topExplanation).toContain('e5'); // names the refuting first move
    expect(result.topExplanation.toLowerCase()).not.toContain('now defended');
  });

  it('tags the gap as future detector work and keeps the literal facts below', () => {
    const top = result.rankedInsights[0];
    expect(top.evidence.join(' ')).toContain('candidate_for_new_detector');
    expect(top.evidence.join(' ')).toContain('pv_refutation_required');
    // the fallback is PREPENDED, not a replacement — any diffs stay in the list below it
    expect(result.rankedInsights[0].type).toBe('pv_refutation');
    expect(result.rankedInsights.slice(1).every((i) => i.type !== 'pv_refutation')).toBe(true);
  });

  it('with no PV available, refuses to headline trivia and says so honestly', () => {
    const r = analyzeMove({
      fenBefore: START,
      fenAfter: AFTER_a3,
      san: 'a3',
      evalBefore: ev(20, ['e4']),
      evalAfter: ev(300, []), // no oracle line to fall back on
    });
    expect(r.classification).toBe('blunder');
    expect(r.topExplanation.toLowerCase()).toContain('no named tactic');
    expect(r.topExplanation.toLowerCase()).not.toContain('now defended');
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
