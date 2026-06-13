import type { MoveAnalysis } from '../types';
import { compileTeachingEvents } from './compile';
import { buildTeachingPuzzle, type TeachingPuzzle } from './puzzle';
import {
  TEACHING_EVENTS_SCHEMA_VERSION,
  type ExplanationPlan,
  type TeachingEvent,
  type TeachingFactBundleV1,
  type TeachingTopicId,
} from './types';

// Bump when the compiler's topic logic changes in a way that invalidates cached
// records (new/changed detectors, attribution rules, rendering).
export const TEACHING_COMPILER_VERSION = 1;

// One reproducible, auditable training row for the CVS Teaching Corpus: the
// Stockfish judgment + the Rust deterministic facts + the committed teaching +
// the generated puzzle + full provenance. Self-contained — everything an external
// trainer (or the future CVS-LM) needs from a single analyzed ply.
export interface TeachingRecordV1 {
  schemaVersion: typeof TEACHING_EVENTS_SCHEMA_VERSION;
  gameKey: string;
  ply: number;
  positionBefore: string;
  positionAfter: string;
  san: string;
  // Stockfish judgment
  classification: string;
  cpLoss: number;
  bestLine: string[]; // SAN, evalBefore.pv
  refutationLine: string[]; // SAN, evalAfter.pv
  // Rust deterministic facts (the full bundle)
  facts: TeachingFactBundleV1;
  // Committed teaching
  events: TeachingEvent[];
  primaryTopicId: TeachingTopicId | null;
  primaryPlan: ExplanationPlan | null;
  puzzle: TeachingPuzzle | null;
  // Learner outcome — populated once practice tracking exists.
  outcome: { solved: boolean; attempts: number } | null;
  provenance: {
    teachingSchemaVersion: number;
    factsRegistryVersion: number;
    compilerVersion: number;
    engine: string;
    engineCommit: string | null;
    sfDepth: number | null;
  };
}

export interface TeachingRecordInput {
  gameKey: string;
  ply: number;
  san: string;
  analysis: MoveAnalysis;
  facts: TeachingFactBundleV1;
}

// The version tuple that makes a cached record valid: teaching schema, facts
// registry, compiler, and the Stockfish label depth it was computed at. Persist it
// with the record so a validator/registry/depth change invalidates stale topics.
export function recordSignature(provenance: TeachingRecordV1['provenance']): string {
  return `t${provenance.teachingSchemaVersion}.r${provenance.factsRegistryVersion}.c${provenance.compilerVersion}.d${provenance.sfDepth ?? 'x'}`;
}

// Is a cached record still produced by the current app-side topic logic? Bump
// TEACHING_COMPILER_VERSION (or the schema) whenever detectors/attribution change
// and every stale record is recomputed rather than reused.
export function isRecordFresh(record: TeachingRecordV1): boolean {
  return (
    record.provenance.teachingSchemaVersion === TEACHING_EVENTS_SCHEMA_VERSION &&
    record.provenance.compilerVersion === TEACHING_COMPILER_VERSION
  );
}

// Build the full training row from one analyzed ply + its Rust fact bundle. Pure:
// the bridge fetch is the caller's job; this only compiles, generates, and packs.
export function buildTeachingRecord(input: TeachingRecordInput): TeachingRecordV1 {
  const { analysis, facts } = input;
  const compiled = compileTeachingEvents({ analysis, facts });
  const events = compiled.computed ? compiled.events : [];
  const primary = compiled.computed ? compiled.primaryEvent : undefined;
  return {
    schemaVersion: TEACHING_EVENTS_SCHEMA_VERSION,
    gameKey: input.gameKey,
    ply: input.ply,
    positionBefore: facts.fenBefore,
    positionAfter: facts.played.fenAfter,
    san: input.san,
    classification: analysis.classification,
    cpLoss: analysis.cpLoss,
    bestLine: analysis.evalBefore?.pv ?? [],
    refutationLine: analysis.evalAfter?.pv ?? [],
    facts,
    events,
    primaryTopicId: primary?.topicId ?? null,
    primaryPlan: primary?.plan ?? null,
    puzzle: primary ? buildTeachingPuzzle(primary, facts) : null,
    outcome: null,
    provenance: {
      teachingSchemaVersion: TEACHING_EVENTS_SCHEMA_VERSION,
      factsRegistryVersion: facts.provenance.factsRegistryVersion,
      compilerVersion: TEACHING_COMPILER_VERSION,
      engine: facts.provenance.engine,
      engineCommit: facts.provenance.engineCommit ?? null,
      sfDepth: analysis.evalBefore?.depth ?? null,
    },
  };
}
