// The refutation diff must only name the IMMEDIATE reply's capture (pv[0]) on the
// ACTUAL position — never a future-PV square that may be empty on the displayed board
// (the "Bxb5 wins a pawn on an empty b5" hallucination).
import { describe, it, expect } from 'vitest';
import { diffRefutation } from '../diff';
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
