import { TEACHING_FACTS_REGISTRY_VERSION } from '../types';
import type { TeachingFactBundleV1 } from '../types';

/**
 * The mirrored fixtures under `fixtures/teaching-facts/v1` were captured at facts
 * registry **v6**; the engine now emits **v23** (see TEACHING_FACTS_PROTOCOL.md and
 * src/facts/mod.rs in the Rust repo). Their *content* is still what these tests
 * exercise, but anything that goes through freshness/provenance gates must look like a
 * bundle the engine would emit today — a v6-stamped record is legitimately stale, which
 * is what `isRecordFresh` and the promotion audit now (correctly) report.
 *
 * So: keep the fixture facts, stamp the CURRENT registry version. Regenerating the
 * mirrored fixtures from the engine is a separate, tracked follow-up.
 */
export function asCurrentFacts(bundle: TeachingFactBundleV1): TeachingFactBundleV1 {
  return {
    ...bundle,
    provenance: { ...bundle.provenance, factsRegistryVersion: TEACHING_FACTS_REGISTRY_VERSION },
  };
}
