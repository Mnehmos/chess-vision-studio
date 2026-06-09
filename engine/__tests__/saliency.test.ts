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
    expect(result.confidence).toBe('semantic_overlay'); // a real material change, not a proven tactic
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

describe('M4.2 — low-loss moves still get semantic explanations', () => {
  it('cpLoss below the gate → explicit silence, no insights', () => {
    const result = analyzeMove({
      fenBefore: FEN_BEFORE,
      fenAfter: 'r2q1rk1/ppp2ppp/2np1n2/4P3/3N4/8/PPP1BPPP/R2Q1RK1 b - - 1 1',
      san: 'Nd4',
      evalBefore: ev(20, ['Re1']),
      evalAfter: ev(-20, ['Re8']), // opponent sees ≈ −0.2 → cpLoss ≈ 0
    });
    expect(result.cpLoss).toBeLessThan(0.3);
    expect(result.rankedInsights.some((i) => i.type === 'mobility_improved')).toBe(true);
    // Low-loss no longer means no insight; master-game moves are usually low-loss.
    expect(result.topExplanation).toMatch(/mobility/i);
    expect(result.topExplanation).not.toMatch(/nothing important changed/i);
    expect(result.confidence).toBe('low_salience_fallback');
  });
});

describe('hard board events are never "nothing changed", even at zero eval swing', () => {
  it('a promotion-with-check (a1=Q+) names the event instead of staying silent', () => {
    const r = analyzeMove({
      fenBefore: 'K7/8/8/8/8/8/p7/7k b - - 0 1',
      fenAfter: 'K7/8/8/8/8/8/8/q6k w - - 0 2',
      san: 'a1=Q+',
      evalBefore: ev(900, ['a1=Q+']),
      evalAfter: ev(-900, ['Kb7']), // Black already winning → eval flat → cpLoss ≈ 0
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).not.toMatch(/nothing important changed/i);
    expect(r.topExplanation.toLowerCase()).toContain('promotion');
    expect(r.topExplanation.toLowerCase()).toContain('check');
  });
});

describe('captures and the low-loss gate', () => {
  it('a material-winning capture is never "nothing changed" (SEE != 0)', () => {
    const r = analyzeMove({
      fenBefore: '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1', // Nxe5 wins the free e5 pawn
      fenAfter: '4k3/8/8/4N3/8/8/8/4K3 b - - 0 1',
      san: 'Nxe5',
      evalBefore: ev(100, ['Nxe5']),
      evalAfter: ev(-100, ['Ke7']), // playing the best move → cpLoss ≈ 0
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).not.toMatch(/nothing important changed/i);
    expect(r.topExplanation.toLowerCase()).toContain('capture');
  });

  it('an even-trade capture (SEE 0) names the recapture instead of falling back', () => {
    const r = analyzeMove({
      fenBefore: '4k3/8/3p4/4p3/3P4/8/8/4K3 w - - 0 40', // dxe5, recaptured by d6xe5 → even
      fenAfter: '4k3/8/3p4/4P3/8/8/8/4K3 b - - 0 40',
      san: 'dxe5',
      evalBefore: ev(0, ['dxe5']),
      evalAfter: ev(0, ['dxe5']),
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    // Even trades are still concrete chess events.
    expect(r.topExplanation).toContain('captures on e5');
    expect(r.topExplanation).toContain('Black can recapture with dxe5');
    expect(r.topExplanation).not.toMatch(/nothing important changed/i);
    expect(r.confidence).toBe('semantic_overlay');
  });
  it('a master-game equal capture names the immediate PV recapture', () => {
    const r = analyzeMove({
      fenBefore: 'r1bqk2r/p2nppbp/2pp1npB/1p6/3PP3/2N2P2/PPPQN1PP/R3KB1R b KQkq - 3 8',
      fenAfter: 'r1bqk2r/p2npp1p/2pp1npb/1p6/3PP3/2N2P2/PPPQN1PP/R3KB1R w KQkq - 0 9',
      san: 'Bxh6',
      evalBefore: ev(-4, ['O-O', 'Bxg7', 'Kxg7']),
      evalAfter: ev(-8, ['Qxh6', 'Qa5', 'Qd2']),
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).toContain('captures on h6');
    expect(r.topExplanation).toContain('White can recapture with Qxh6');
    expect(r.topExplanation).not.toMatch(/Opening move/i);
    expect(r.confidence).toBe('semantic_overlay');
  });
});

describe('quiet-move fallback is phase-aware (replaces the absolute "nothing important changed")', () => {
  const quiet = (fenBefore: string, fenAfter: string, san: string) =>
    analyzeMove({ fenBefore, fenAfter, san, evalBefore: ev(20, [san]), evalAfter: ev(-20, ['a6']) });

  it('opening → development / central-control framing', () => {
    const r = quiet(
      'rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 4 3',
      'rnbqkb1r/pppppppp/5n2/8/8/3P1N2/PPP1PPPP/RNBQKB1R b KQkq - 0 3',
      'd3',
    );
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.confidence).toBe('low_salience_fallback');
    expect(r.rankedInsights.some((i) => i.type === 'center_control_gained')).toBe(true);
    expect(r.topExplanation).toMatch(/central control/i);
  });

  it('middlegame → activity / defensive-relationships framing', () => {
    const r = quiet(
      'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 11',
      'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN1P/PP3PP1/R1BQ1RK1 b - - 0 11',
      'h3',
    );
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).toBe('No forcing tactic found. The move changes piece activity and defensive relationships.');
  });

  it('endgame → pawn-race / king-activity framing', () => {
    const r = quiet(
      'r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 25',
      'r5k1/5ppp/8/8/8/8/5PPP/R4K2 b - - 1 25',
      'Kf1',
    );
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).toBe('Endgame move: no immediate tactic detected. Check pawn races, king activity, and rook activity.');
  });
});

describe('insight ladder — semantic feature facts below tactics/material', () => {
  it('surfaces opening development/center evidence without claiming a tactic', () => {
    const r = analyzeMove({
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      fenAfter: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
      san: 'Nf3',
      evalBefore: ev(20, ['Nf3']),
      evalAfter: ev(20, ['Nf6']), // cpLoss = 0.4, enough to enter the ranker
    });
    expect(r.classification).toBe('good');
    expect(r.rankedInsights.some((i) => i.type === 'development_improved')).toBe(true);
    expect(r.rankedInsights.some((i) => i.type === 'center_control_gained')).toBe(true);
    expect(['development_improved', 'center_control_gained']).toContain(r.rankedInsights[0].type);
    expect(r.topExplanation).toMatch(/develops|central control/i);
    expect(r.confidence).toBe('low_salience_fallback');
  });

  it('runs the ladder even when the move has no cp loss', () => {
    const r = analyzeMove({
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      san: 'e4',
      evalBefore: ev(13, ['e4', 'e5']),
      evalAfter: ev(-17, ['e5', 'd4']),
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.rankedInsights.some((i) => i.type === 'center_control_gained')).toBe(true);
    expect(r.topExplanation).toMatch(/central control/i);
    expect(r.topExplanation).not.toMatch(/Opening move/i);
    expect(r.confidence).toBe('low_salience_fallback');
  });
});

describe('forced moves and mate-in-play are never "nothing changed"', () => {
  it('the only legal move into a lost position names the forced mate (the 17.Re1 case)', () => {
    const r = analyzeMove({
      fenBefore: '4k2r/ppp3pp/4n3/4p3/4R3/2P5/PP3PPP/RN1r2K1 w k - 1 17', // White in check, only Re1
      fenAfter: '4k2r/ppp3pp/4n3/4p3/8/2P5/PP3PPP/RN1rR1K1 b k - 2 17',
      san: 'Re1',
      evalBefore: { mate: -1, depth: 14, pv: ['Re1', 'Rxe1#'] },
      evalAfter: { mate: 1, depth: 14, pv: ['Rxe1#'] }, // Black still mates in 1
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).not.toMatch(/nothing important changed/i);
    expect(r.topExplanation.toLowerCase()).toContain('forced');
    expect(r.topExplanation.toLowerCase()).toContain('mate in 1');
  });

  it('a quiet move while the mover has a forced mate says so', () => {
    const r = analyzeMove({
      fenBefore: FEN_BEFORE,
      fenAfter: FEN_AFTER_Nd4,
      san: 'Nd4',
      evalBefore: { mate: 2, depth: 14, pv: ['Nd4'] }, // White mates in 2 (mate scores cancel → cpLoss≈0)
      evalAfter: { mate: -1, depth: 14, pv: ['Re8'] },
    });
    expect(r.cpLoss).toBeLessThan(0.3);
    expect(r.topExplanation).not.toMatch(/nothing important changed/i);
    expect(r.topExplanation.toLowerCase()).toContain('forced mate');
    expect(r.confidence).toBe('certain_tactical');
  });
});

// Iteration 3: salience — the most chess-important fact headlines, not the first valid one.
describe('salience priority — a new threat outranks a consolidation (the "F2 is now defended" bug)', () => {
  it('13.Be3 headlines the threat it creates (C5 now attacked), not a generic "now defended"', () => {
    // The exact position from the export: Be3 attacks the c5 bishop and also re-defends
    // f2/f6 — all saliency-0 deltas. now_attacked must win the tie over now_defended.
    const r = analyzeMove({
      fenBefore: '3rk2r/ppp3pp/4nn2/2b1p1B1/4P3/2P5/PP3PPP/RN3RK1 w k - 0 13',
      fenAfter: '3rk2r/ppp3pp/4nn2/2b1p3/4P3/2P1B3/PP3PPP/RN3RK1 b k - 1 13',
      san: 'Be3',
      evalBefore: ev(-268, ['Bxf6']),
      evalAfter: ev(320, ['Bxe3']), // even trade → no material refutation insight
    });
    expect(r.classification).toBe('good'); // cpLoss ≈ 0.52
    expect(r.topExplanation.toLowerCase()).toContain('now attacked');
    expect(r.topExplanation.toLowerCase()).not.toContain('now defended');
    // honest about it: it is only a generic relation delta, not a proven tactic
    expect(r.confidence).toBe('low_salience_fallback');
  });
});

describe('an unavailable eval is "unclassified", never a fake best/0.00', () => {
  it('does not collapse a failed search to cpLoss 0 → best → "Solid move"', () => {
    const r = analyzeMove({
      fenBefore: FEN_BEFORE,
      fenAfter: FEN_AFTER_Nd4,
      san: 'Nd4',
      evalBefore: { depth: 14, pv: [], status: 'unavailable' },
      evalAfter: ev(-20, ['Re8']),
    });
    expect(r.classification).toBe('unclassified');
    expect(r.topExplanation.toLowerCase()).toContain('unavailable');
    expect(r.topExplanation).not.toMatch(/solid move/i);
    expect(r.rankedInsights).toEqual([]);
  });
});

describe('capture claims must be legal on the displayed board (anti-hallucination)', () => {
  it('drops a refutation_wins_material insight whose target square is empty', () => {
    const bogus = {
      id: 'bogus',
      kind: 'changed_relation' as const,
      type: 'now_see_losing' as const,
      side: 'white' as const,
      squares: ['b5'], // empty on FEN_AFTER_Nd4
      arrows: [['c6', 'b5']] as [string, string][], // no legal capture c6→b5 exists
      source: 'refutation' as const,
      materialSwing: 1, // within the eval budget — only the legality check can drop it
      kingSafetyDelta: 0,
      inPV: true,
      saliency: 0,
      templateId: 'refutation_wins_material',
      evidence: ['reply Nxb5 wins 1 (SEE) on b5'],
    };
    const r = analyzeMove(
      {
        fenBefore: FEN_BEFORE,
        fenAfter: FEN_AFTER_Nd4,
        san: 'Nd4',
        evalBefore: ev(20, ['Re1']),
        evalAfter: ev(80, ['Re8']),
      },
      [bogus],
    );
    expect(r.rankedInsights.find((i) => i.id === 'bogus')).toBeUndefined();
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
    // +3.0 for the refuter is a CLEAR edge → "punishes" (never the old "quiet refutation").
    expect(result.topExplanation.toLowerCase()).toContain('punishes');
    expect(result.topExplanation.toLowerCase()).not.toContain('quiet refutation');
    expect(result.topExplanation).toContain('e5'); // names the refuting first move
    expect(result.topExplanation.toLowerCase()).not.toContain('now defended');
    expect(result.confidence).toBe('engine_pv'); // oracle PV line, not a named tactic
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
