import { describe, expect, it } from 'vitest';
import {
  CANONICAL_TEACHING_SCHEMA_VERSION,
  buildCanonicalTeaching,
  comparePrimary,
  projectTeachingNodeToLegacyEvent,
  selectPrimaryTeachingNode,
} from '../canonical';
import { TEACHING_NODE_SCHEMA_VERSION, type TeachingNode } from '../node';
import type { TeachingFactBundleV1 } from '../types';

// ── Synthetic node factory ──────────────────────────────────────────────────
// Builds a committed-shaped TeachingNode with sensible defaults. Every field is a
// REAL field from node.ts TeachingNode; overrides let each test pin the keys it
// cares about.
function makeNode(overrides: Partial<TeachingNode> = {}): TeachingNode {
  const base: TeachingNode = {
    schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
    id: 'node:default',
    rootPositionKey: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    subjectMove: 'e2e4',
    kind: 'tactic',
    conceptCode: 'queen_multi_attack',
    claimStatus: 'unverified',
    confidence: 0.8,
    title: 'Default Node',
    summary: 'Default summary.',
    involvedSquares: ['a4', 'e8'],
    boardPayload: {},
    verification: {
      required: true,
      status: 'unverified',
      rootMove: 'e2e4',
      expectedMove: 'd1a4',
    },
    provenance: {
      factIds: ['fact-1'],
      detectorIds: ['fork_validation'],
      pipelineVersion: '1',
    },
  };
  return { ...base, ...overrides };
}

// ── Minimal facts for projection detail ─────────────────────────────────────
// A skeletal but type-valid TeachingFactBundleV1. Only the collections a given
// projection reads are populated per test.
function emptyPosition(sideToMove: 'white' | 'black'): TeachingFactBundleV1['before'] {
  return {
    sideToMove,
    pieces: [],
    pawnStructure: {
      doubled: [],
      isolated: [],
      passed: [],
      islands: [],
      backward: { status: 'computed', items: [] },
      connectedPassed: { status: 'computed', items: [] },
      openFiles: { status: 'computed', items: [] },
      semiOpenFiles: { status: 'computed', items: [] },
      kingShieldMissing: { status: 'computed', items: [] },
      pawnChains: { status: 'computed', items: [] },
    },
    kingSafety: { status: 'computed', items: [] },
    availableCaptures: { status: 'computed', items: [] },
    opponentAvailableCaptures: { status: 'computed', items: [] },
    availableMotifs: { status: 'computed', items: [] },
    availablePins: { status: 'computed', items: [] },
    opponentAvailableMotifs: { status: 'computed', items: [] },
    opponentAvailablePins: { status: 'computed', items: [] },
    hazards: { status: 'computed', items: [] },
  };
}

function makeFacts(
  mover: 'white' | 'black',
  patch: (facts: TeachingFactBundleV1) => void = () => {},
): TeachingFactBundleV1 {
  const facts: TeachingFactBundleV1 = {
    schemaVersion: 1,
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    before: emptyPosition(mover),
    played: {
      move: { uci: 'e2e4', from: 'e2', to: 'e4' },
      fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      position: emptyPosition(mover === 'white' ? 'black' : 'white'),
      deltas: {
        createdHazards: { status: 'computed', items: [] },
        removedHazards: { status: 'computed', items: [] },
        worsenedHazards: { status: 'computed', items: [] },
        createdStructures: { status: 'computed', items: [] },
        removedStructures: { status: 'computed', items: [] },
      },
    },
    provenance: {
      engine: 'cvs-rust',
      factsRegistryVersion: 5,
      validators: [],
    },
    errors: [],
  };
  patch(facts);
  return facts;
}

describe('selectPrimaryTeachingNode determinism', () => {
  it('returns null for an empty node list', () => {
    expect(selectPrimaryTeachingNode([])).toBeNull();
  });

  it('is invariant under input array reordering', () => {
    const a = makeNode({ id: 'a', claimStatus: 'confirmed', kind: 'tactic', confidence: 0.9 });
    const b = makeNode({ id: 'b', claimStatus: 'refuted', kind: 'tactic', confidence: 0.9 });
    const c = makeNode({ id: 'c', claimStatus: 'confirmed', kind: 'structural', confidence: 1.0 });

    const forward = selectPrimaryTeachingNode([a, b, c]);
    const reversed = selectPrimaryTeachingNode([c, b, a]);
    const shuffled = selectPrimaryTeachingNode([b, c, a]);

    expect(forward?.id).toBe(reversed?.id);
    expect(forward?.id).toBe(shuffled?.id);
  });

  it('prefers confirmed over unverified over refuted over unavailable', () => {
    const confirmed = makeNode({ id: 'x-confirmed', claimStatus: 'confirmed' });
    const unverified = makeNode({ id: 'a-unverified', claimStatus: 'unverified' });
    const refuted = makeNode({ id: 'a-refuted', claimStatus: 'refuted' });
    const unavailable = makeNode({ id: 'a-unavailable', claimStatus: 'unavailable' });

    const primary = selectPrimaryTeachingNode([unavailable, refuted, unverified, confirmed]);
    expect(primary?.id).toBe('x-confirmed');
  });

  it('prefers a tactical kind over a structural kind at equal status', () => {
    const tactic = makeNode({ id: 'z-tactic', claimStatus: 'confirmed', kind: 'tactic', confidence: 0.5 });
    const structural = makeNode({
      id: 'a-structural',
      claimStatus: 'confirmed',
      kind: 'structural',
      confidence: 1.0,
    });
    const primary = selectPrimaryTeachingNode([structural, tactic]);
    expect(primary?.id).toBe('z-tactic');
  });

  it('breaks confidence ties on the stable node id', () => {
    const high = makeNode({ id: 'aaa', claimStatus: 'confirmed', kind: 'tactic', confidence: 0.8 });
    const low = makeNode({ id: 'zzz', claimStatus: 'confirmed', kind: 'tactic', confidence: 0.8 });
    expect(selectPrimaryTeachingNode([low, high])?.id).toBe('aaa');
    // comparePrimary is a strict total order: a<b ⇒ b>a.
    expect(comparePrimary(high, low)).toBeLessThan(0);
    expect(comparePrimary(low, high)).toBeGreaterThan(0);
    expect(comparePrimary(high, high)).toBe(0);
  });
});

