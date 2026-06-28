import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HazardFact, TeachingFactBundleV1 } from '../types';
import type { TeachingNode } from '../node';
import { selectPrimaryTeachingNode } from '../canonical';
import { PUZZLE_ELIGIBLE_DELTA_TOPICS, proposeDeltaTopics } from '../delta-topics';

function load(name: string): TeachingFactBundleV1 {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/teaching-facts/v1/${name}.json`, import.meta.url), 'utf8'),
  ) as TeachingFactBundleV1;
}

/** Clone the real pawn-structure-damage bundle and override the played deltas. */
function withDeltas(over: Partial<TeachingFactBundleV1['played']['deltas']>): TeachingFactBundleV1 {
  const b = structuredClone(load('pawn-structure-damage'));
  const empty = { status: 'computed' as const, items: [] };
  b.played.deltas = {
    createdHazards: empty,
    removedHazards: empty,
    worsenedHazards: empty,
    createdStructures: empty,
    removedStructures: empty,
    ...over,
  };
  return b;
}

function hazard(kind: string, squares: string[]): HazardFact {
  return { id: `${kind}-${squares.join('')}`, kind, side: 'black', squares };
}

describe('proposeDeltaTopics (PR-14)', () => {
  it('proposes created structural topics from a real damage fixture (positive)', () => {
    const nodes = proposeDeltaTopics(load('pawn-structure-damage'));
    const codes = new Set(nodes.map((n) => n.conceptCode));
    expect(codes.has('created_doubled_pawns')).toBe(true);
    expect(codes.has('created_isolated_pawn')).toBe(true);
    expect(codes.has('created_passed_pawn')).toBe(true);
    // (The fixture also produces "repaired"/removed structure topics — both are
    // valid; here we assert the universal node properties, not a single direction.)
    for (const n of nodes) {
      expect(n.claimStatus).toBe('confirmed');
      expect(n.kind).toBe('structural');
      expect(n.verification.required).toBe(false);
    }
    expect(nodes.find((n) => n.conceptCode === 'created_doubled_pawns')?.summary.toLowerCase()).toContain(
      'created',
    );
  });

  it('proposes nothing when there are no matching deltas (negative)', () => {
    expect(proposeDeltaTopics(withDeltas({}))).toEqual([]);
  });

  it('maps hazard deltas to king-safety / conversion topics', () => {
    const created = proposeDeltaTopics(
      withDeltas({ createdHazards: { status: 'computed', items: [hazard('king_pressure', ['g7', 'h7'])] } }),
    );
    expect(created[0]?.conceptCode).toBe('created_king_pressure');
    expect(created[0]?.kind).toBe('king-safety');

    const removed = proposeDeltaTopics(
      withDeltas({ removedHazards: { status: 'computed', items: [hazard('losing_material', ['e5'])] } }),
    );
    expect(removed[0]?.conceptCode).toBe('removed_material_hazard');
    expect(removed[0]?.kind).toBe('conversion');

    const mate = proposeDeltaTopics(
      withDeltas({ createdHazards: { status: 'computed', items: [hazard('mate_threat', ['g8'])] } }),
    );
    expect(mate[0]?.conceptCode).toBe('created_mate_threat');
  });

  it('is deterministic (stable ids + order)', () => {
    const a = proposeDeltaTopics(load('pawn-structure-damage'));
    const b = proposeDeltaTopics(load('pawn-structure-damage'));
    expect(a).toEqual(b);
    expect(a.map((n) => n.id)).toEqual([...a.map((n) => n.id)].sort());
  });

  it('uses factual, non-causal language', () => {
    const nodes = proposeDeltaTopics(load('pawn-structure-damage'));
    for (const n of nodes) {
      expect(n.summary).not.toMatch(/lost|blunder|guarantee|decisive|winning/i);
    }
  });

  it('marks only tactical-payoff topics puzzle-eligible', () => {
    expect(PUZZLE_ELIGIBLE_DELTA_TOPICS.has('created_mate_threat')).toBe(true);
    expect(PUZZLE_ELIGIBLE_DELTA_TOPICS.has('created_doubled_pawns')).toBe(false);
  });

  it('ranks below a confirmed tactic in primary selection (interaction)', () => {
    const tactic: TeachingNode = {
      schemaVersion: 1,
      id: 'fork:e4',
      rootPositionKey: 'k',
      subjectMove: 'a1e1',
      kind: 'tactic',
      conceptCode: 'knight_multi_attack',
      claimStatus: 'confirmed',
      confidence: 0.8,
      title: 'Fork',
      summary: 'Knight forks two pieces.',
      involvedSquares: ['e4'],
      boardPayload: {},
      verification: { required: true, status: 'confirmed' },
      provenance: { factIds: [], detectorIds: ['fork_validation'], pipelineVersion: '1' },
    };
    const deltaNodes = proposeDeltaTopics(load('pawn-structure-damage'));
    const primary = selectPrimaryTeachingNode([...deltaNodes, tactic]);
    expect(primary?.kind).toBe('tactic');
  });
});
