/**
 * ClaimProvenance — structured, multi-source provenance for an analysis claim
 * (AnalysisFrameV2 PR-13). A claim about a position can rest on more than one
 * kind of evidence at once: deterministic Rust facts (with the specific
 * validators that fired), an engine search (Stockfish or CVS), and/or an
 * application-side attribution rule. The hard rule this module enforces by its
 * SHAPE: provenance must NEVER collapse to a single opaque string. Each source
 * keeps its own typed entry, its validator ids, and its versions, so a fork that
 * is both proven by the Rust `fork_validation` validator AND endorsed by a
 * Stockfish line carries BOTH, distinctly.
 *
 * This file is additive and pure (no I/O, no engine calls). It reuses the
 * vocabulary that already exists:
 *   - `LensView.source` ('rust' | 'typescript')         — engine/facts-adapters.ts
 *   - `FactsProvenance` (engine, engineCommit, validators) — engine/teaching/types.ts
 *   - `EngineSource` ('stockfish' | 'cvs')               — engine/analysis-frame/identity.ts
 */

import type { EngineSource } from './analysis-frame/identity';
import type { FactsProvenance } from './teaching/types';
import type { LensView } from './facts-adapters';

/**
 * One deterministic-facts evidence entry. `source` matches the existing
 * `LensView.source` union so a view's origin maps straight in. `validatorIds`
 * are the registry validator names that produced the fact (e.g.
 * `'fork_validation'`, `'pin_validation'`) — the same strings carried by
 * `LensView.provenance` and `FactsProvenance.validators`. Never empty in
 * practice: a facts entry exists because at least one validator fired.
 */
export interface FactsProvenanceEntry {
  source: LensView<unknown>['source']; // 'rust' | 'typescript'
  validatorIds: string[];
  /** Mirrors FactsProvenance.factsRegistryVersion when known. */
  registryVersion?: number;
  /** Mirrors FactsProvenance.engineCommit when known. */
  engineCommit?: string;
}

/**
 * One search-evidence entry. `engine` reuses `EngineSource` from the analysis
 * identity so a claim's search backing names the SAME engines the frame can be
 * computed for. `depth` is the search depth that produced the backing, when
 * known (a depth-0 endorsement is meaningfully different from none, so this is
 * optional rather than defaulted).
 */
export interface SearchProvenanceEntry {
  engine: EngineSource; // 'stockfish' | 'cvs'
  depth?: number;
}

/**
 * The application-side attribution that joined the facts/search evidence into a
 * named claim. This is the ONLY app-authored layer — it asserts no new chess
 * truth, only which rule (by id + version) drew the conclusion. Singular by
 * design: a claim is attributed by exactly one rule revision.
 */
export interface AttributionProvenance {
  source: 'application';
  ruleId: string;
  version: number;
}

/**
 * The full provenance of one claim. `facts` and `search` are arrays precisely so
 * multi-source evidence never collapses: a claim proven by Rust AND a Stockfish
 * line keeps a `facts` entry and a `search` entry side by side. Both are
 * optional/absent when that kind of evidence does not exist (an evidence-gated
 * shape — an empty array would falsely imply "searched, found nothing"; absence
 * means "not searched").
 */
export interface ClaimProvenance {
  facts: FactsProvenanceEntry[];
  search?: SearchProvenanceEntry[];
  attribution?: AttributionProvenance;
}

/**
 * Pure builder for a Rust deterministic-facts provenance object. The common case
 * for PR-13: a claim backed by one or more Rust validators (e.g. the
 * `fork_validation` / `pin_validation` ids carried on a `LensView.provenance`).
 * Validator ids are copied and de-duplicated (order-preserving) so callers can
 * pass a view's `provenance` array directly without sharing mutable state.
 */
export function rustFactsProvenance(
  validatorIds: readonly string[],
  registryVersion?: number,
): ClaimProvenance {
  const seen = new Set<string>();
  const validators: string[] = [];
  for (const id of validatorIds) {
    if (!seen.has(id)) {
      seen.add(id);
      validators.push(id);
    }
  }
  const entry: FactsProvenanceEntry = { source: 'rust', validatorIds: validators };
  if (registryVersion !== undefined) entry.registryVersion = registryVersion;
  return { facts: [entry] };
}

