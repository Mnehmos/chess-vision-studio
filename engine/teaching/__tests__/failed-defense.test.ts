import { describe, expect, it } from 'vitest';
import failedFixture from '../../../fixtures/teaching-facts/v1/failed-defense.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';

// Fixture: White's Rc2 is already attacked by Bb3. White plays Kf2 (ignoring it);
// Black answers Bxc2. The best move Rc3 saves the rook.
const FACTS = failedFixture as unknown as TeachingFactBundleV1;

function makeAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    positionBefore: FACTS.fenBefore,
    positionAfter: FACTS.played.fenAfter,
    move: 'Kf2',
    classification: 'mistake',
    evalBefore: { cp: 0, depth: 14, pv: ['Rc3'] },
    evalAfter: { cp: -500, depth: 14, pv: ['Bxc2'] },
    cpLoss: 5,
    rankedInsights: [],
    topExplanation: '',
    ...overrides,
  } as unknown as MoveAnalysis;
}

function cloneFacts(): TeachingFactBundleV1 {
  return JSON.parse(JSON.stringify(FACTS)) as TeachingFactBundleV1;
}

describe('failed_defense compiler', () => {
  it('commits a failed defense proven by the refutation', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const ev = result.events.find((e) => e.topicId === 'failed_defense');
    expect(ev).toBeDefined();
    if (!ev) return;
    expect(ev.family).toBe('defense');
    expect(ev.action).toBe('failed_to_answer');
    expect(ev.mechanism).toBe('hanging_piece');
    expect(ev.side).toBe('white');
    expect(ev.proof.attribution).toBe('proven_refutation');
    expect(ev.proof.badge).toBe('engine_line');
    expect(ev.targets.map((t) => t.id)).toEqual(['white-rook-c2']);
    expect(ev.punishment?.move).toBe('b3c2');
    expect(ev.correction?.move).toBe('c2c3');
    expect(ev.consequence.materialLoss).toBe(5);
    expect(ev.plan.headline).toContain('rook on c2');
    expect(ev.plan.cause).toContain('Bxc2');
    expect(ev.plan.correction).toContain('Rc3');
  });

  it('does not fire on a best/excellent move', () => {
    const result = compileTeachingEvents({
      analysis: makeAnalysis({ classification: 'best', cpLoss: 0 }),
      facts: FACTS,
    });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'failed_defense')).toBe(false);
  });

  it('does not fire when the best move also leaves the piece hanging', () => {
    const facts = cloneFacts();
    if (facts.best) {
      facts.best.position.pieces = JSON.parse(JSON.stringify(facts.played.position.pieces));
    }
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'failed_defense')).toBe(false);
  });

  it('does not fire when the hazard did not pre-exist', () => {
    const facts = cloneFacts();
    const before = facts.before.pieces.find((p) => p.id === 'white-rook-c2');
    if (before) before.attacked = false;
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'failed_defense')).toBe(false);
  });

  it('produces byte-stable output for identical input', () => {
    const a = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    const b = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
