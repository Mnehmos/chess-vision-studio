/**
 * AnalysisFrameV2 PR-10 — position-hazard + move-delta EVIDENCE views (pure
 * transforms). These reshape the Rust facts the protocol ALREADY supplies
 * (PositionFacts.hazards, MoveStateFacts.deltas) into presentation-ready,
 * sectioned views. They make NO causal claim and assign NO move grade — they only
 * group, sort, and TAG status.
 *
 * Status discipline (mirrors facts-adapters.ts): a FactCollection that Rust marks
 * `uncomputed` (e.g. `motifs_not_requested`) or `unavailable` (e.g.
 * `hazards_unavailable_for_delta`) must surface its tagged status and reason — it
 * is NEVER an empty array presented as "none". A `computed` collection with zero
 * items is a real, verified "nothing here" — distinct from not-computed.
 *
 * Hazard `kind` and structure `kind` are arbitrary engine strings; we do NOT
 * hard-code an exhaustive enum (the Rust registry owns truth). We order the kinds
 * we know by a stable severity rank and fall back to alphabetical for the rest, so
 * rendering is deterministic regardless of input order.
 */
import type {
  FactCollection,
  HazardFact,
  MoveStateFacts,
  PositionFacts,
  Side,
  StructureDelta,
} from './teaching/types';

/** Tagged status for a hazard/structure section, parallel to FactCollection. */
export type HazardViewStatus = 'computed' | 'uncomputed' | 'unavailable';

/** One side+kind grouping of hazards, e.g. White `fork_threat`. */
export interface HazardGroup {
  side: Side;
  kind: string;
  /** Hazards in this group, stably sorted by id. */
  hazards: HazardFact[];
  /** Distinct squares touched by the group's hazards, stably sorted. */
  squares: string[];
  /** Max magnitude across the group, when any hazard carries one (centipawns). */
  magnitudeCp?: number;
  /** Move UCIs referenced by the group's hazards, deduped + sorted. */
  moveUcis: string[];
}

/**
 * Position-hazard evidence view. When `status === 'computed'`, `groups` is the
 * (possibly empty) set of side+kind groupings. When not computed, `groups` is
 * empty and `reason` carries the Rust tag — the consumer must NOT render "none".
 */
export type PositionHazardsView =
  | {
      status: 'computed';
      /** Whether any hazard at all was found (computed && groups.length > 0). */
      hasHazards: boolean;
      groups: HazardGroup[];
      provenance: string[];
    }
  | { status: 'uncomputed'; reason: string; provenance: string[] }
  | { status: 'unavailable'; reason: string; provenance: string[] };

/** A delta section (created / removed / worsened) of hazard groups. */
export type HazardDeltaSection =
  | { status: 'computed'; groups: HazardGroup[] }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };

/** A structure-delta section (created / removed) of StructureDelta groupings. */
export interface StructureDeltaGroup {
  side: Side;
  kind: string;
  /** Structures in this group, stably sorted by factId. */
  structures: StructureDelta[];
  /** Distinct squares touched, stably sorted. */
  squares: string[];
}

export type StructureDeltaSection =
  | { status: 'computed'; groups: StructureDeltaGroup[] }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };

/**
 * Move-delta evidence view. Each section preserves its own
 * computed/uncomputed/unavailable status from the underlying FactCollection — a
 * move whose hazard deltas are `unavailable` must still show that, not silence.
 */
export interface HazardDeltaView {
  moveUci: string;
  createdHazards: HazardDeltaSection;
  removedHazards: HazardDeltaSection;
  worsenedHazards: HazardDeltaSection;
  createdStructures: StructureDeltaSection;
  removedStructures: StructureDeltaSection;
  provenance: string[];
}

const HAZARD_PROVENANCE = ['hazard_deltas'] as const;
const STRUCTURE_PROVENANCE = ['pawn_structure'] as const;

// Known hazard kinds ordered by display severity. Unknown kinds sort after these
// alphabetically. This is presentation ordering ONLY — not a claim of truth.
const HAZARD_KIND_RANK: Record<string, number> = {
  mate_threat: 0,
  losing_material: 1,
  fork_threat: 2,
  pin_constraint: 3,
  pin: 3,
  king_pressure: 4,
};

// Known structure-delta kinds ordered for stable display.
const STRUCTURE_KIND_RANK: Record<string, number> = {
  doubled_pawns: 0,
  isolated_pawn: 1,
  backward_pawn: 2,
  passed_pawn: 3,
  connected_passed: 4,
};

function kindRank(rank: Record<string, number>, kind: string): number {
  const r = rank[kind];
  return r === undefined ? Number.POSITIVE_INFINITY : r;
}

