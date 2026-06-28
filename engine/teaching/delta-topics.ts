/**
 * Delta-topic proposer (plan §6 PR-14). Proposes additional canonical TeachingNodes
 * from the Rust-backed hazard/structure DELTAS a move produced — the topics that are
 * "ready now" because the engine already computes their evidence. Pure and additive:
 * it returns nodes; composition into the canonical pipeline happens in PR-15.
 *
 * Causal-language rule (§6 PR-14): a delta proves a fact CHANGED after the move, not
 * that the move was bad/decisive. Summaries say "created/removed/repaired", never
 * "lost the game" / "blunder" / "guarantees".
 */
import type { HazardFact, StructureDelta, TeachingFactBundleV1, FactCollection } from './types';
import { TEACHING_NODE_SCHEMA_VERSION, type TeachingNode, type TeachingNodeKind } from './node';

interface DeltaTopicSpec {
  conceptCode: string;
  kind: TeachingNodeKind;
  title: string;
  summary: (squares: string[]) => string;
  /** Tactical-payoff topics may seed puzzles; descriptive structural deltas do not. */
  puzzleEligible: boolean;
}

// Hazard-delta topics, keyed by direction then hazard kind.
const HAZARD_TOPICS: Record<'created' | 'removed', Record<string, DeltaTopicSpec>> = {
  created: {
    king_pressure: {
      conceptCode: 'created_king_pressure',
      kind: 'king-safety',
      title: 'Created king pressure',
      summary: (sq) => `The move created king pressure (${sq.join(', ')}).`,
      puzzleEligible: false,
    },
    mate_threat: {
      conceptCode: 'created_mate_threat',
      kind: 'king-safety',
      title: 'Created a mate threat',
      summary: (sq) => `The move created a mate threat (${sq.join(', ')}).`,
      puzzleEligible: true,
    },
  },
  removed: {
    losing_material: {
      conceptCode: 'removed_material_hazard',
      kind: 'conversion',
      title: 'Removed a material hazard',
      summary: (sq) => `The move removed a material hazard (${sq.join(', ')}).`,
      puzzleEligible: false,
    },
    mate_threat: {
      conceptCode: 'answered_mate_threat',
      kind: 'king-safety',
      title: 'Answered a mate threat',
      summary: (sq) => `The move answered a mate threat (${sq.join(', ')}).`,
      puzzleEligible: false,
    },
  },
};

// Structure-delta topics, keyed by direction then structure kind.
const STRUCTURE_TOPICS: Record<'created' | 'removed', Record<string, DeltaTopicSpec>> = {
  created: {
    passed_pawn: spec('created_passed_pawn', 'Created a passed pawn', 'created a passed pawn'),
    doubled_pawns: spec('created_doubled_pawns', 'Created doubled pawns', 'created doubled pawns'),
    isolated_pawn: spec('created_isolated_pawn', 'Created an isolated pawn', 'created an isolated pawn'),
  },
  removed: {
    passed_pawn: spec('removed_passed_pawn', 'Removed a passed pawn', 'removed a passed pawn'),
    doubled_pawns: spec('repaired_doubled_pawns', 'Repaired doubled pawns', 'repaired doubled pawns'),
    isolated_pawn: spec('repaired_isolated_pawn', 'Repaired an isolated pawn', 'repaired an isolated pawn'),
  },
};

function spec(conceptCode: string, title: string, phrase: string): DeltaTopicSpec {
  return {
    conceptCode,
    kind: 'structural',
    title,
    summary: (sq) => `The move ${phrase} (${sq.join(', ')}).`,
    puzzleEligible: false,
  };
}

function computedItems<T>(collection: FactCollection<T>): T[] {
  return collection.status === 'computed' ? collection.items : [];
}

function node(
  spec: DeltaTopicSpec,
  squares: string[],
  detectorId: string,
  factId: string | undefined,
  rootKey: string,
  subjectMove: string,
): TeachingNode {
  const involved = [...squares].sort();
  return {
    schemaVersion: TEACHING_NODE_SCHEMA_VERSION,
    id: `${spec.conceptCode}:${involved.join('-')}`,
    rootPositionKey: rootKey,
    subjectMove,
    kind: spec.kind,
    conceptCode: spec.conceptCode,
    // A delta is a deterministic Rust fact — the structural CHANGE is confirmed.
    claimStatus: 'confirmed',
    confidence: 0.7,
    title: spec.title,
    summary: spec.summary(involved),
    involvedSquares: involved,
    boardPayload: { squares: involved.map((square) => ({ square })) },
    // Structural/hazard deltas are deterministic — no engine verification required.
    verification: { required: false, status: 'confirmed' },
    provenance: {
      factIds: factId ? [factId] : [],
      detectorIds: [detectorId],
      pipelineVersion: '1',
    },
  };
}

/** Topics whose conceptCode seeds puzzle generation (tactical payoff only). */
export const PUZZLE_ELIGIBLE_DELTA_TOPICS: ReadonlySet<string> = new Set(
  [
    ...Object.values(HAZARD_TOPICS.created),
    ...Object.values(HAZARD_TOPICS.removed),
    ...Object.values(STRUCTURE_TOPICS.created),
    ...Object.values(STRUCTURE_TOPICS.removed),
  ]
    .filter((s) => s.puzzleEligible)
    .map((s) => s.conceptCode),
);

/**
 * Propose canonical TeachingNodes from a played move's hazard/structure deltas.
 * Deterministic: nodes are emitted in a fixed section order and each node's id is
 * content-derived, so the result is stable across runs.
 */
export function proposeDeltaTopics(bundle: TeachingFactBundleV1): TeachingNode[] {
  const rootKey = bundle.fenBefore;
  const subjectMove = bundle.played.move.uci;
  const deltas = bundle.played.deltas;
  const out: TeachingNode[] = [];

  const pushHazards = (collection: FactCollection<HazardFact>, dir: 'created' | 'removed') => {
    for (const hazard of computedItems(collection)) {
      const topic = HAZARD_TOPICS[dir][hazard.kind];
      if (topic) out.push(node(topic, hazard.squares, 'hazard_deltas', hazard.id, rootKey, subjectMove));
    }
  };
  const pushStructures = (collection: FactCollection<StructureDelta>, dir: 'created' | 'removed') => {
    for (const structure of computedItems(collection)) {
      const topic = STRUCTURE_TOPICS[dir][structure.kind];
      if (topic) out.push(node(topic, structure.squares, 'pawn_structure', structure.factId, rootKey, subjectMove));
    }
  };

  pushHazards(deltas.createdHazards, 'created');
  pushHazards(deltas.removedHazards, 'removed');
  pushStructures(deltas.createdStructures, 'created');
  pushStructures(deltas.removedStructures, 'removed');

  // Stable, content-derived order (id) so ranking/render never depends on insertion.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