describe('buildCanonicalTeaching', () => {
  it('wraps nodes with the v2 schema and a primary node id reference', () => {
    const a = makeNode({ id: 'a', claimStatus: 'refuted', kind: 'tactic' });
    const b = makeNode({ id: 'b', claimStatus: 'confirmed', kind: 'tactic' });
    const canonical = buildCanonicalTeaching([a, b]);

    expect(canonical.schemaVersion).toBe(CANONICAL_TEACHING_SCHEMA_VERSION);
    expect(canonical.nodes).toHaveLength(2);
    expect(canonical.primaryNodeId).toBe('b');
    expect(canonical.provenance.nodeSchemaVersion).toBe(TEACHING_NODE_SCHEMA_VERSION);
    expect(canonical.provenance.pipelineVersion).toBe('1');
    expect(typeof canonical.provenance.compilerVersion).toBe('number');
    expect(typeof canonical.provenance.factsRegistryVersion).toBe('number');
  });

  it('reports null primary and null pipeline version for an empty/mixed set', () => {
    expect(buildCanonicalTeaching([]).primaryNodeId).toBeNull();
    const mixed = buildCanonicalTeaching([
      makeNode({ id: 'a', provenance: { factIds: [], detectorIds: [], pipelineVersion: '1' } }),
      makeNode({ id: 'b', provenance: { factIds: [], detectorIds: [], pipelineVersion: '2' } }),
    ]);
    expect(mixed.provenance.pipelineVersion).toBeNull();
  });
});

