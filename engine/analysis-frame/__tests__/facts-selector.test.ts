import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TeachingFactBundleV1 } from '../../teaching/types';
import { selectPositionFacts } from '../index';

const facts = JSON.parse(
  readFileSync(new URL('../../../fixtures/cvs-engine/facts-v1.json', import.meta.url), 'utf8'),
) as TeachingFactBundleV1;

describe('selectPositionFacts (shared Analyze/Play selector, PR-05)', () => {
  it('pending → no facts, source pending (caller must not fall back)', () => {
    const sel = selectPositionFacts('pending', facts, facts.played.fenAfter);
    expect(sel.source).toBe('pending');
    expect(sel.position).toBeNull();
  });

  it('computed + played board → rust facts.played.position', () => {
    const sel = selectPositionFacts('computed', facts, facts.played.fenAfter);
    expect(sel.source).toBe('rust');
    expect(sel.position).toBe(facts.played.position);
  });

  it('computed + root board → rust facts.before', () => {
    const sel = selectPositionFacts('computed', facts, facts.fenBefore);
    expect(sel.source).toBe('rust');
    expect(sel.position).toBe(facts.before);
  });

  it('computed + best branch → that branch position', () => {
    if (!facts.best) throw new Error('fixture must include a best branch');
    const sel = selectPositionFacts('computed', facts, facts.best.fenAfter);
    expect(sel.source).toBe('rust');
    expect(sel.position).toBe(facts.best.position);
  });

  it('computed + refutation branch → that branch position', () => {
    if (!facts.refutation) throw new Error('fixture must include a refutation branch');
    const sel = selectPositionFacts('computed', facts, facts.refutation.fenAfter);
    expect(sel.source).toBe('rust');
    expect(sel.position).toBe(facts.refutation.position);
  });

  it('computed but board does not match the bundle (e.g. after undo) → fallback', () => {
    const sel = selectPositionFacts('computed', facts, '8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(sel.source).toBe('fallback');
    expect(sel.position).toBeNull();
  });

  it('unavailable / idle / error → fallback', () => {
    expect(selectPositionFacts('unavailable', null, facts.fenBefore).source).toBe('fallback');
    expect(selectPositionFacts('idle', null, facts.fenBefore).source).toBe('fallback');
    expect(selectPositionFacts('error', facts, facts.fenBefore).source).toBe('fallback');
  });
});