// Side then kind-rank then kind-string then id/factId — fully deterministic.
function compareSideKind(
  rank: Record<string, number>,
  a: { side: Side; kind: string },
  b: { side: Side; kind: string },
): number {
  if (a.side !== b.side) return a.side === 'white' ? -1 : 1;
  const ra = kindRank(rank, a.kind);
  const rb = kindRank(rank, b.kind);
  if (ra !== rb) return ra - rb;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function groupHazards(items: HazardFact[]): HazardGroup[] {
  const buckets = new Map<string, HazardFact[]>();
  for (const hazard of items) {
    const key = `${hazard.side}\u0000${hazard.kind}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(hazard);
    else buckets.set(key, [hazard]);
  }
  const groups: HazardGroup[] = [];
  for (const bucket of buckets.values()) {
    const hazards = [...bucket].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const magnitudes = hazards
      .map((h) => h.magnitudeCp)
      .filter((m): m is number => typeof m === 'number');
    const moveUcis = sortedUnique(
      hazards.map((h) => h.moveUci).filter((u): u is string => typeof u === 'string'),
    );
    groups.push({
      side: hazards[0].side,
      kind: hazards[0].kind,
      hazards,
      squares: sortedUnique(hazards.flatMap((h) => h.squares)),
      magnitudeCp: magnitudes.length > 0 ? Math.max(...magnitudes) : undefined,
      moveUcis,
    });
  }
  return groups.sort((a, b) => compareSideKind(HAZARD_KIND_RANK, a, b));
}

function groupStructures(items: StructureDelta[]): StructureDeltaGroup[] {
  const buckets = new Map<string, StructureDelta[]>();
  for (const structure of items) {
    const key = `${structure.side}\u0000${structure.kind}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(structure);
    else buckets.set(key, [structure]);
  }
  const groups: StructureDeltaGroup[] = [];
  for (const bucket of buckets.values()) {
    const structures = [...bucket].sort((a, b) =>
      a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0,
    );
    groups.push({
      side: structures[0].side,
      kind: structures[0].kind,
      structures,
      squares: sortedUnique(structures.flatMap((s) => s.squares)),
    });
  }
  return groups.sort((a, b) => compareSideKind(STRUCTURE_KIND_RANK, a, b));
}

function hazardSection(collection: FactCollection<HazardFact>): HazardDeltaSection {
  if (collection.status === 'computed') {
    return { status: 'computed', groups: groupHazards(collection.items) };
  }
  return { status: collection.status, reason: collection.reason };
}

function structureSection(
  collection: FactCollection<StructureDelta>,
): StructureDeltaSection {
  if (collection.status === 'computed') {
    return { status: 'computed', groups: groupStructures(collection.items) };
  }
  return { status: collection.status, reason: collection.reason };
}

/**
 * Group a position's hazards by side + kind, preserving the collection's tagged
 * status. EVIDENCE ONLY — no grade, no cause. A `computed` empty result reports
 * `hasHazards: false` (a verified clean position); an `uncomputed`/`unavailable`
 * result carries the reason so the consumer can suppress the panel instead of
 * claiming "no hazards".
 */
export function positionHazardsView(position: PositionFacts): PositionHazardsView {
  const collection = position.hazards;
  if (collection.status === 'computed') {
    const groups = groupHazards(collection.items);
    return {
      status: 'computed',
      hasHazards: groups.length > 0,
      groups,
      provenance: [...HAZARD_PROVENANCE],
    };
  }
  return {
    status: collection.status,
    reason: collection.reason,
    provenance: [...HAZARD_PROVENANCE],
  };
}

/**
 * Sectioned created/removed/worsened hazard deltas + created/removed structure
 * deltas for a played move. Each section keeps its own status; provenance combines
 * the hazard + pawn-structure validators. EVIDENCE ONLY — this is "what changed",
 * not "this was good/bad".
 */
export function hazardDeltaView(move: MoveStateFacts): HazardDeltaView {
  const d = move.deltas;
  return {
    moveUci: move.move.uci,
    createdHazards: hazardSection(d.createdHazards),
    removedHazards: hazardSection(d.removedHazards),
    worsenedHazards: hazardSection(d.worsenedHazards),
    createdStructures: structureSection(d.createdStructures),
    removedStructures: structureSection(d.removedStructures),
    provenance: [...HAZARD_PROVENANCE, ...STRUCTURE_PROVENANCE],
  };
}

/** True when a hazard section has a status worth surfacing in non-dev UI. */
export function hazardSectionHasEvidence(section: HazardDeltaSection): boolean {
  if (section.status === 'computed') return section.groups.length > 0;
  return true; // uncomputed / unavailable still carry a reason to show
}

/** True when a structure section has a status worth surfacing in non-dev UI. */
export function structureSectionHasEvidence(section: StructureDeltaSection): boolean {
  if (section.status === 'computed') return section.groups.length > 0;
  return true;
}
