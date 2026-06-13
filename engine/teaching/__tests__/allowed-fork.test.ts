import { describe, expect, it } from 'vitest';
import allowedForkFixture from '../../../fixtures/teaching-facts/v1/allowed-fork.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';

// Fixture: Ra1-e1 creates the rook as a second target for Black's Ng5-f3+ fork.
// The best move Kg1-h1 sidesteps it, and g5f3 is the Stockfish refutation.
const FACTS = allowedForkFixture as unknown as TeachingFactBundleV1;

function makeAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    positionBefore: FACTS.fenBefore,
    positionAfter: FACTS.played.fenAfter,
    move: 'Re1',
    classification: 'blunder',
    evalBefore: { cp: 0, depth: 14, pv: ['Kh1'] },
    evalAfter: { cp: -500, depth: 14, pv: ['Nf3+'] },
    cpLoss: 5,
    rankedInsights: [],
    topExplanation: '',
    ...overrides,
  } as unknown as MoveAnalysis;
}

function cloneFacts(): TeachingFactBundleV1 {
  return JSON.parse(JSON.stringify(FACTS)) as TeachingFactBundleV1;
}

describe('allowed_fork compiler', () => {
  it('commits the allowed fork, proven by the Stockfish refutation', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const fork = result.events.find((e) => e.topicId === 'allowed_fork');
    expect(fork).toBeDefined();
    if (!fork) return;
    expect(fork.family).toBe('tactics');
    expect(fork.action).toBe('allowed');
    expect(fork.mechanism).toBe('fork');
    expect(fork.side).toBe('white'); // White allowed it
    expect(fork.proof.attribution).toBe('proven_refutation');
    expect(fork.proof.badge).toBe('engine_line');
    expect(fork.actors.map((a) => a.id)).toEqual(['black-knight-f3']);
    expect(fork.targets.map((t) => t.id).sort()).toEqual(['white-king-g1', 'white-rook-e1']);
    expect(fork.squares).toEqual(['e1', 'f3', 'g1']);
    expect(fork.punishment?.move).toBe('g5f3');
    expect(fork.correction?.move).toBe('g1h1'); // best avoids the fork
    expect(fork.consequence.materialLoss).toBe(5); // 500 cp -> 5 pawns
    // evidence-gated prose
    expect(fork.plan.headline).toContain('knight fork');
    expect(fork.plan.cause).toContain('the king on g1');
    expect(fork.plan.cause).toContain('the rook on e1');
    expect(fork.plan.consequence).toContain('cannot be saved');
    expect(fork.plan.correction).toContain('Kh1');
  });

  it('ranks the fork above a quiet structural event', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    if (!result.computed) throw new Error('expected computed');
    expect(result.primaryEvent?.topicId).toBe('allowed_fork');
  });

  it('does not emit an unrelated structural event', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'pawn_structure_damage')).toBe(false);
  });

  it('rejects a fork opportunity that already existed before the move', () => {
    const facts = cloneFacts();
    facts.before.opponentAvailableMotifs = JSON.parse(
      JSON.stringify(facts.played.position.availableMotifs),
    );
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'allowed_fork')).toBe(false);
  });

  it('emits no fork when the played position has none', () => {
    const facts = cloneFacts();
    facts.played.position.availableMotifs = { status: 'computed', items: [] };
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'allowed_fork')).toBe(false);
  });

  it('withholds the claim without move-causation evidence', () => {
    // No refutation match AND best also concedes a fork → cannot attribute it.
    const facts = cloneFacts();
    delete (facts as { refutation?: unknown }).refutation;
    if (facts.best) {
      facts.best.position.availableMotifs = JSON.parse(
        JSON.stringify(facts.played.position.availableMotifs),
      );
    }
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'allowed_fork')).toBe(false);
  });

  it('does not claim material is forced from counterfactual evidence alone', () => {
    const facts = cloneFacts();
    delete (facts as { refutation?: unknown }).refutation;
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    const fork = result.events.find((event) => event.topicId === 'allowed_fork');
    expect(fork?.proof.attribution).toBe('counterfactual_supported');
    expect(fork?.consequence.materialLoss).toBeUndefined();
    expect(fork?.plan.consequence).toBeUndefined();
  });

  it('produces byte-stable output for identical input', () => {
    const a = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    const b = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
