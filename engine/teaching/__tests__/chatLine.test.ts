import { describe, expect, it } from 'vitest';
import { cadenceAllows, curateChatLine } from '../chatLine';
import type {
  FactCollection,
  HazardFact,
  MotifOpportunity,
  PieceRef,
  PinOpportunity,
  PositionFacts,
  TeachingFactBundleV1,
} from '../types';

const NA = { status: 'uncomputed', reason: 'test' } as const;
const NONE: FactCollection<never> = { status: 'computed', items: [] };
const EMPTY_STRUCTS = { status: 'computed', items: [] } as const;

function ref(pieceType: PieceRef['pieceType'], square: string, side: 'white' | 'black' = 'black'): PieceRef {
  return { id: `${side}-${pieceType}-${square}`, side, pieceType, square };
}

function facts(over: Partial<Record<string, FactCollection<unknown>>> = {}): PositionFacts {
  return {
    sideToMove: 'white',
    pieces: [],
    pawnStructure: {},
    kingSafety: NA,
    availableCaptures: NONE,
    opponentAvailableCaptures: NONE,
    availableMotifs: NONE,
    availablePins: NONE,
    opponentAvailableMotifs: NONE,
    opponentAvailablePins: NONE,
    hazards: NONE,
    ...over,
  } as unknown as PositionFacts;
}

function bundle(params: {
  uci: string;
  before?: PositionFacts;
  after?: PositionFacts;
  createdHazards?: HazardFact[];
  removedHazards?: HazardFact[];
  createdStructures?: { kind: string; squares: string[] }[];
}): TeachingFactBundleV1 {
  return {
    schemaVersion: 1,
    fenBefore: 'test-fen',
    before: params.before ?? facts(),
    played: {
      move: { uci: params.uci, from: params.uci.slice(0, 2), to: params.uci.slice(2, 4) },
      fenAfter: 'test-fen-after',
      position: params.after ?? facts(),
      deltas: {
        createdHazards: params.createdHazards
          ? { status: 'computed', items: params.createdHazards }
          : NONE,
        removedHazards: params.removedHazards
          ? { status: 'computed', items: params.removedHazards }
          : NONE,
        worsenedHazards: NONE,
        createdStructures: params.createdStructures
          ? { status: 'computed', items: params.createdStructures as never }
          : EMPTY_STRUCTS,
        removedStructures: EMPTY_STRUCTS,
      },
    },
    provenance: { engine: 'cvs-bitboard-core', factsRegistryVersion: 23, validators: [] },
    errors: [],
  } as unknown as TeachingFactBundleV1;
}

const FORK: MotifOpportunity = {
  kind: 'fork',
  validator: 'fork_validation',
  moveUci: 'g1f3',
  forkingPiece: ref('knight', 'f3'),
  targets: [ref('queen', 'd4'), ref('rook', 'e5')],
  givesCheck: false,
  kingTarget: false,
  materialGain: 500,
};

