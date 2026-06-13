import { describe, expect, it } from 'vitest';
import allowedForkFixture from '../../../fixtures/teaching-facts/v1/allowed-fork.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { buildTeachingRecord, TEACHING_COMPILER_VERSION } from '../record';

const FACTS = allowedForkFixture as unknown as TeachingFactBundleV1;

const analysis = {
  positionBefore: FACTS.fenBefore,
  positionAfter: FACTS.played.fenAfter,
  move: 'e4',
  classification: 'blunder',
  evalBefore: { cp: 0, depth: 20, pv: ['Kh1'] },
  evalAfter: { cp: -500, depth: 20, pv: ['Nf3+'] },
  cpLoss: 5,
  rankedInsights: [],
  topExplanation: '',
} as unknown as MoveAnalysis;

describe('buildTeachingRecord', () => {
  const record = buildTeachingRecord({ gameKey: 'g1', ply: 14, san: 'e4', analysis, facts: FACTS });

  it('packs the Stockfish judgment', () => {
    expect(record.classification).toBe('blunder');
    expect(record.cpLoss).toBe(5);
    expect(record.bestLine).toEqual(['Kh1']);
    expect(record.refutationLine).toEqual(['Nf3+']);
    expect(record.gameKey).toBe('g1');
    expect(record.ply).toBe(14);
  });

  it('carries the Rust fact bundle and committed teaching', () => {
    expect(record.facts.provenance.factsRegistryVersion).toBe(3);
    expect(record.primaryTopicId).toBe('allowed_fork');
    expect(record.events.some((e) => e.topicId === 'allowed_fork')).toBe(true);
    expect(record.primaryPlan?.headline).toContain('fork');
  });

  it('includes a generated puzzle for the primary topic', () => {
    expect(record.puzzle?.topicId).toBe('allowed_fork');
    expect(record.puzzle?.stages.length).toBeGreaterThanOrEqual(1);
  });

  it('stamps full provenance (schema/registry/compiler/engine/depth)', () => {
    expect(record.provenance.teachingSchemaVersion).toBe(1);
    expect(record.provenance.factsRegistryVersion).toBe(3);
    expect(record.provenance.compilerVersion).toBe(TEACHING_COMPILER_VERSION);
    expect(record.provenance.engine).toBe('cvs-bitboard-core');
    expect(record.provenance.sfDepth).toBe(20);
    expect(record.outcome).toBeNull();
  });
});
