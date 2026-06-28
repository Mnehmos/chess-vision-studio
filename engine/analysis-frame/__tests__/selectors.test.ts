import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TeachingFactBundleV1 } from '../../teaching/types';
import { buildCanonicalTeaching } from '../../teaching/canonical';
import { proposeDeltaTopics } from '../../teaching/delta-topics';
import { computed } from '../artifact';
import { type AnalysisIdentityV2, buildHistoryHash } from '../identity';
import {
  type AnalysisFrameV2,
  type EngineSearchResultV2,
  buildAnalysisFrameV2,
  deserializeAnalysisFrame,
  serializeAnalysisFrame,
} from '../frame';
import {
  selectCurrentPositionFacts,
  selectEngineDisagreement,
  selectHazardDelta,
  selectLensView,
  selectNarrationPlan,
  selectPrimaryTeaching,
  selectSquareFact,
} from '../selectors';

function load(name: string): TeachingFactBundleV1 {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/teaching-facts/v1/${name}.json`, import.meta.url), 'utf8'),
  ) as TeachingFactBundleV1;
}

const bundle = load('pawn-structure-damage');

function identity(): AnalysisIdentityV2 {
  return {
    schemaVersion: 2,
    gameKey: 'g',
    ply: 1,
    initialFen: bundle.fenBefore,
    historyUci: [],
    historyHash: buildHistoryHash([]),
    fenBefore: bundle.fenBefore,
    playedMoveUci: bundle.played.move.uci,
    fenAfter: bundle.played.fenAfter,
    branch: { role: 'played', source: 'game' },
  };
}

function engineResult(bestMoveUci: string): EngineSearchResultV2 {
  return { identity: identity(), bestMoveUci, pvUci: [bestMoveUci] };
}

function fullFrame(): AnalysisFrameV2 {
  const id = identity();
  const teaching = buildCanonicalTeaching(proposeDeltaTopics(bundle));
  return buildAnalysisFrameV2(id, {
    createdAt: '2026-01-01T00:00:00Z',
    factsRegistryVersion: 6,
    facts: computed({ rawV1: bundle, before: bundle.before }, '2026-01-01T00:00:00Z'),
    stockfishReview: computed({ identity: id }, '2026-01-01T00:00:00Z'),
    stockfishRoot: computed(engineResult('c2c3'), '2026-01-01T00:00:00Z'),
    cvsRoot: computed(engineResult('c2c3'), '2026-01-01T00:00:00Z'),
    teaching: computed(teaching, '2026-01-01T00:00:00Z'),
  });
}

describe('AnalysisFrameV2 selectors (PR-15)', () => {
  it('reconstructs every analysis-derived view AFTER serialize → deserialize', () => {
    const restored = deserializeAnalysisFrame(serializeAnalysisFrame(fullFrame()));

    const facts = selectCurrentPositionFacts(restored);
    expect(facts).not.toBeNull();
    expect(facts?.sideToMove).toBeDefined();

    expect(selectPrimaryTeaching(restored)).not.toBeNull(); // a committed delta topic

    const disagreement = selectEngineDisagreement(restored);
    expect(disagreement.bestMovesAgree).toBe(true);
    expect(disagreement.stockfish?.bestMoveUci).toBe('c2c3');

    expect(selectHazardDelta(restored)).not.toBeNull();

    expect(selectSquareFact(restored, 'a1')?.square).toBe('a1');

    const lens = selectLensView(restored, 'threat');
    expect(lens?.source).toBe('rust');

    const plan = selectNarrationPlan(restored);
    expect(plan.identity.gameKey).toBe('g');
    expect(plan.facts).not.toBeNull();
    expect(plan.primaryTeaching).not.toBeNull();
    expect(plan.hazardDelta).not.toBeNull();
  });

  it('serialization is deterministic + identity round-trips', () => {
    const frame = fullFrame();
    expect(serializeAnalysisFrame(frame)).toBe(serializeAnalysisFrame(fullFrame()));
    const restored = deserializeAnalysisFrame(serializeAnalysisFrame(frame));
    expect(restored.identity).toEqual(frame.identity);
  });

  it('fails closed: an idle frame yields null/empty from every selector', () => {
    const idle = buildAnalysisFrameV2(identity(), { createdAt: '2026-01-01T00:00:00Z' });
    expect(selectCurrentPositionFacts(idle)).toBeNull();
    expect(selectPrimaryTeaching(idle)).toBeNull();
    expect(selectHazardDelta(idle)).toBeNull();
    expect(selectSquareFact(idle, 'a1')).toBeUndefined();
    expect(selectLensView(idle, 'threat')).toBeNull();
    const disagreement = selectEngineDisagreement(idle);
    expect(disagreement.stockfish).toBeNull();
    expect(disagreement.cvs).toBeNull();
    expect(disagreement.bestMovesAgree).toBeNull();
  });
});