/**
 * Pure builder that lifts the engine's own `FactsProvenance` block (as shipped on
 * a `TeachingFactBundleV1`) into a single Rust `ClaimProvenance`. Carries the
 * registry version and engine commit through unchanged so downstream consumers
 * can audit exactly which bundle the claim came from.
 */
export function bundleFactsProvenance(provenance: FactsProvenance): ClaimProvenance {
  const claim = rustFactsProvenance(provenance.validators, provenance.factsRegistryVersion);
  if (provenance.engineCommit !== undefined) {
    claim.facts[0].engineCommit = provenance.engineCommit;
  }
  return claim;
}

/**
 * Pure builder for a search-evidence provenance object (no facts, just the line).
 */
export function searchProvenance(engine: EngineSource, depth?: number): ClaimProvenance {
  const entry: SearchProvenanceEntry = { engine };
  if (depth !== undefined) entry.depth = depth;
  return { facts: [], search: [entry] };
}

/**
 * Pure builder for an application-attribution provenance object.
 */
export function attributionProvenance(ruleId: string, version: number): ClaimProvenance {
  return { facts: [], attribution: { source: 'application', ruleId, version } };
}

/**
 * Merge any number of `ClaimProvenance` objects into one WITHOUT collapsing the
 * sources. `facts` entries are unioned by (source + registryVersion +
 * engineCommit), merging their validatorIds (de-duplicated, order-preserving);
 * `search` entries are unioned by (engine + depth); `attribution` takes the LAST
 * non-undefined value (a later, more specific rule wins). The result is a fresh
 * object — inputs are never mutated. With zero arguments, returns an empty
 * `{ facts: [] }`.
 */
export function mergeProvenance(...parts: ClaimProvenance[]): ClaimProvenance {
  const factsByKey = new Map<string, FactsProvenanceEntry>();
  const factsOrder: string[] = [];
  const searchByKey = new Map<string, SearchProvenanceEntry>();
  const searchOrder: string[] = [];
  let attribution: AttributionProvenance | undefined;
  let sawSearch = false;

  for (const part of parts) {
    for (const f of part.facts) {
      const key = `${f.source}\u0000${f.registryVersion ?? ''}\u0000${f.engineCommit ?? ''}`;
      let merged = factsByKey.get(key);
      if (!merged) {
        merged = {
          source: f.source,
          validatorIds: [],
          ...(f.registryVersion !== undefined ? { registryVersion: f.registryVersion } : {}),
          ...(f.engineCommit !== undefined ? { engineCommit: f.engineCommit } : {}),
        };
        factsByKey.set(key, merged);
        factsOrder.push(key);
      }
      const seen = new Set(merged.validatorIds);
      for (const id of f.validatorIds) {
        if (!seen.has(id)) {
          seen.add(id);
          merged.validatorIds.push(id);
        }
      }
    }

    if (part.search) {
      sawSearch = true;
      for (const s of part.search) {
        const key = `${s.engine}\u0000${s.depth ?? ''}`;
        if (!searchByKey.has(key)) {
          const entry: SearchProvenanceEntry = { engine: s.engine };
          if (s.depth !== undefined) entry.depth = s.depth;
          searchByKey.set(key, entry);
          searchOrder.push(key);
        }
      }
    }

    if (part.attribution) attribution = { ...part.attribution };
  }

  const result: ClaimProvenance = {
    facts: factsOrder.map((k) => {
      const e = factsByKey.get(k)!;
      return { ...e, validatorIds: [...e.validatorIds] };
    }),
  };
  if (sawSearch) result.search = searchOrder.map((k) => ({ ...searchByKey.get(k)! }));
  if (attribution) result.attribution = attribution;
  return result;
}

/**
 * The distinct evidence-source labels backing a claim — a small audit helper the
 * UI/tests use to assert that provenance has NOT collapsed to one source. Returns
 * one label per facts source ('rust'/'typescript'), one 'search' label if any
 * search backing exists, and 'application' if an attribution rule is present.
 */
export function provenanceSources(provenance: ClaimProvenance): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const f of provenance.facts) {
    if (!seen.has(f.source)) {
      seen.add(f.source);
      labels.push(f.source);
    }
  }
  if (provenance.search && provenance.search.length > 0 && !seen.has('search')) {
    seen.add('search');
    labels.push('search');
  }
  if (provenance.attribution && !seen.has('application')) {
    labels.push('application');
  }
  return labels;
}
