import {
  TEACHING_EVENTS_SCHEMA_VERSION,
  TEACHING_FACTS_REGISTRY_VERSION,
  type FactRef,
  type PieceRef,
  type Side,
  type StructureDelta,
  type TeachingAction,
  type TeachingConsequence,
  type TeachingEvent,
  type TeachingFactBundleV1,
  type TeachingMechanism,
  type TeachingTopicId,
  type ProofAttribution,
  type ProofBadge,
} from './types';
import {
  TEACHING_NODE_SCHEMA_VERSION,
  type TeachingNode,
} from './node';
import { TEACHING_COMPILER_VERSION } from './record';
import { stableEventId, structureDeltaToFactRef } from './evidence';
import { topicMeta } from './registry';

// ────────────────────────────────────────────────────────────────────────────
// AnalysisFrameV2 — Canonical Teaching Schema (PR-08 Stage A)
//
// The canonical claims of a reviewed ply are the COMMITTED TeachingNode[] produced
// by node.ts (buildTeachingNodes → commitTeachingNodes). This module wraps those
// nodes as a versioned, provenance-stamped envelope (CanonicalTeachingV2), selects
// a single deterministic primary node, and offers a PURE compatibility projection
// from a TeachingNode back to the legacy TeachingEvent shape (compile.ts output)
// for the five established topics.
//
// Boundary discipline: this module adds NO new chess truth. It only re-packages,
// ranks, and translates claims that the node pipeline has already committed.
// ────────────────────────────────────────────────────────────────────────────

export const CANONICAL_TEACHING_SCHEMA_VERSION = 2 as const;

// The (conceptCode, claimStatus) pair of a committed node maps onto exactly one of
// the five legacy topics. Node conceptCodes are: `<piece>_multi_attack`, `pin`,
// `failed_defense`, `missed_hanging_piece`, `pawn_structure_damage`.
export type CanonicalTopicId = TeachingTopicId;

export interface CanonicalProvenance {
  // Mirror of node provenance versions plus the compiler/registry versions so a
  // consumer can decide whether a cached canonical envelope is still valid.
  nodeSchemaVersion: number;
  compilerVersion: number;
  factsRegistryVersion: number;
  // The deterministic pipeline version the nodes were built under, if uniform.
  pipelineVersion: string | null;
}

export interface CanonicalTeachingV2 {
  schemaVersion: typeof CANONICAL_TEACHING_SCHEMA_VERSION;
  // The committed canonical claims, exactly as node.ts produced them. Order is the
  // node array's own deterministic order (proposeTeachingHypotheses sorts by id).
  nodes: TeachingNode[];
  // A stable reference (node id) to the selected primary, or null when no node
  // qualifies. Holding the id (not the object) keeps the envelope serialization
  // cycle-free and lets a consumer re-resolve against `nodes`.
  primaryNodeId: string | null;
  provenance: CanonicalProvenance;
}

