// M3 DoD — cpLoss correct on constructed positions (a known blunder yields ≈
// the material lost; an only/best move yields ≈0); classification labels match
// the thresholds. Pure tests inject stub Evals (Invariant: engine mockable);
// one integration test confirms the sign-flip end-to-end with real Stockfish.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Chess } from 'chess.js';
import { evalToPawns, computeCpLoss, classify, gradeMove } from '../classify';
import { UciEngine } from '../evaluation';
import { createNodeStockfishTransport } from '../stockfish-node';
import type { Eval } from '../types';

const cp = (n: number, pv: string[] = ['Nf3']): Eval => ({ cp: n, depth: 14, pv });
const mate = (n: number, pv: string[] = ['Qh7#']): Eval => ({ mate: n, depth: 14, pv });

describe('M3 — evalToPawns', () => {
  it('converts centipawns to pawns', () => {
    expect(evalToPawns(cp(50))).toBe(0.5);
    expect(evalToPawns(cp(-120))).toBe(-1.2);
    expect(evalToPawns({ depth: 14, pv: [] })).toBe(0);
  });
  it('maps mate to a large sentinel; closer mates are bigger', () => {
    expect(evalToPawns(mate(1))).toBe(99);
    expect(evalToPawns(mate(5))).toBe(95);
    expect(evalToPawns(mate(-3))).toBe(-97); // being mated
    expect(evalToPawns(mate(1))).toBeGreaterThan(evalToPawns(mate(5)));
  });
});

describe('M3 — computeCpLoss honors the side-to-move sign flip', () => {
  it('a best move keeps equality → cpLoss ≈ 0', () => {
    // before: +0.3 for S. after: S played best, opponent to move sees −0.3.
    expect(computeCpLoss(cp(30), cp(-30))).toBeCloseTo(0, 5);
  });
  it('hanging a piece → cpLoss ≈ the material lost', () => {
    // before: +0.5 for S. after: opponent is now +3 (S dropped a minor).
    expect(computeCpLoss(cp(50), cp(300))).toBeCloseTo(3.5, 5);
  });
  it('throwing away a forced mate is a huge loss', () => {
    // before: S had mate in 2. after: opponent to move sees a dead-equal game.
    expect(computeCpLoss(mate(2), cp(0))).toBeGreaterThan(50);
  });
  it('never reports a negative loss (clamped at 0)', () => {
    expect(computeCpLoss(cp(20), cp(-100))).toBe(0);
  });
});

describe('M3 — classify thresholds', () => {
  it('maps loss → label at the documented boundaries', () => {
    expect(classify(0.05)).toBe('best');
    expect(classify(0.2)).toBe('excellent');
    expect(classify(0.3)).toBe('good'); // 0.3 is NOT < 0.3
    expect(classify(0.5)).toBe('good');
    expect(classify(1.0)).toBe('inaccuracy');
    expect(classify(2.0)).toBe('mistake');
    expect(classify(2.5)).toBe('blunder');
    expect(classify(9)).toBe('blunder');
  });
});

describe('M3 — engine-driven grading (sign-flip end-to-end)', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = new UciEngine(await createNodeStockfishTransport());
  }, 30000);
  afterAll(() => engine?.dispose());

  it("playing the engine's own best move yields ≈0 loss", async () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const bestUci = await engine.bestMove(startFen, 14);
    const chess = new Chess(startFen);
    const san = chess.move({
      from: bestUci.slice(0, 2),
      to: bestUci.slice(2, 4),
      promotion: bestUci.length > 4 ? bestUci.slice(4, 5) : undefined,
    })!.san;
    const grade = await gradeMove(engine, startFen, san, 14);
    expect(grade.cpLoss).toBeLessThan(0.5);
    expect(['best', 'excellent', 'good']).toContain(grade.classification);
  }, 25000);

  it('hanging the queen for free is graded a blunder', () => {
    // White is up a queen (Q+2R vs 2R). Qd8?? simply drops it to ...Rxd8.
    const fen = 'r4rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q1RK1 w - - 0 1';
    return gradeMove(engine, fen, 'Qd8', 14).then((grade) => {
      expect(grade.cpLoss).toBeGreaterThan(4);
      expect(grade.classification).toBe('blunder');
    });
  }, 25000);
});
