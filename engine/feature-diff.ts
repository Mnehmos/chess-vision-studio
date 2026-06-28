/**
 * Pure feature/eval diff between two CvsFeatureInspectionV1 snapshots (plan §6
 * PR-12). Active features are model INPUTS — a feature appearing/disappearing is
 * not a causal claim about the evaluation. The diff fails closed when the two
 * inspections come from different registries (their feature IDs are incomparable).
 */
import type { CvsFeatureInspectionV1 } from './analysis-frame/inspection';

export interface FeatureRef {
  id: number;
  name: string;
}

export type FeatureDiffStatus = 'computed' | 'registry_mismatch';

export interface FeatureDiff {
  status: FeatureDiffStatus;
  activated: FeatureRef[]; // present in `after`, absent in `before`
  deactivated: FeatureRef[]; // present in `before`, absent in `after`
  reason?: string;
}

/** id → name, de-duplicated (first name wins); tolerates id/name length mismatch. */
function featureMap(inspection: CvsFeatureInspectionV1): Map<number, string> {
  const map = new Map<number, string>();
  inspection.activeFeatureIds.forEach((id, i) => {
    if (!map.has(id)) map.set(id, inspection.activeFeatureNames[i] ?? `#${id}`);
  });
  return map;
}

function refsNotIn(source: Map<number, string>, other: Map<number, string>): FeatureRef[] {
  return [...source.entries()]
    .filter(([id]) => !other.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);
}

export function diffFeatureInspections(
  before: CvsFeatureInspectionV1,
  after: CvsFeatureInspectionV1,
): FeatureDiff {
  if (
    before.registryVersion !== after.registryVersion ||
    before.registryHash !== after.registryHash
  ) {
    return {
      status: 'registry_mismatch',
      activated: [],
      deactivated: [],
      reason: `registry differs (v${before.registryVersion}/${before.registryHash} vs v${after.registryVersion}/${after.registryHash})`,
    };
  }
  const beforeMap = featureMap(before);
  const afterMap = featureMap(after);
  return {
    status: 'computed',
    activated: refsNotIn(afterMap, beforeMap),
    deactivated: refsNotIn(beforeMap, afterMap),
  };
}

export type NnueEvalStatus = 'computed' | 'unavailable';

export interface NnueEvalComparison {
  status: NnueEvalStatus;
  beforeWhiteCp: number | null;
  afterWhiteCp: number | null;
  deltaWhiteCp: number | null; // after - before, White POV
  reason?: string;
}

/** White-normalized NNUE eval delta; unavailable when either side lacks an NNUE eval. */
export function nnueEvalComparison(
  before: CvsFeatureInspectionV1,
  after: CvsFeatureInspectionV1,
): NnueEvalComparison {
  if (before.nnueWhiteCp === null || after.nnueWhiteCp === null) {
    return {
      status: 'unavailable',
      beforeWhiteCp: before.nnueWhiteCp,
      afterWhiteCp: after.nnueWhiteCp,
      deltaWhiteCp: null,
      reason: 'NNUE evaluation not available (engine ran without --nnue)',
    };
  }
  return {
    status: 'computed',
    beforeWhiteCp: before.nnueWhiteCp,
    afterWhiteCp: after.nnueWhiteCp,
    deltaWhiteCp: after.nnueWhiteCp - before.nnueWhiteCp,
  };
}