// Build the canonical envelope from committed nodes. PURE: callers run
// buildTeachingNodes / commitTeachingNodes first; this only wraps + ranks.
export function buildCanonicalTeaching(
  nodes: TeachingNode[],
  provenance?: Partial<CanonicalProvenance>,
): CanonicalTeachingV2 {
  const primary = selectPrimaryTeachingNode(nodes);
  const pipelineVersions = new Set(nodes.map((n) => n.provenance.pipelineVersion));
  const uniformPipeline = pipelineVersions.size === 1 ? [...pipelineVersions][0] ?? null : null;

  return {
    schemaVersion: CANONICAL_TEACHING_SCHEMA_VERSION,
    nodes,
    primaryNodeId: primary ? primary.id : null,
    provenance: {
      nodeSchemaVersion: provenance?.nodeSchemaVersion ?? TEACHING_NODE_SCHEMA_VERSION,
      compilerVersion: provenance?.compilerVersion ?? TEACHING_COMPILER_VERSION,
      factsRegistryVersion: provenance?.factsRegistryVersion ?? TEACHING_FACTS_REGISTRY_VERSION,
      pipelineVersion: provenance?.pipelineVersion ?? uniformPipeline,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Primary selection — DETERMINISTIC, documented, NOT render-order dependent.
//
// A committed node's claimStatus is one of 'confirmed' | 'refuted' | 'unverified'
// | 'unavailable' (node.ts TeachingClaimStatus). Selection ranks nodes by an
// ordered tuple of pure, content-derived keys — every tie is broken by the stable
// node id, so the result is invariant under input array reordering:
//
//   1. claimStatus rank   — confirmed(0) < unverified(1) < refuted(2) < unavailable(3)
//                           (lower is more salient: a proven claim teaches most).
//   2. kind rank          — tactical kinds outrank structural/positional ones, so a
//                           proven fork is chosen over a descriptive pawn weakness.
//   3. confidence         — higher node.confidence first.
//   4. node id            — lexicographic, the final stable tie-break.
//
// Nodes that are 'unavailable' are still eligible (they are committed claims) but
// sort last; selectPrimaryTeachingNode returns null only for an EMPTY input.
// ────────────────────────────────────────────────────────────────────────────

const CLAIM_STATUS_RANK: Record<TeachingNode['claimStatus'], number> = {
  confirmed: 0,
  unverified: 1,
  refuted: 2,
  unavailable: 3,
};

const KIND_RANK: Record<TeachingNode['kind'], number> = {
  tactic: 0,
  defense: 1,
  'king-safety': 2,
  conversion: 3,
  mobility: 4,
  structural: 5,
  development: 6,
  counterfactual: 7,
};

function claimStatusRank(node: TeachingNode): number {
  return CLAIM_STATUS_RANK[node.claimStatus] ?? Number.MAX_SAFE_INTEGER;
}

function kindRank(node: TeachingNode): number {
  return KIND_RANK[node.kind] ?? Number.MAX_SAFE_INTEGER;
}

export function selectPrimaryTeachingNode(nodes: TeachingNode[]): TeachingNode | null {
  if (nodes.length === 0) return null;
  // Copy so we never mutate the caller's array order (render-order independence).
  const ranked = [...nodes].sort(comparePrimary);
  return ranked[0] ?? null;
}

// Exposed for tests / debugging: the total order used for primary selection.
export function comparePrimary(a: TeachingNode, b: TeachingNode): number {
  return (
    claimStatusRank(a) - claimStatusRank(b) ||
    kindRank(a) - kindRank(b) ||
    b.confidence - a.confidence ||
    a.id.localeCompare(b.id)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy projection — TeachingNode → TeachingEvent (compile.ts shape).
//
// PURE and total over the five established topics. Translates a committed node's
// conceptCode into the legacy TeachingTopicId and fills the TeachingEvent fields
// the node already carries, drawing piece/square detail from `facts` when present.
// Returns null for any node whose conceptCode is not one of the five known topics.
//
// This is a COMPATIBILITY shim: it does not re-derive chess truth. Fields the node
// pipeline does not track (e.g. fine-grained cpLoss, saliency weighting) are filled
// with deterministic, documented defaults so the projected event is well-formed.
// ────────────────────────────────────────────────────────────────────────────

// Map a node claimStatus to the legacy proof attribution/badge. A confirmed tactic
// projects as an engine-proven line; a structural (always-confirmed) node projects
// as a structural fact; everything else is descriptive_only so we never overstate.
function attributionForNode(node: TeachingNode): {
  attribution: ProofAttribution;
  badge: ProofBadge;
} {
  if (node.kind === 'structural') {
    return { attribution: 'descriptive_only', badge: 'structural_fact' };
  }
  if (node.claimStatus === 'confirmed') {
    return { attribution: 'proven_refutation', badge: 'engine_line' };
  }
  if (node.claimStatus === 'refuted' || node.claimStatus === 'unavailable') {
    return { attribution: 'descriptive_only', badge: 'descriptive_only' };
  }
  // unverified
  return { attribution: 'counterfactual_supported', badge: 'counterfactual_supported' };
}

// Resolve the legacy (topicId, action, mechanism) triple from a node's conceptCode.
// Returns null for an unknown conceptCode (the five-topic guard).
function legacyTopicFromConcept(
  node: TeachingNode,
): { topicId: TeachingTopicId; action: TeachingAction; mechanism: TeachingMechanism } | null {
  const concept = node.conceptCode;
  if (concept.endsWith('_multi_attack')) {
    return { topicId: 'allowed_fork', action: 'allowed', mechanism: 'fork' };
  }
  if (concept === 'pin') {
    return { topicId: 'allowed_pin', action: 'allowed', mechanism: 'pin' };
  }
  if (concept === 'missed_hanging_piece') {
    return { topicId: 'missed_hanging_piece', action: 'missed', mechanism: 'hanging_piece' };
  }
  if (concept === 'failed_defense') {
    return { topicId: 'failed_defense', action: 'failed_to_answer', mechanism: 'defense' };
  }
  if (concept === 'pawn_structure_damage') {
    // 'created' is the most conservative pawn-damage action (no counterfactual claim).
    return { topicId: 'pawn_structure_damage', action: 'created', mechanism: 'doubled_pawn' };
  }
  return null;
}

// Resolve the mover side from facts, defaulting to 'white' when facts are absent.
// (Projection is still well-formed without facts; the side just may be a default.)
function moverSide(facts?: TeachingFactBundleV1): Side {
  return facts?.before.sideToMove ?? 'white';
}

function computedItems<T>(
  collection: { status: 'computed'; items: T[] } | { status: string } | null | undefined,
): T[] | null {
  return collection && collection.status === 'computed'
    ? (collection as { status: 'computed'; items: T[] }).items
    : null;
}

// Build the pawn-structure mechanism + structural-change evidence from facts.
function projectPawnStructure(
  _node: TeachingNode,
  facts: TeachingFactBundleV1 | undefined,
  mover: Side,
): { mechanism: TeachingMechanism; structuralChanges: StructureDelta[]; evidence: FactRef[] } {
  const created = facts ? computedItems(facts.played.deltas.createdStructures) : null;
  const damage =
    created?.filter(
      (d) => d.side === mover && (d.kind === 'doubled_pawns' || d.kind === 'isolated_pawn'),
    ) ?? [];
  const mechanism: TeachingMechanism = damage.some((d) => d.kind === 'doubled_pawns')
    ? 'doubled_pawn'
    : 'isolated_pawn';
  return {
    mechanism,
    structuralChanges: damage,
    evidence: damage.map(structureDeltaToFactRef),
  };
}

export function projectTeachingNodeToLegacyEvent(
  node: TeachingNode,
  facts?: TeachingFactBundleV1,
): TeachingEvent | null {
  const resolved = legacyTopicFromConcept(node);
  if (!resolved) return null;

  const mover = moverSide(facts);
  const opponent: Side = mover === 'white' ? 'black' : 'white';
  const { topicId, action } = resolved;
  let { mechanism } = resolved;

  const playedMove = node.subjectMove;
  const punishMove = node.verification.expectedMove;
  const squares = [...node.involvedSquares].sort();

  let actors: PieceRef[] = [];
  let targets: PieceRef[] = [];
  let evidence: FactRef[] = [];
  let structuralChanges: StructureDelta[] | undefined;

  // Topic-specific evidence drawn from the committed node + facts.
  if (topicId === 'allowed_fork') {
    const motifs = facts ? computedItems(facts.played.position.availableMotifs) : null;
    const motif = motifs?.find((m) => m.moveUci === punishMove) ?? motifs?.[0];
    if (motif) {
      actors = [motif.forkingPiece];
      targets = motif.targets;
    }
    evidence = [{ factId: `fork-${punishMove ?? playedMove}`, kind: 'fork', squares, side: opponent }];
  } else if (topicId === 'allowed_pin') {
    const pins = facts ? computedItems(facts.played.position.availablePins) : null;
    const pin = pins?.find((p) => p.moveUci === punishMove) ?? pins?.[0];
    if (pin) {
      actors = [pin.pinner];
      targets = [pin.pinned, pin.anchor];
    }
    evidence = [{ factId: `pin-${punishMove ?? playedMove}`, kind: 'pin', squares, side: opponent }];
  } else if (topicId === 'missed_hanging_piece') {
    const target = facts?.before.pieces.find(
      (p) =>
        p.side !== mover &&
        p.see.status === 'computed' &&
        p.see.value.bestCaptureUci === punishMove,
    );
    if (target) targets = [{ id: target.id, side: target.side, pieceType: target.pieceType, square: target.square }];
    const targetId = targets[0]?.id ?? squares[0] ?? playedMove;
    evidence = [{ factId: `hanging-${targetId}`, kind: 'hanging_piece', squares, side: opponent }];
  } else if (topicId === 'failed_defense') {
    const hazards = facts ? computedItems(facts.before.hazards) : null;
    const hazard = hazards?.find((h) => h.moveUci === punishMove) ?? hazards?.[0];
    if (hazard) {
      mechanism =
        hazard.kind === 'losing_material'
          ? 'hanging_piece'
          : hazard.kind === 'king_pressure' || hazard.kind === 'mate_threat'
            ? 'king_attack'
            : 'defense';
    }
    evidence = [
      { factId: hazard?.id ?? `hazard-${playedMove}`, kind: hazard?.kind ?? 'defense', squares, side: mover },
    ];
  } else {
    // pawn_structure_damage
    const ps = projectPawnStructure(node, facts, mover);
    mechanism = ps.mechanism;
    structuralChanges = ps.structuralChanges;
    evidence = ps.evidence;
    if (evidence.length === 0) {
      evidence = [{ factId: `pawn-${playedMove}`, kind: 'pawn_structure', squares, side: mover }];
    }
  }

  const { attribution, badge } = attributionForNode(node);

  const consequence: TeachingConsequence = {
    // Nodes do not carry a cpLoss; legacy events require a numeric field. Use the
    // engine score the verifier recorded when available, else 0 (no claim).
    cpLoss: node.verification.scoreAfter ?? 0,
    ...(structuralChanges && structuralChanges.length ? { structuralChanges } : {}),
  };

  // Validators: prefer the node's recorded detectorIds; fall back to the topic's
  // canonical mechanism set so the projected event always has a non-empty list.
  const validators = node.provenance.detectorIds.length
    ? [...node.provenance.detectorIds]
    : [...topicMeta(topicId).mechanisms];

  const event: TeachingEvent = {
    id: stableEventId(topicId, playedMove, squares),
    topicId,
    family: topicMeta(topicId).family,
    action,
    mechanism,
    side: mover,
    playedMove,
    actors,
    targets,
    squares,
    consequence,
    ...(punishMove && topicId !== 'pawn_structure_damage' && topicId !== 'missed_hanging_piece'
      ? { punishment: { move: punishMove, line: [punishMove] } }
      : {}),
    ...(node.betterMove
      ? { correction: { move: node.betterMove, avoidedFacts: evidence, createdFacts: [] } }
      : {}),
    proof: {
      validators,
      evidence,
      attribution,
      badge,
    },
    // Nodes are not saliency-scored; a projected event keeps the node's confidence
    // as a deterministic proxy so downstream ranking has a stable, documented value.
    saliency: node.confidence,
    plan: {
      topic: topicMeta(topicId).displayName,
      headline: node.title,
      ...(node.summary ? { consequence: node.summary } : {}),
      ...(node.why ? { cause: node.why } : {}),
      ...(node.betterExplanation ? { correction: node.betterExplanation } : {}),
    },
  };

  return event;
}

// Re-export for convenience so a consumer can import the schema version + the wrap
// helper from one canonical entry point.
export { TEACHING_EVENTS_SCHEMA_VERSION };
