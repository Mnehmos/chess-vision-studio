// M1 DoD — correct attackedBy/defendedBy for every occupied square, verified
// against hand-checked positions, INCLUDING the g4-knight from the sample game.
import { describe, it, expect } from 'vitest';
import { buildRelationMap } from '../relations';

describe('M1 — relation maps', () => {
  it('g4-knight (before 15.Qxg4): attacked only by the white queen, zero black defenders', () => {
    // Real position from the sample game, ply before 15.Qxg4.
    const fen = 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15';
    const rel = buildRelationMap(fen);
    const g4 = rel.bySquare['g4'];
    expect(g4.piece).toBe('bN');
    expect(g4.attackedBy).toEqual(['wQd1']); // d1–e2–f3–g4 diagonal is clear
    expect(g4.defendedBy).toEqual([]); // the knight is loose — SEE ≈ +3 for White
    // and the white queen's square is genuinely controlled by White
    expect(rel.controlledByWhite).toContain('g4');
    expect(rel.controlledByBlack).not.toContain('g4');
  });

  it('mutual pawn attacks (e4 vs d5)', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    const rel = buildRelationMap(fen);
    expect(rel.bySquare['e4'].attackedBy).toEqual(['bPd5']);
    expect(rel.bySquare['e4'].defendedBy).toEqual([]);
    expect(rel.bySquare['d5'].attackedBy).toEqual(['wPe4']);
    expect(rel.bySquare['d5'].defendedBy).toEqual([]);
  });

  it('rook along a rank + king adjacency both count as defenders; piece is not its own defender', () => {
    const fen = '4k3/8/8/8/8/8/R3R3/4K3 w - - 0 1';
    const rel = buildRelationMap(fen);
    // e2 rook is defended by the king (adjacent) and the a2 rook (clear rank).
    expect(rel.bySquare['e2'].defendedBy).toEqual(['wKe1', 'wRa2']);
    expect(rel.bySquare['e2'].attackedBy).toEqual([]);
    // a2 rook is defended by the e2 rook (clear rank), not by the distant king.
    expect(rel.bySquare['a2'].defendedBy).toEqual(['wRe2']);
  });

  it('a blocker breaks the slider line (x-ray is not a direct attacker)', () => {
    // a2 R, b2 P, e2 R, e1 K. The b2 pawn blocks a2's view of e2.
    const fen = '4k3/8/8/8/8/8/RP2R3/4K3 w - - 0 1';
    const rel = buildRelationMap(fen);
    expect(rel.bySquare['e2'].defendedBy).toEqual(['wKe1']); // a2 is blocked
    expect(rel.bySquare['b2'].defendedBy).toEqual(['wRa2', 'wRe2']); // both rooks reach b2
  });

  it('builds a relation entry for every occupied square only', () => {
    const fen = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
    const rel = buildRelationMap(fen);
    const occupied = ['e8', 'd5', 'e4', 'e1'].sort();
    expect(Object.keys(rel.bySquare).sort()).toEqual(occupied);
  });
});
