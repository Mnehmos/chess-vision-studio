import { describe, expect, it } from 'vitest';
import { describeMoveIdea } from '../moveIdea';
import type {
  CaptureOpportunity,
  MotifOpportunity,
  PieceRef,
  PinOpportunity,
  TeachingFactBundleV1,
} from '../types';

const NA = { status: 'uncomputed', reason: 'test' } as const;

function ref(side: 'white' | 'black', pieceType: PieceRef['pieceType'], square: string): PieceRef {
  return { id: `${side}-${pieceType}-${square}`, side, pieceType, square };
}

// Minimal bundle exercising only the fields describeMoveIdea reads.
function bundle(over: {
  uci: string;
  motifs?: MotifOpportunity[];
  pins?: PinOpportunity[];
  captures?: CaptureOpportunity[];
}): TeachingFactBundleV1 {
  const before = {
    sideToMove: 'black',
    pieces: [],
    pawnStructure: {},
    kingSafety: NA,
    availableCaptures: over.captures ? { status: 'computed', items: over.captures } : NA,
    opponentAvailableCaptures: NA,
    availableMotifs: over.motifs ? { status: 'computed', items: over.motifs } : NA,
    availablePins: over.pins ? { status: 'computed', items: over.pins } : NA,
    opponentAvailableMotifs: NA,
    opponentAvailablePins: NA,
    hazards: NA,
  };
  return {
    schemaVersion: 1,
    fenBefore: '',
    before,
    played: { move: { uci: over.uci, from: over.uci.slice(0, 2), to: over.uci.slice(2, 4) }, fenAfter: '', position: before, deltas: {} },
    provenance: {},
    errors: [],
  } as unknown as TeachingFactBundleV1;
}

describe('describeMoveIdea — a move’s tactical content from validated facts', () => {
  it('describes a queen check-fork by its real targets (the London Qb4+ case)', () => {
    const fork: MotifOpportunity = {
      kind: 'fork',
      validator: 'fork_validation',
      moveUci: 'd6b4',
      forkingPiece: ref('black', 'queen', 'b4'),
      targets: [ref('white', 'king', 'g1'), ref('white', 'rook', 'e1'), ref('white', 'bishop', 'f4')],
      givesCheck: true,
      kingTarget: true,
      materialGain: 500,
    };
    const idea = describeMoveIdea(bundle({ uci: 'd6b4', motifs: [fork] }));
    expect(idea?.kind).toBe('fork');
    expect(idea?.text).toContain('forks');
    expect(idea?.text).toContain('rook on e1');
    expect(idea?.text).toContain('bishop on f4');
    expect(idea?.squares).toContain('b4');
  });

  it('describes a pin to the king', () => {
    const pin: PinOpportunity = {
      kind: 'absolute',
      validator: 'pin_validation',
      moveUci: 'b5c6',
      pinner: ref('white', 'bishop', 'b5'),
      pinned: ref('black', 'knight', 'c6'),
      anchor: ref('black', 'king', 'e8'),
      ray: ['c6', 'd7', 'e8'],
      givesCheck: false,
      pinnedImmobile: true,
    };
    const idea = describeMoveIdea(bundle({ uci: 'b5c6', pins: [pin] }));
    expect(idea?.kind).toBe('pin');
    expect(idea?.text).toContain('pins the knight on c6');
  });

  it('describes a clearly winning capture, but not an even trade', () => {
    const cap = (seeCp: number): CaptureOpportunity => ({
      moveUci: 'f3e5',
      attacker: ref('white', 'knight', 'e5'),
      victim: ref('black', 'pawn', 'e5'),
      victimSquare: 'e5',
      seeCp,
      givesCheck: false,
      capturingPieceSurvives: true,
      highestValueSafeCapture: true,
    });
    expect(describeMoveIdea(bundle({ uci: 'f3e5', captures: [cap(100)] }))?.text).toContain(
      'Wins the pawn on e5',
    );
    // An even/losing trade is just a move, not a teaching point.
    expect(describeMoveIdea(bundle({ uci: 'f3e5', captures: [cap(0)] }))).toBeNull();
  });

  it('returns null for a quiet move with no matching opportunity', () => {
    expect(describeMoveIdea(bundle({ uci: 'g1f3' }))).toBeNull();
  });
});