describe('projectTeachingNodeToLegacyEvent — five topics', () => {
  it('projects a fork node to allowed_fork', () => {
    const node = makeNode({
      id: 'fork:e2e4:d1a4',
      kind: 'tactic',
      conceptCode: 'queen_multi_attack',
      claimStatus: 'confirmed',
      subjectMove: 'e2e4',
      involvedSquares: ['a4', 'a7', 'e8'],
      verification: { required: true, status: 'confirmed', expectedMove: 'd1a4' },
    });
    const facts = makeFacts('white', (f) => {
      f.played.position.availableMotifs = {
        status: 'computed',
        items: [
          {
            kind: 'fork',
            validator: 'fork_validation',
            moveUci: 'd1a4',
            forkingPiece: { id: 'white-queen', side: 'white', pieceType: 'queen', square: 'a4' },
            targets: [
              { id: 'black-king', side: 'black', pieceType: 'king', square: 'e8' },
              { id: 'black-pawn-a7', side: 'black', pieceType: 'pawn', square: 'a7' },
            ],
            givesCheck: true,
            kingTarget: true,
            materialGain: 100,
          },
        ],
      };
    });
    const event = projectTeachingNodeToLegacyEvent(node, facts);
    expect(event).not.toBeNull();
    if (!event) return;
    expect(event.topicId).toBe('allowed_fork');
    expect(event.family).toBe('tactics');
    expect(event.action).toBe('allowed');
    expect(event.mechanism).toBe('fork');
    expect(event.actors[0]?.square).toBe('a4');
    expect(event.targets.map((t) => t.square)).toContain('e8');
    expect(event.punishment?.move).toBe('d1a4');
    expect(event.proof.badge).toBe('engine_line');
  });

  it('projects a pin node to allowed_pin', () => {
    const node = makeNode({
      id: 'pin:e2e4:c4',
      kind: 'tactic',
      conceptCode: 'pin',
      claimStatus: 'confirmed',
      involvedSquares: ['c4', 'd5', 'e8'],
      verification: { required: true, status: 'confirmed', expectedMove: 'f1b5' },
    });
    const facts = makeFacts('white', (f) => {
      f.played.position.availablePins = {
        status: 'computed',
        items: [
          {
            kind: 'absolute',
            validator: 'pin_validation',
            moveUci: 'f1b5',
            pinner: { id: 'white-bishop', side: 'white', pieceType: 'bishop', square: 'b5' },
            pinned: { id: 'black-knight', side: 'black', pieceType: 'knight', square: 'c6' },
            anchor: { id: 'black-king', side: 'black', pieceType: 'king', square: 'e8' },
            ray: ['b5', 'c6', 'd7', 'e8'],
            givesCheck: false,
            pinnedImmobile: true,
          },
        ],
      };
    });
    const event = projectTeachingNodeToLegacyEvent(node, facts);
    expect(event?.topicId).toBe('allowed_pin');
    expect(event?.mechanism).toBe('pin');
    expect(event?.actors[0]?.square).toBe('b5');
    expect(event?.targets.map((t) => t.square)).toEqual(['c6', 'e8']);
  });

  it('projects a missed_hanging_piece node', () => {
    const node = makeNode({
      id: 'missed_hanging_piece:e2e4:d5',
      kind: 'tactic',
      conceptCode: 'missed_hanging_piece',
      claimStatus: 'unverified',
      involvedSquares: ['d5'],
      verification: { required: true, status: 'unverified', expectedMove: 'e4d5' },
    });
    const facts = makeFacts('white', (f) => {
      f.before.pieces = [
        {
          id: 'black-pawn-d5',
          side: 'black',
          pieceType: 'pawn',
          square: 'd5',
          attackers: [],
          defenders: [],
          attackerCount: 0,
          defenderCount: 0,
          attacked: true,
          loose: true,
          see: { status: 'computed', value: { losing: true, bestCaptureUci: 'e4d5', scoreCp: 100 } },
          onlyDefenderOf: [],
        },
      ];
    });
    const event = projectTeachingNodeToLegacyEvent(node, facts);
    expect(event?.topicId).toBe('missed_hanging_piece');
    expect(event?.family).toBe('piece_safety');
    expect(event?.action).toBe('missed');
    expect(event?.mechanism).toBe('hanging_piece');
    expect(event?.targets[0]?.square).toBe('d5');
    expect(event?.proof.evidence[0]?.kind).toBe('hanging_piece');
  });

  it('projects a failed_defense node and maps mechanism from the hazard kind', () => {
    const node = makeNode({
      id: 'failed_defense:e2e4:g5f3',
      kind: 'defense',
      conceptCode: 'failed_defense',
      claimStatus: 'confirmed',
      involvedSquares: ['e2'],
      verification: { required: true, status: 'confirmed', expectedMove: 'g5f3' },
    });
    const facts = makeFacts('white', (f) => {
      f.before.hazards = {
        status: 'computed',
        items: [
          {
            id: 'hazard-mate',
            kind: 'mate_threat',
            side: 'white',
            squares: ['e2'],
            moveUci: 'g5f3',
          },
        ],
      };
    });
    const event = projectTeachingNodeToLegacyEvent(node, facts);
    expect(event?.topicId).toBe('failed_defense');
    expect(event?.family).toBe('defense');
    expect(event?.action).toBe('failed_to_answer');
    expect(event?.mechanism).toBe('king_attack');
    expect(event?.punishment?.move).toBe('g5f3');
  });

  it('projects a pawn_structure_damage node with structural evidence', () => {
    const node = makeNode({
      id: 'pawn_structure_damage:c3d4:c3-c4',
      kind: 'structural',
      conceptCode: 'pawn_structure_damage',
      claimStatus: 'confirmed',
      subjectMove: 'c3d4',
      involvedSquares: ['c3', 'c4'],
      verification: { required: false, status: 'confirmed', conclusionCode: 'preserves_evaluation' },
      provenance: { factIds: ['ds-1'], detectorIds: ['pawn_structure'], pipelineVersion: '1' },
    });
    const facts = makeFacts('white', (f) => {
      f.played.deltas.createdStructures = {
        status: 'computed',
        items: [{ factId: 'ds-1', kind: 'doubled_pawns', side: 'white', squares: ['c3', 'c4'] }],
      };
    });
    const event = projectTeachingNodeToLegacyEvent(node, facts);
    expect(event?.topicId).toBe('pawn_structure_damage');
    expect(event?.family).toBe('pawn_structure');
    expect(event?.action).toBe('created');
    expect(event?.mechanism).toBe('doubled_pawn');
    expect(event?.consequence.structuralChanges?.[0]?.factId).toBe('ds-1');
    expect(event?.proof.badge).toBe('structural_fact');
  });

  it('returns null for an unknown conceptCode', () => {
    const node = makeNode({ conceptCode: 'mobility_squeeze', kind: 'mobility' });
    expect(projectTeachingNodeToLegacyEvent(node)).toBeNull();
  });

  it('projects without facts (deterministic defaults, still well-formed)', () => {
    const node = makeNode({
      id: 'fork:e2e4:d1a4',
      conceptCode: 'queen_multi_attack',
      claimStatus: 'unverified',
      involvedSquares: ['a4', 'e8'],
    });
    const event = projectTeachingNodeToLegacyEvent(node);
    expect(event?.topicId).toBe('allowed_fork');
    expect(event?.squares).toEqual(['a4', 'e8']);
    expect(event?.proof.evidence).toHaveLength(1);
    expect(event?.saliency).toBe(node.confidence);
  });
});
