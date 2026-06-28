import { describe, expect, it } from 'vitest';
import type {
  FactCollection,
  HazardFact,
  MoveStateFacts,
  PositionFacts,
  StructureDelta,
} from '../../teaching/types';
import {
  type AttributedFactBranch,
  attributeBranch,
} from '../branch';

// ── Minimal but real MoveStateFacts builders ──────────────────────────────────
// Constructed against the actual engine/teaching/types.ts shapes (no invented
// fields): MoveStateFacts = { move, fenAfter, position, deltas{...} }.

function emptyHazards(): FactCollection<HazardFact> {
  return { status: 'computed', items: [] };
}

function emptyStructures(): FactCollection<StructureDelta> {
  return { status: 'computed', items: [] };
}

function emptyPosition(side: 'white' | 'black'): PositionFacts {
  const empty = { status: 'computed' as const, items: [] };
  return {
    sideToMove: side,
    pieces: [],
    pawnStructure: {
      doubled: [],
      isolated: [],
      passed: [],
      islands: [],
      backward: empty,
      connectedPassed: empty,
      openFiles: empty,
      semiOpenFiles: empty,
      kingShieldMissing: empty,
      pawnChains: empty,
    },
    kingSafety: empty,
    availableCaptures: empty,
    opponentAvailableCaptures: empty,
    availableMotifs: empty,
    availablePins: empty,
    opponentAvailableMotifs: empty,
    opponentAvailablePins: empty,
    hazards: empty,
  };
}

function moveState(uci: string, fenAfter: string): MoveStateFacts {
  return {
    move: { uci, from: uci.slice(0, 2), to: uci.slice(2, 4) },
    fenAfter,
    position: emptyPosition('black'),
    deltas: {
      createdHazards: emptyHazards(),
      removedHazards: emptyHazards(),
      worsenedHazards: emptyHazards(),
      createdStructures: emptyStructures(),
      removedStructures: emptyStructures(),
    },
  };
}

const FEN_AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

describe('attributeBranch (PR-09 branch attribution)', () => {
  it('the same UCI move from two engines yields two distinct attributed sources', () => {
    const sfState = moveState('e2e4', FEN_AFTER_E4);
    const cvsState = moveState('e2e4', FEN_AFTER_E4);

    const sf = attributeBranch('stockfish', 'best', 'e2e4', sfState);
    const cvs = attributeBranch('cvs', 'best', 'e2e4', cvsState);

    // Same move string, same role — but they are NOT the same branch: source
    // distinguishes them so Stockfish-best and CVS-best are never conflated.
    expect(sf.moveUci).toBe(cvs.moveUci);
    expect(sf.role).toBe(cvs.role);
    expect(sf.source).toBe('stockfish');
    expect(cvs.source).toBe('cvs');
    expect(sf.source).not.toBe(cvs.source);
    expect(sf).not.toBe(cvs);
    expect(sf.state).toBe(sfState);
    expect(cvs.state).toBe(cvsState);
  });

  it('a missing branch stays absent (an optional slot is undefined, not a placeholder)', () => {
    // The frame models "no such branch" as an absent optional field. Modeling that
    // here: only the played slot is attributed; the best slot remains undefined.
    const slots: {
      played?: AttributedFactBranch;
      cvsBest?: AttributedFactBranch;
    } = {
      played: attributeBranch('user', 'played', 'e2e4', moveState('e2e4', FEN_AFTER_E4)),
    };

    expect(slots.played).toBeDefined();
    expect(slots.played?.source).toBe('user');
    expect(slots.cvsBest).toBeUndefined();
  });

  it('a wrong-source branch cannot be relabeled (attribution is fixed at creation)', () => {
    const original = attributeBranch('stockfish', 'best', 'd2d4', moveState('d2d4', FEN_AFTER_E4));

    // attributeBranch is pure: the only way to "change" the source is to build a
    // new value. The original is untouched, and the rebuild is a different object.
    const relabeled = attributeBranch('cvs', original.role, original.moveUci, original.state);

    expect(original.source).toBe('stockfish');
    expect(relabeled.source).toBe('cvs');
    expect(relabeled).not.toBe(original);
    // Same underlying facts payload is shared, but the attribution differs.
    expect(relabeled.state).toBe(original.state);
    expect(relabeled.moveUci).toBe(original.moveUci);
    expect(relabeled.role).toBe(original.role);
  });
});
