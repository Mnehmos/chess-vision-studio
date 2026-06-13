import { describe, expect, it } from 'vitest';
import missedFixture from '../../../fixtures/teaching-facts/v1/missed-hanging-piece.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';

// Fixture: White's Nf3 can win Black's undefended queen on e5 (Nxe5 = best), but
// White played Kf1 (e1f1) instead — a missed free queen.
const FACTS = missedFixture as unknown as TeachingFactBundleV1;

function makeAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    positionBefore: FACTS.fenBefore,
    positionAfter: FACTS.played.fenAfter,
    move: 'Kf1',
    classification: 'blunder',
    evalBefore: { cp: 0, depth: 14, pv: ['Nxe5'] },
    evalAfter: { cp: -900, depth: 14, pv: ['Qb2'] },
    cpLoss: 9,
    rankedInsights: [],
    topExplanation: '',
    ...overrides,
  } as unknown as MoveAnalysis;
}

function cloneFacts(): TeachingFactBundleV1 {
  return JSON.parse(JSON.stringify(FACTS)) as TeachingFactBundleV1;
}

describe('missed_hanging_piece compiler', () => {
  it('commits the missed capture proven by the best move', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const ev = result.events.find((e) => e.topicId === 'missed_hanging_piece');
    expect(ev).toBeDefined();
    if (!ev) return;
    expect(ev.family).toBe('piece_safety');
    expect(ev.action).toBe('missed');
    expect(ev.mechanism).toBe('hanging_piece');
    expect(ev.side).toBe('white');
    expect(ev.proof.attribution).toBe('counterfactual_supported');
    expect(ev.targets.map((t) => t.id)).toEqual(['black-queen-e5']);
    expect(ev.actors.map((a) => a.id)).toEqual(['white-knight-f3']);
    expect(ev.correction?.move).toBe('f3e5');
    expect(ev.consequence.materialLoss).toBe(9);
    expect(ev.plan.headline).toContain('free queen');
    expect(ev.plan.cause).toContain('undefended');
    expect(ev.plan.correction).toContain('Nxe5');
  });

  it('does not fire on a best/excellent move', () => {
    const result = compileTeachingEvents({
      analysis: makeAnalysis({ classification: 'best', cpLoss: 0 }),
      facts: FACTS,
    });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'missed_hanging_piece')).toBe(false);
  });

  it('does not fire when the played move is itself the capture', () => {
    const facts = cloneFacts();
    facts.played.move.uci = 'f3e5';
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'missed_hanging_piece')).toBe(false);
  });

  it('does not fire when the best move is not the capture', () => {
    const facts = cloneFacts();
    if (facts.best) facts.best.move.uci = 'e1d1';
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'missed_hanging_piece')).toBe(false);
  });

  it('does not call the capture missed when it remains safely available', () => {
    const facts = cloneFacts();
    const target = facts.before.pieces.find((piece) => piece.id === 'black-queen-e5');
    if (!target || !facts.refutation) throw new Error('fixture missing target/refutation');
    facts.refutation.position.pieces.push(JSON.parse(JSON.stringify(target)));
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'missed_hanging_piece')).toBe(false);
  });

  it('produces byte-stable output for identical input', () => {
    const a = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    const b = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
