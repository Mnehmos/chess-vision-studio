import { describe, expect, it } from 'vitest';
import pawnFixture from '../../../fixtures/teaching-facts/v1/pawn-structure-damage.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';

// The fixture: White plays b3c4 (bxc4), creating doubled + isolated c-pawns.
// The best move c2c3 avoids the damage → the textbook causally-supported case.
const FACTS = pawnFixture as unknown as TeachingFactBundleV1;

function makeAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    positionBefore: FACTS.fenBefore,
    positionAfter: FACTS.played.fenAfter,
    move: 'bxc4',
    classification: 'mistake',
    evalBefore: { cp: 0, depth: 12, pv: ['c3'] },
    evalAfter: { cp: 0, depth: 12, pv: [] },
    cpLoss: 1.4,
    rankedInsights: [],
    topExplanation: '',
    ...overrides,
  } as unknown as MoveAnalysis;
}

function cloneFacts(): TeachingFactBundleV1 {
  return JSON.parse(JSON.stringify(FACTS)) as TeachingFactBundleV1;
}

describe('pawn_structure_damage compiler', () => {
  it('commits a causally-supported event from the fixture, naming exact pawns and files', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    expect(result.events).toHaveLength(1);
    const ev = result.events[0]!;
    expect(ev.topicId).toBe('pawn_structure_damage');
    expect(ev.family).toBe('pawn_structure');
    expect(ev.action).toBe('worsened');
    expect(ev.side).toBe('white');
    expect(ev.proof.attribution).toBe('counterfactual_supported');
    expect(ev.proof.badge).toBe('counterfactual_supported');
    expect(ev.squares).toEqual(['c2', 'c4']);
    expect(ev.plan.cause).toContain('doubles the c-pawns (c2, c4)');
    expect(ev.plan.cause).toContain('isolated');
    // counterfactual: correction names the real best move only
    expect(ev.correction?.move).toBe('c2c3');
    expect(ev.plan.correction).toContain('c3');
    // names ONLY real differences — passed pawns (a benefit) are never blamed
    expect(ev.plan.cause).not.toContain('passed');
  });

  it('treats a good move as an accepted tradeoff, not a mistake', () => {
    const result = compileTeachingEvents({
      analysis: makeAnalysis({ classification: 'best', cpLoss: 0 }),
      facts: FACTS,
    });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const ev = result.events[0]!;
    expect(ev.action).toBe('accepted_tradeoff');
    expect(ev.proof.attribution).toBe('descriptive_only');
    expect(ev.proof.badge).toBe('structural_fact');
    expect(ev.correction).toBeUndefined();
    expect(ev.plan.correction).toBeUndefined();
    expect(ev.plan.caveat).toContain('accepted tradeoff');
    // bxc4 captured the black c4 pawn → a proven material gain backs the caveat
    expect(ev.plan.caveat).toContain('wins material');
  });

  it('is descriptive-only when the best move creates the same damage (unavoidable)', () => {
    const facts = cloneFacts();
    facts.best!.deltas.createdStructures = JSON.parse(
      JSON.stringify(facts.played.deltas.createdStructures),
    );
    const result = compileTeachingEvents({
      analysis: makeAnalysis({ classification: 'mistake' }),
      facts,
    });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const ev = result.events[0]!;
    expect(ev.action).toBe('created');
    expect(ev.proof.attribution).toBe('descriptive_only');
    expect(ev.correction).toBeUndefined();
    expect(ev.plan.correction).toBeUndefined();
    expect(ev.plan.consequence).toBeUndefined(); // no causal claim from structure alone
  });

  it('emits no event when the move creates no structural damage', () => {
    const facts = cloneFacts();
    facts.played.deltas.createdStructures = { status: 'computed', items: [] };
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    expect(result.events).toHaveLength(0);
  });

  it('does not attribute cause when the counterfactual is unknown', () => {
    const facts = cloneFacts();
    // best branch absent → cannot prove the correction avoids the weakness
    delete (facts as { best?: unknown }).best;
    const result = compileTeachingEvents({
      analysis: makeAnalysis({ classification: 'mistake' }),
      facts,
    });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const ev = result.events[0]!;
    expect(ev.action).toBe('created');
    expect(ev.proof.attribution).toBe('descriptive_only');
    expect(ev.plan.correction).toBeUndefined();
  });

  it('produces byte-stable output for identical input', () => {
    const a = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    const b = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('refuses to compile an unknown schema version', () => {
    const facts = cloneFacts();
    (facts as { schemaVersion: number }).schemaVersion = 2;
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    expect(result).toEqual({ computed: false, reason: 'schema_mismatch' });
  });
});
