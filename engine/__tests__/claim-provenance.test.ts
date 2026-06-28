import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PositionFacts, TeachingFactBundleV1 } from '../teaching/types';
import { TEACHING_FACTS_REGISTRY_VERSION } from '../teaching/types';
import { forkOpportunityView, pinOpportunityView } from '../facts-adapters';
import {
  attributionProvenance,
  bundleFactsProvenance,
  mergeProvenance,
  provenanceSources,
  rustFactsProvenance,
  searchProvenance,
  type ClaimProvenance,
} from '../claim-provenance';

function load(name: string): TeachingFactBundleV1 {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/teaching-facts/v1/${name}.json`, import.meta.url), 'utf8'),
  ) as TeachingFactBundleV1;
}

function branches(b: TeachingFactBundleV1): PositionFacts[] {
  const out = [b.before, b.played.position];
  if (b.best) out.push(b.best.position);
  if (b.refutation) out.push(b.refutation.position);
  return out;
}

describe('ClaimProvenance (PR-13)', () => {
  it('rustFactsProvenance carries the validator ids and registry version without collapsing', () => {
    const p = rustFactsProvenance(['fork_validation'], TEACHING_FACTS_REGISTRY_VERSION);
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0].source).toBe('rust');
    expect(p.facts[0].validatorIds).toEqual(['fork_validation']);
    expect(p.facts[0].registryVersion).toBe(TEACHING_FACTS_REGISTRY_VERSION);
    expect(p.search).toBeUndefined();
    expect(p.attribution).toBeUndefined();
  });

  it('rustFactsProvenance de-duplicates validator ids and copies the array', () => {
    const input = ['attack_map', 'fork_validation', 'attack_map'];
    const p = rustFactsProvenance(input);
    expect(p.facts[0].validatorIds).toEqual(['attack_map', 'fork_validation']);
    input.push('mutated');
    expect(p.facts[0].validatorIds).not.toContain('mutated');
    expect(p.facts[0].registryVersion).toBeUndefined();
  });

  it('multi-source provenance NEVER collapses to one string', () => {
    const merged = mergeProvenance(
      rustFactsProvenance(['fork_validation'], TEACHING_FACTS_REGISTRY_VERSION),
      searchProvenance('stockfish', 18),
      attributionProvenance('allowed_fork', 1),
    );
    // Distinct typed entries, each retained.
    expect(merged.facts).toHaveLength(1);
    expect(merged.facts[0].source).toBe('rust');
    expect(merged.facts[0].validatorIds).toContain('fork_validation');
    expect(merged.search).toEqual([{ engine: 'stockfish', depth: 18 }]);
    expect(merged.attribution).toEqual({ source: 'application', ruleId: 'allowed_fork', version: 1 });
    // The whole point: three independent sources, not one merged blob.
    expect(provenanceSources(merged)).toEqual(['rust', 'search', 'application']);
    expect(provenanceSources(merged).length).toBeGreaterThan(1);
  });

  it('mergeProvenance unions validator ids per (source, version) and keeps both engines', () => {
    const merged = mergeProvenance(
      rustFactsProvenance(['fork_validation'], TEACHING_FACTS_REGISTRY_VERSION),
      rustFactsProvenance(['pin_validation'], TEACHING_FACTS_REGISTRY_VERSION),
      searchProvenance('stockfish', 18),
      searchProvenance('cvs', 12),
    );
    expect(merged.facts).toHaveLength(1); // same source+version → one entry
    expect(merged.facts[0].validatorIds).toEqual(['fork_validation', 'pin_validation']);
    expect(merged.search).toEqual([
      { engine: 'stockfish', depth: 18 },
      { engine: 'cvs', depth: 12 },
    ]);
  });

  it('mergeProvenance keeps the last attribution and does not mutate inputs', () => {
    const a = attributionProvenance('allowed_fork', 1);
    const b = attributionProvenance('allowed_fork', 2);
    const merged = mergeProvenance(a, b);
    expect(merged.attribution).toEqual({ source: 'application', ruleId: 'allowed_fork', version: 2 });
    expect(a.attribution?.version).toBe(1); // untouched
    expect(merged.facts).toEqual([]);
    expect(merged.search).toBeUndefined();
  });

  it('mergeProvenance with no parts yields an empty, non-collapsed shape', () => {
    const merged = mergeProvenance();
    expect(merged.facts).toEqual([]);
    expect(merged.search).toBeUndefined();
    expect(merged.attribution).toBeUndefined();
    expect(provenanceSources(merged)).toEqual([]);
  });

  it('rust forks carry fork_validation validatorIds from the allowed-fork golden fixture', () => {
    const bundle = load('allowed-fork');
    const views = branches(bundle)
      .map(forkOpportunityView)
      .filter((v) => v.status === 'computed' && v.data.length > 0);
    expect(views.length).toBeGreaterThan(0);

    const provs: ClaimProvenance[] = views.map((v) =>
      rustFactsProvenance(v.provenance, bundle.provenance.factsRegistryVersion),
    );
    const merged = mergeProvenance(...provs);
    expect(merged.facts).toHaveLength(1);
    expect(merged.facts[0].source).toBe('rust');
    expect(merged.facts[0].validatorIds).toContain('fork_validation');
    expect(merged.facts[0].registryVersion).toBe(bundle.provenance.factsRegistryVersion);
    // The fixture's own validator id matches the view provenance string.
    const forkItem = bundle.played.position.availableMotifs;
    expect(forkItem.status).toBe('computed');
    if (forkItem.status === 'computed') {
      expect(forkItem.items[0].validator).toBe('fork_validation');
    }
  });

  it('rust pins carry pin_validation validatorIds from the allowed-pin golden fixture', () => {
    const bundle = load('allowed-pin');
    const views = branches(bundle)
      .map(pinOpportunityView)
      .filter((v) => v.status === 'computed' && v.data.length > 0);
    expect(views.length).toBeGreaterThan(0);

    const provs: ClaimProvenance[] = views.map((v) =>
      rustFactsProvenance(v.provenance, bundle.provenance.factsRegistryVersion),
    );
    const merged = mergeProvenance(...provs);
    expect(merged.facts).toHaveLength(1);
    expect(merged.facts[0].source).toBe('rust');
    expect(merged.facts[0].validatorIds).toContain('pin_validation');
    expect(merged.facts[0].registryVersion).toBe(bundle.provenance.factsRegistryVersion);

    const pinColl = bundle.played.position.availablePins;
    expect(pinColl.status).toBe('computed');
    if (pinColl.status === 'computed') {
      expect(pinColl.items[0].validator).toBe('pin_validation');
    }
  });

  it('bundleFactsProvenance lifts the fixture provenance block (engine commit + registry version)', () => {
    const bundle = load('allowed-pin');
    const p = bundleFactsProvenance(bundle.provenance);
    expect(p.facts[0].source).toBe('rust');
    expect(p.facts[0].registryVersion).toBe(bundle.provenance.factsRegistryVersion);
    expect(p.facts[0].validatorIds).toEqual(bundle.provenance.validators);
    expect(p.facts[0].validatorIds).toContain('fork_validation');
    expect(p.facts[0].validatorIds).toContain('pin_validation');
    // The PR-00 fixtures ship no engineCommit, so it stays absent (not null/empty).
    expect(p.facts[0].engineCommit).toBe(bundle.provenance.engineCommit);
  });
});
