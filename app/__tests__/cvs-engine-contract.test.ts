/**
 * PR-00 contract tests — parse the golden CVS-engine fixtures
 * (fixtures/cvs-engine/*.json) through the TypeScript types and runtime guards
 * that consume them, and FAIL if a required field disappears or changes type.
 *
 * These fixtures were captured from the clean `master` Rust binary (f25c7b1) by
 * arena/capture-cvs-protocol.ts. They freeze the V1 wire contract; see
 * docs/protocol/CVS_ENGINE_PROTOCOL_INVENTORY.md. This test adds NO behavior — it
 * is the tripwire for protocol drift in later AnalysisFrameV2 PRs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isTeachingFactBundleV1,
  TEACHING_FACTS_REGISTRY_VERSION,
  type TeachingFactBundleV1,
} from '../../engine/teaching/types';
import type { CvsEngineAnalysis, CvsEngineTelemetry } from '../cvs-engine-client';

function loadFixture(name: string): Record<string, unknown> {
  const url = new URL(`../../fixtures/cvs-engine/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

/** Assert a field exists with the expected primitive/array type. Fails loudly. */
function requireField(
  obj: Record<string, unknown>,
  key: string,
  type: 'string' | 'number' | 'boolean' | 'array' | 'object',
): void {
  expect(key in obj, `missing field "${key}"`).toBe(true);
  const value = obj[key];
  if (type === 'array') {
    expect(Array.isArray(value), `field "${key}" should be an array`).toBe(true);
  } else if (type === 'object') {
    expect(value !== null && typeof value === 'object' && !Array.isArray(value), `field "${key}" should be an object`).toBe(true);
  } else {
    expect(typeof value, `field "${key}" should be ${type}`).toBe(type);
  }
}

/** Assert a nullable field is either null or the given primitive type. */
function requireNullable(
  obj: Record<string, unknown>,
  key: string,
  type: 'string' | 'number',
): void {
  expect(key in obj, `missing nullable field "${key}"`).toBe(true);
  const value = obj[key];
  expect(value === null || typeof value === type, `field "${key}" should be ${type} | null`).toBe(true);
}

const SEARCH_FIXTURES = [
  'search-v1.json',
  'search-fixedtime-v1.json',
  'search-forced-v1.json',
  'search-history-v1.json',
];

// The seven percentage/average fields the current CvsEngineTelemetry type names.
const TYPED_TELEMETRY_FIELDS: (keyof CvsEngineTelemetry)[] = [
  'qNodePct',
  'ttHitPct',
  'rfpCutoffPct',
  'futilitySkipPct',
  'firstMoveCutoffPct',
  'avgCutoffMoveIndex',
  'searchedEffectiveBranching',
];

// Full emitted telemetry key set (master == develop). Dropping any key from the
// binary breaks this list — the V1 telemetry drift tripwire (PR-11 will type it).
const ALL_TELEMETRY_KEYS = [
  'nodes', 'mainNodes', 'qNodes', 'qNodePct', 'qCaptures', 'qSeeSkips', 'quietExt',
  'maxQDepth', 'ttProbes', 'ttEntries', 'ttHits', 'ttMissCold', 'ttMissContended',
  'ttHitPct', 'ttEntryPct', 'ttCutoffs', 'ttCutoffPct', 'cutoffs', 'hashMoveCutoffs',
  'hashMoveCutoffPct', 'firstMoveCutoffs', 'firstMoveCutoffPct', 'killerCutoffs',
  'historyCutoffs', 'cutoffMoveIndexSum', 'cutoffMoveIndexCount', 'avgCutoffMoveIndex',
  'legalMoveNodes', 'legalMoveSum', 'avgLegalMoves', 'searchedMoves', 'prunedMoves',
  'searchedEffectiveBranching', 'nullAttempts', 'nullCutoffs', 'nullCutoffPct',
  'rfpAttempts', 'rfpCutoffs', 'rfpCutoffPct', 'futilityAttempts', 'futilitySkips',
  'futilitySkipPct', 'lmpAttempts', 'lmpSkips', 'lmpSkipPct', 'seePruneAttempts',
  'seePruneSkips', 'seePruneSkipPct', 'deltaAttempts', 'deltaSkips', 'deltaSkipPct',
  'lmrReductions', 'lmrResearches', 'lmrResearchPct', 'pvsResearches',
  'aspirationResearches', 'dangerExtensionPlies', 'foreignHints', 'foreignCutoffs',
  'branchingByPly', 'timeMs',
];