describe('curateChatLine — our move', () => {
  it('speaks a validated fork from its own participants', () => {
    const b = bundle({ uci: 'g1f3', before: facts({ availableMotifs: { status: 'computed', items: [FORK] } }) });
    const line = curateChatLine(b, { subject: 'ours', moveLabel: 'Nf3' });
    expect(line?.tier).toBe(2);
    expect(line?.text).toBe('Nf3 forks queen on d4 and rook on e5 — wins about 5.0.');
    expect(line?.validators).toEqual(['fork_validation']);
  });

  it('renders an absolute pin to the king and a relative pin to its anchor', () => {
    const abs: PinOpportunity = {
      kind: 'absolute', validator: 'pin_validation', moveUci: 'f1b5',
      pinner: ref('bishop', 'b5'), pinned: ref('knight', 'c6'), anchor: ref('king', 'e8'),
      ray: ['c6', 'd7', 'e8'], givesCheck: false, pinnedImmobile: true,
    };
    const rel: PinOpportunity = { ...abs, kind: 'relative', anchor: ref('queen', 'd8'), pinnedImmobile: false };
    const a = curateChatLine(bundle({ uci: 'f1b5', before: facts({ availablePins: { status: 'computed', items: [abs] } }) }),
      { subject: 'ours', moveLabel: 'Bb5' });
    expect(a?.text).toBe('Bb5 pins knight on c6 to the king — it cannot move.');
    const r = curateChatLine(bundle({ uci: 'f1b5', before: facts({ availablePins: { status: 'computed', items: [rel] } }) }),
      { subject: 'ours', moveLabel: 'Bb5' });
    expect(r?.text).toBe('Bb5 pins knight on c6 to queen on d8.');
  });

  it('ranks a mate threat above material', () => {
    // A mate threat is only attributed to our move when the hazard names that move:
    // `before.hazards` describes the current position, and a pre-existing threat our
    // move happens to ignore must not be reported as "creates a mate threat".
    const mate: HazardFact = {
      id: 'h1', kind: 'mate_threat', side: 'white', squares: ['g7', 'h7'],
      magnitudeCp: 9000, moveUci: 'g1f3',
    };
    const b = bundle({
      uci: 'g1f3',
      before: facts({ availableMotifs: { status: 'computed', items: [FORK] }, hazards: { status: 'computed', items: [mate] } }),
    });
    const line = curateChatLine(b, { subject: 'ours', moveLabel: 'Nf3' });
    expect(line?.tier).toBe(1);
    expect(line?.text).toContain('mate threat');
  });

  it('stays silent when the only candidate is hygiene (magnitude-less removed hazard)', () => {
    const b = bundle({
      uci: 'e5e4',
      removedHazards: [{ id: 'h2', kind: 'losing_material', side: 'white', squares: ['e5'], magnitudeCp: 0 }],
    });
    expect(curateChatLine(b, { subject: 'ours', moveLabel: 'e4' })).toBeNull();
  });

  it('does not call a cramped castled king "under pressure" without attackers', () => {
    const ks = {
      side: 'white', kingSquare: 'g1', inCheck: false, attackers: [],
      pressuredSquares: [], legalEscapeSquares: { status: 'computed', items: ['h1'] },
    };
    const b = bundle({ uci: 'a1b1', before: facts({ kingSafety: { status: 'computed', items: [ks] as never } }) });
    expect(curateChatLine(b, { subject: 'ours', moveLabel: 'Rb1' })).toBeNull();
  });

  it('speaks king pressure when attackers justify it', () => {
    const ks = {
      side: 'white', kingSquare: 'g1', inCheck: false,
      attackers: [ref('queen', 'h4'), ref('bishop', 'd5')],
      pressuredSquares: ['g2'], legalEscapeSquares: { status: 'computed', items: [] },
    };
    const b = bundle({ uci: 'g1h1', before: facts({ kingSafety: { status: 'computed', items: [ks] as never } }) });
    const line = curateChatLine(b, { subject: 'ours', moveLabel: 'Kh1' });
    expect(line?.tier).toBe(3);
    expect(line?.text).toContain('2 attackers');
    expect(line?.text).toContain('no escape squares');
  });

  it('honours the spoken set', () => {
    const b = bundle({ uci: 'g1f3', before: facts({ availableMotifs: { status: 'computed', items: [FORK] } }) });
    const first = curateChatLine(b, { subject: 'ours', moveLabel: 'Nf3' });
    expect(first).not.toBeNull();
    const second = curateChatLine(b, { subject: 'ours', moveLabel: 'Nf3', spoken: new Set([first!.key]) });
    expect(second).toBeNull();
  });

  it('fails closed on uncomputed collections', () => {
    const b = bundle({ uci: 'g1f3' });
    expect(curateChatLine(b, { subject: 'ours', moveLabel: 'Nf3' })).toBeNull();
  });
});

describe('curateChatLine — their move', () => {
  it('speaks a motif the move newly allowed, and not one that already existed', () => {
    const allowed = bundle({
      uci: 'h7h6',
      before: facts({ opponentAvailableMotifs: NONE }),
      after: facts({ availableMotifs: { status: 'computed', items: [FORK] } }),
    });
    const line = curateChatLine(allowed, { subject: 'theirs', moveLabel: 'h6' });
    expect(line?.conceptCode).toBe('allowed_fork');
    expect(line?.text).toBe('h6 allows fork: queen on d4 and rook on e5 (wins about 5.0).');

    const already = bundle({
      uci: 'h7h6',
      before: facts({ opponentAvailableMotifs: { status: 'computed', items: [FORK] } }),
      after: facts({ availableMotifs: { status: 'computed', items: [FORK] } }),
    });
    expect(curateChatLine(already, { subject: 'theirs', moveLabel: 'h6' })).toBeNull();
  });
});

describe('cadenceAllows', () => {
  it('allows the first line and then enforces spacing', () => {
    expect(cadenceAllows(new Set(), 0)).toBe(true);
    expect(cadenceAllows(new Set(['k']), 2, 6)).toBe(false);
    expect(cadenceAllows(new Set(['k']), 7, 6)).toBe(true);
  });
});
