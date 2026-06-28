/**
 * AnalysisFrameV2 skeleton (plan §4.7, §6 PR-01). The canonical object that ties
 * every analysis-derived artifact to one exact AnalysisIdentityV2. This PR lands
 * the skeleton, the factory, deterministic serialization, and the identity guard;
 * the artifact PAYLOAD shapes are intentionally minimal here and are narrowed by
 * later PRs (PR-02 score, PR-03 review, PR-05/09 facts branches, PR-08 teaching,
 * PR-11 telemetry). Existing data is wrapped through adapters — state is NOT
 * migrated wholesale yet.
 */
import type { PositionFacts, TeachingFactBundleV1 } from '../teaching/types';
import { type ArtifactState, idle } from './artifact';
import {
  ANALYSIS_FRAME_BUILDER_VERSION,
  ANALYSIS_FRAME_SCHEMA_VERSION,
  type AnalysisIdentityV2,
  describeIdentityMismatch,
  sameAnalysisIdentity,
} from './identity';

// ── Payload placeholders — minimal now, expanded by later PRs ─────────────────

/** PR-02/PR-03/PR-11 expand this with NormalizedEngineScore, provenance, telemetry. */
export interface EngineSearchResultV2 {
  identity: AnalysisIdentityV2;
  bestMoveUci: string | null;
  pvUci: string[];
}

/** PR-03 expands this with classification, cp loss, lines, deep-check. */
export interface MoveReviewV2 {
  identity: AnalysisIdentityV2;
}

/** PR-05/PR-09 expand this with attributed Stockfish/CVS branches. */
export interface FactFrameV2 {
  rawV1: TeachingFactBundleV1;
  before: PositionFacts;
}

/** PR-08 expands this into the canonical committed teaching claim set. */
export interface CanonicalTeachingV2 {
  nodes: unknown[];
}

export interface FrameProvenance {
  createdAt: string;
  appVersion?: string;
  frameBuilderVersion: number;
  factsSchemaVersion?: number;
  factsRegistryVersion?: number;
  rustEngineCommit?: string;
  validators: string[];
  fallbacks: string[];
}

export interface AnalysisFrameV2 {
  schemaVersion: typeof ANALYSIS_FRAME_SCHEMA_VERSION;
  identity: AnalysisIdentityV2;

  stockfishReview: ArtifactState<MoveReviewV2>;
  stockfishRoot: ArtifactState<EngineSearchResultV2>;
  cvsRoot: ArtifactState<EngineSearchResultV2>;
  cvsForcedPlayed: ArtifactState<EngineSearchResultV2>;

  facts: ArtifactState<FactFrameV2>;
  teaching: ArtifactState<CanonicalTeachingV2>;

  provenance: FrameProvenance;
}

export interface BuildFrameOptions {
  createdAt: string;
  appVersion?: string;
  factsSchemaVersion?: number;
  factsRegistryVersion?: number;
  rustEngineCommit?: string;
  /** Initial state for each artifact slot; defaults to idle. */
  stockfishReview?: ArtifactState<MoveReviewV2>;
  stockfishRoot?: ArtifactState<EngineSearchResultV2>;
  cvsRoot?: ArtifactState<EngineSearchResultV2>;
  cvsForcedPlayed?: ArtifactState<EngineSearchResultV2>;
  facts?: ArtifactState<FactFrameV2>;
  teaching?: ArtifactState<CanonicalTeachingV2>;
  validators?: string[];
  fallbacks?: string[];
}

/**
 * Construct a frame for one identity. Every artifact slot defaults to `idle`;
 * callers pass pending/unavailable/computed states as they orchestrate. `createdAt`
 * is injected (not read from the clock) so the result is testable and stable.
 */
export function buildAnalysisFrameV2(
  identity: AnalysisIdentityV2,
  options: BuildFrameOptions,
): AnalysisFrameV2 {
  return {
    schemaVersion: ANALYSIS_FRAME_SCHEMA_VERSION,
    identity,
    stockfishReview: options.stockfishReview ?? idle(),
    stockfishRoot: options.stockfishRoot ?? idle(),
    cvsRoot: options.cvsRoot ?? idle(),
    cvsForcedPlayed: options.cvsForcedPlayed ?? idle(),
    facts: options.facts ?? idle(),
    teaching: options.teaching ?? idle(),
    provenance: {
      createdAt: options.createdAt,
      appVersion: options.appVersion,
      frameBuilderVersion: ANALYSIS_FRAME_BUILDER_VERSION,
      factsSchemaVersion: options.factsSchemaVersion,
      factsRegistryVersion: options.factsRegistryVersion,
      rustEngineCommit: options.rustEngineCommit,
      validators: options.validators ?? [],
      fallbacks: options.fallbacks ?? [],
    },
  };
}

/** True when an artifact computed for `artifactIdentity` may render under `frame`. */
export function artifactMatchesFrame(
  frame: AnalysisFrameV2,
  artifactIdentity: AnalysisIdentityV2,
): boolean {
  return sameAnalysisIdentity(frame.identity, artifactIdentity);
}

/**
 * Fail-closed guard: throws when an artifact's identity does not match the frame.
 * Use before adopting an async result into the frame so a late response (after
 * undo or a game switch) cannot populate the wrong position.
 */
export function assertArtifactMatchesFrame(
  frame: AnalysisFrameV2,
  artifactIdentity: AnalysisIdentityV2,
): void {
  const mismatch = describeIdentityMismatch(frame.identity, artifactIdentity);
  if (mismatch) throw new Error(mismatch);
}

// ── Deterministic serialization (plan §6 PR-01 work item 5) ───────────────────

/**
 * Stable JSON with recursively sorted object keys, for byte-identical output.
 * Keys whose value is `undefined` are omitted, matching JSON.stringify semantics
 * (so optional, unset fields never serialize and round-trip cleanly).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

export function serializeAnalysisFrame(frame: AnalysisFrameV2): string {
  return stableStringify(frame);
}

export function deserializeAnalysisFrame(serialized: string): AnalysisFrameV2 {
  return JSON.parse(serialized) as AnalysisFrameV2;
}