describe('CVS engine search response contract', () => {
  for (const name of SEARCH_FIXTURES) {
    describe(name, () => {
      const fixture = loadFixture(name);

      it('satisfies the required CvsEngineAnalysis fields', () => {
        requireField(fixture, 'fen', 'string');
        requireNullable(fixture, 'uci', 'string');
        requireField(fixture, 'scoreCp', 'number');
        requireNullable(fixture, 'mate', 'number');
        requireField(fixture, 'pv', 'array');
        for (const mv of fixture.pv as unknown[]) expect(typeof mv).toBe('string');
        requireField(fixture, 'depth', 'number');
        requireField(fixture, 'nodes', 'number');
        requireField(fixture, 'qNodes', 'number');
        requireField(fixture, 'ttHits', 'number');
        requireField(fixture, 'timeMs', 'number');
        requireField(fixture, 'telemetry', 'object');
        // Structurally usable as CvsEngineAnalysis (compile-time + runtime).
        const analysis = fixture as unknown as CvsEngineAnalysis;
        expect(Array.isArray(analysis.pv)).toBe(true);
      });

      it('carries the shared search-metadata fields (consolidated baseline)', () => {
        requireField(fixture, 'attemptedDepth', 'number');
        requireField(fixture, 'termination', 'string');
        requireField(fixture, 'resultSource', 'string');
        requireField(fixture, 'rootOrder', 'array');
        for (const mv of fixture.rootOrder as unknown[]) expect(typeof mv).toBe('string');
        requireField(fixture, 'iterations', 'array');
        const iterations = fixture.iterations as Array<Record<string, unknown>>;
        expect(iterations.length).toBeGreaterThan(0);
        for (const iter of iterations) {
          requireField(iter, 'depth', 'number');
          requireNullable(iter, 'uci', 'string');
          requireField(iter, 'scoreCp', 'number');
          requireField(iter, 'nodes', 'number');
          requireField(iter, 'timeMs', 'number');
          requireField(iter, 'pv', 'array');
        }
        // partialIteration is object | null (null when the last iteration finished).
        expect('partialIteration' in fixture, 'missing partialIteration').toBe(true);
        const partial = fixture.partialIteration;
        expect(partial === null || (typeof partial === 'object' && !Array.isArray(partial))).toBe(true);
      });

      it('telemetry carries every typed CvsEngineTelemetry field as a number', () => {
        const telemetry = fixture.telemetry as Record<string, unknown>;
        for (const field of TYPED_TELEMETRY_FIELDS) {
          expect(field in telemetry, `telemetry missing "${field}"`).toBe(true);
          expect(typeof telemetry[field], `telemetry.${field} should be number`).toBe('number');
        }
      });

      it('telemetry retains the full V1 key set', () => {
        const telemetry = fixture.telemetry as Record<string, unknown>;
        for (const key of ALL_TELEMETRY_KEYS) {
          expect(key in telemetry, `telemetry missing V1 key "${key}"`).toBe(true);
        }
      });

      it('does NOT contain experimental iid telemetry (engine-branch only)', () => {
        const telemetry = fixture.telemetry as Record<string, unknown>;
        expect('iidSearches' in telemetry).toBe(false);
        expect('iidFound' in telemetry).toBe(false);
      });
    });
  }

  it('analyze_one shape carries its top-level mirror counters', () => {
    const fixture = loadFixture('search-v1.json');
    for (const key of ['qCaptures', 'quietExt', 'cutoffs', 'killerCutoffs', 'historyCutoffs', 'nullCutoffs']) {
      requireField(fixture, key, 'number');
    }
  });

  it('search_pos/go shape carries foreignHints/foreignCutoffs top-level', () => {
    const fixture = loadFixture('search-history-v1.json');
    requireField(fixture, 'foreignHints', 'array');
    requireField(fixture, 'foreignCutoffs', 'array');
  });
});

