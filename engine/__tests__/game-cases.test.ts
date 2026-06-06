// Real game-history use cases (from reviewed games). Each maps a human-level
// pattern to the structured fact the engine must produce. Pure/deterministic:
// engine-driven cases inject stub evals so the oracle is reproducible.
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { findForks } from '../motif';
import { findPoisonedCaptures, seeOnSquare } from '../see';
import { findMatesIn1 } from '../motif';
import { buildRelationMap } from '../relations';
import { analyzeMove } from '../saliency';
import type { Eval } from '../types';

const ev = (cp: number, pv: string[]): Eval => ({ cp, depth: 14, pv });
function fenAfterMoves(moves: string[]): string {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen();
}
function play(fen: string, san: string): string {
  const c = new Chess(fen);
  c.move(san);
  return c.fen();
}

const OPENING = ['d4', 'd5', 'Bf4', 'Bf5', 'Nf3', 'Nc6', 'e3', 'Nb4']; // before 5.c3
const AFTER_C3 = [...OPENING, 'c3'];

// ── UC1 / UC5 — opened fork square + quiet move ignores a forcing threat ──────
describe('UC1/UC5 — 5.c3 opens c2; …Nc2+ is the refutation', () => {
  it('the played quiet move is punished by an opponent fork (top insight)', () => {
    const fenBefore = fenAfterMoves(OPENING);
    const fenAfter = fenAfterMoves(AFTER_C3);
    const r = analyzeMove({
      fenBefore,
      fenAfter,
      san: 'c3',
      evalBefore: ev(20, ['Bb5+']),
      evalAfter: ev(500, ['Nc2+', 'Kd2', 'Nxa1']), // Black to move wins material
    });
    const top = r.rankedInsights[0];
    expect(top.kind).toBe('motif');
    expect(top.type).toBe('fork');
    expect(top.source).toBe('refutation');
    expect(r.topExplanation).toContain('Nc2+');
    expect(r.topExplanation).toContain('fork');
  });
});

// ── UC2 — poisoned capture (legal but loses) ─────────────────────────────────
describe('UC2 — Qxc2 is a poisoned capture', () => {
  it('flags the legal capture that loses material to a hidden defender', () => {
    // After 5.c3 Nc2+, White to move: Qxc2?? Bxc2 wins the queen.
    const fen = play(fenAfterMoves(AFTER_C3), 'Nc2+');
    const poisoned = findPoisonedCaptures(fen);
    const q = poisoned.find((p) => p.san === 'Qxc2');
    expect(q).toBeDefined();
    expect(q!.loss).toBe(6); // queen (9) for knight (3)
  });
});

// ── UC4 — knight fork with check wins the queen ──────────────────────────────
describe('UC4 — Nf2+ forks king and queen', () => {
  it('detects the checking knight fork and the queen win', () => {
    const fen = '6k1/8/8/8/6n1/8/8/3Q3K b - - 0 1';
    const fork = findForks(fen).motifs.find((m) => m.type === 'fork');
    expect(fork).toBeDefined();
    expect(fork!.line[0]).toBe('Nf2+');
    expect(fork!.materialSwing).toBe(9); // wins the queen
  });
});

// ── UC8 — loose piece after a sequence of exchanges (the g4 knight) ───────────
describe('UC8 — the g4 knight is loose after the exchanges', () => {
  const fen = 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15';
  it('SEE flags it as winnable (+3) with zero defenders', () => {
    expect(seeOnSquare(fen, 'g4').swing).toBe(3);
    expect(buildRelationMap(fen).bySquare['g4'].defendedBy).toEqual([]);
  });
});

// ── UC10 — rook invasion / mating net (king safety over material) ────────────
describe('UC10 — R1e7# is a mating net, not a material grab', () => {
  it('detects the forced mate', () => {
    const fen = '4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31';
    const mate = findMatesIn1(fen).motifs.find((m) => m.line.includes('R1e7#'));
    expect(mate).toBeDefined();
    expect(mate!.consequence.mateIn).toBe(1);
  });
});

// ── UC11 — opponent misses the stronger tactic ───────────────────────────────
describe('UC11 — Black plays Bxb1 but missed the stronger Nc2+ fork', () => {
  it('surfaces the missed fork as an available insight', () => {
    const fenBefore = fenAfterMoves(AFTER_C3); // Black to move, Nc2+ available
    const fenAfter = play(fenBefore, 'Bxb1');
    const r = analyzeMove({
      fenBefore,
      fenAfter,
      san: 'Bxb1',
      evalBefore: ev(500, ['Nc2+', 'Kd2', 'Nxa1']), // the fork was best
      evalAfter: ev(40, ['Rxb1']), // Bxb1 just trades, White recaptures
    });
    const missed = r.rankedInsights.find(
      (i) => i.kind === 'motif' && i.type === 'fork' && i.source === 'available',
    );
    expect(missed).toBeDefined();
    expect((missed as { line: string[] }).line[0]).toBe('Nc2+');
  });
});

// ── UC7 — development with tempo against an exposed queen ─────────────────────
describe('UC7 — …Nd4 attacks the exposed queen (refutation if ignored)', () => {
  it('an undefended attacked queen is SEE-losing for its owner', () => {
    // 1.e4 e5 2.Bc4 Bc5 3.Qf3 Nf6 4.b3 d6 5.Bb2 Nc6 6.g4 Nd4 — Black just hit Qf3.
    const fen = fenAfterMoves([
      'e4', 'e5', 'Bc4', 'Bc5', 'Qf3', 'Nf6', 'b3', 'd6', 'Bb2', 'Nc6', 'g4', 'Nd4',
    ]);
    // White to move; the queen on f3 is attacked by Nd4 and undefended.
    const rel = buildRelationMap(fen);
    expect(rel.bySquare['f3'].piece).toBe('wQ');
    expect(rel.bySquare['f3'].attackedBy.some((id) => id.startsWith('bN'))).toBe(true);
    expect(seeOnSquare(fen, 'f3').swing).toBeGreaterThan(0); // queen is losing material
  });
});
