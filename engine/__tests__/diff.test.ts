// The refutation diff must only name the IMMEDIATE reply's capture (pv[0]) on the
// ACTUAL position — never a future-PV square that may be empty on the displayed board
// (the "Bxb5 wins a pawn on an empty b5" hallucination). And a line the refuter drives
// with CHECKS must never be called "quiet" (the 56.Rxe6? perpetual case).
import { describe, it, expect } from 'vitest';
import { diffRefutation, pvRefutation, diffPlayedMove } from '../diff';
import { renderInsight } from '../explain';
import type { Eval } from '../types';

const ev = (pv: string[], over: Partial<Eval> = {}): Eval => ({ depth: 16, pv, ...over });

// White to move; the knight on f3 can win the undefended e5 pawn with Nxe5.
const FEN = '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1';

describe('diffRefutation — capture claims are anchored to the displayed board', () => {
  it('names the immediate reply capture (pv[0]) and its real square', () => {
    const out = diffRefutation(FEN, ev(['Nxe5']));
    expect(out).toHaveLength(1);
    expect(out[0].templateId).toBe('refutation_wins_material');
    expect(out[0].squares).toEqual(['e5']);
    expect(out[0].materialSwing).toBe(1);
  });

  it('does NOT claim a capture from a deeper PV ply (pv[0] is a quiet move)', () => {
    // The winning capture only appears at pv[2]; pv[0] is a quiet king move, so the
    // material refutation is suppressed and left to pvRefutation (honest framing).
    const out = diffRefutation(FEN, ev(['Kd2', 'Kd7', 'Nxe5']));
    expect(out).toEqual([]);
  });

  it('does not over-claim when the immediate reply is not a capture at all', () => {
    expect(diffRefutation(FEN, ev(['Ng5']))).toEqual([]);
  });
});

describe('pvRefutation — a line driven by checks is never "quiet"', () => {
  // Black (to move) can deliver Qe1+; the position is otherwise barren → perpetual/draw.
  const checkFen = '6k1/8/8/8/8/8/4q3/6K1 b - - 0 1';

  it('tags a level checking line as a perpetual / forced draw — not "quiet"', () => {
    const r = pvRefutation(checkFen, ev(['Qe1+', 'Kh2', 'Qe2+'], { cp: 0 }), 4.5);
    expect(r).not.toBeNull();
    expect(['perpetual_check', 'forcing_check_resource']).toContain(r!.type);
    expect(r!.evidence[0].toLowerCase()).not.toContain('quiet');
    expect(r!.evidence[0].toLowerCase()).toContain('perpetual');
  });

  it('keeps the quiet-refutation framing for a genuinely non-checking PV', () => {
    const r = pvRefutation(checkFen, ev(['Kf8', 'Kg2', 'Ke7'], { cp: 30 }), 1.0);
    expect(r!.type).toBe('pv_refutation');
    expect(r!.evidence[0].toLowerCase()).toContain('quiet');
  });

  it('a check line that SIMPLIFIES (has captures) is a forcing resource, not a perpetual', () => {
    // The 10.dxe4 case: …Bxf2+ Kxf2 Nxe4+ … Qxd1 Rxd1 is a queen trade, not a repetition.
    const fen = 'r2qk2r/ppp3pp/2n1Bn2/2b1p1B1/4P3/8/PPP2PPP/RN1Q1RK1 b kq - 0 10';
    const r = pvRefutation(fen, ev(['Bxf2+', 'Kxf2', 'Nxe4+', 'Kg1', 'Qxd1', 'Rxd1'], { cp: 26 }), 1.52);
    expect(r!.type).toBe('forcing_check_resource');
    expect(r!.evidence[0].toLowerCase()).not.toContain('perpetual');
    expect(r!.evidence[0].toLowerCase()).not.toContain('draw by repetition');
  });

  it('does not say "punishes" when the replying side is still worse (best resistance)', () => {
    // The 15...Ne4 case: White (to move) is clearly worse; Na3 only limits the damage.
    const fen = '3rk2r/ppp3pp/4n3/4p3/4n3/2P5/PP3PPP/RN2R1K1 w k - 2 16';
    const r = pvRefutation(fen, ev(['Na3', 'Nd6', 'Rxe5'], { cp: -220 }), 1.04);
    expect(r).not.toBeNull();
    expect(r!.evidence[0].toLowerCase()).not.toContain('punishes');
    expect(r!.evidence[0].toLowerCase()).toContain('limits the damage');
  });
});

describe('diffPlayedMove — the right word for the relation change', () => {
  it('a newly-attacked but still-defended square is "now attacked", not "undefended"', () => {
    // After 7...Nf6 the e4 pawn keeps its defender (1→1) but is now attacked (0→1).
    const before = 'r2qk1nr/ppp3pp/2npB3/2b1p3/4P3/3P4/PPP2PPP/RNBQK2R b KQkq - 0 7';
    const after = 'r2qk2r/ppp3pp/2npBn2/2b1p3/4P3/3P4/PPP2PPP/RNBQK2R w KQkq - 1 8';
    const e4 = diffPlayedMove(before, after).find((c) => c.squares[0] === 'e4');
    expect(e4?.type).toBe('now_attacked');
    expect(renderInsight(e4!)).toBe('E4 is now attacked.');
  });
});