describe('CVS engine facts response contract', () => {
  const fixture = loadFixture('facts-v1.json');

  it('passes the isTeachingFactBundleV1 runtime guard', () => {
    expect(isTeachingFactBundleV1(fixture)).toBe(true);
  });

  it('carries both counterfactual branches and matching registry version', () => {
    const bundle = fixture as unknown as TeachingFactBundleV1;
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.best, 'best branch (counterfactual) should be present').toBeDefined();
    expect(bundle.refutation, 'refutation branch should be present').toBeDefined();
    expect(bundle.provenance.factsRegistryVersion).toBe(TEACHING_FACTS_REGISTRY_VERSION);
    expect(Array.isArray(bundle.errors)).toBe(true);
    expect(bundle.errors.length).toBe(0);
  });

  it('preserves tagged-union and flattened nested shapes', () => {
    const bundle = fixture as unknown as TeachingFactBundleV1;
    const before = bundle.before;
    // FactCollection tagged union.
    expect(['computed', 'uncomputed', 'unavailable']).toContain(before.hazards.status);
    // PieceFact flattens PieceRef + FactValue tagged union on `see`.
    const piece = before.pieces[0];
    expect(typeof piece.id).toBe('string');
    expect(typeof piece.square).toBe('string');
    expect(['computed', 'uncomputed', 'unavailable']).toContain(piece.see.status);
    // MoveStateFacts.move + deltas.
    expect(typeof bundle.played.move.uci).toBe('string');
    expect(bundle.played.deltas).toHaveProperty('createdHazards');
    expect(bundle.played.deltas).toHaveProperty('removedStructures');
  });

  it('omits engineCommit when unset (skip_serializing_if)', () => {
    const bundle = fixture as unknown as TeachingFactBundleV1;
    // Optional field — absent in the default-build fixture. Presence must not be
    // required by the guard.
    expect(bundle.provenance.engineCommit).toBeUndefined();
  });
});

describe('CVS engine eval response contract', () => {
  it('carries fen + White-POV eval; nnueStmCp absent without --nnue', () => {
    const fixture = loadFixture('eval-v1.json');
    requireField(fixture, 'fen', 'string');
    requireField(fixture, 'evalWhiteCp', 'number');
    expect('nnueStmCp' in fixture).toBe(false);
  });
});

describe('CVS feature dump contract', () => {
  it('carries registry identity + index-aligned id/name arrays', () => {
    const fixture = loadFixture('cvs-features-v1.json');
    requireField(fixture, 'fen', 'string');
    requireField(fixture, 'registryVersion', 'number');
    requireField(fixture, 'registryHash', 'string');
    requireField(fixture, 'inputDim', 'number');
    requireField(fixture, 'activeIds', 'array');
    requireField(fixture, 'activeNames', 'array');
    const ids = fixture.activeIds as unknown[];
    const names = fixture.activeNames as unknown[];
    expect(ids.length, 'fixture should exercise non-empty feature arrays').toBeGreaterThan(0);
    expect(names.length).toBe(ids.length);
    for (const id of ids) expect(typeof id).toBe('number');
    for (const n of names) expect(typeof n).toBe('string');
    // CVS-NNUE feature registry version is distinct from the facts registry.
    expect(fixture.registryVersion).not.toBe(TEACHING_FACTS_REGISTRY_VERSION);
  });
});

describe('CVS engine identity contract (cmd:identity)', () => {
  it('carries engine id, depth, resolved options, and nullable NNUE identity', () => {
    const fixture = loadFixture('identity-v1.json');
    requireField(fixture, 'engine', 'string');
    expect(fixture.engine).toBe('cvs-bitboard-core');
    requireField(fixture, 'depth', 'number');
    requireField(fixture, 'options', 'object');
    const options = fixture.options as Record<string, unknown>;
    // Spot-check resolved search options exist with primitive types.
    for (const key of ['useTt', 'lmr', 'pvs', 'rfp', 'futility', 'threads']) {
      expect(key in options, `options missing "${key}"`).toBe(true);
      expect(['boolean', 'number']).toContain(typeof options[key]);
    }
    // NNUE identity fields are present-but-null without a loaded model.
    expect('nnue' in fixture).toBe(true);
    expect(fixture.nnue).toBeNull();
    expect('helperNnue' in fixture).toBe(true);
    expect(fixture.helperNnue).toBeNull();
  });
});
