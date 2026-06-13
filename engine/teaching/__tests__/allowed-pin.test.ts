import { describe, expect, it } from 'vitest';
import allowedPinFixture from '../../../fixtures/teaching-facts/v1/allowed-pin.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';

// Fixture: after the neutral a1b1, Black's Bc8-g4 pins Nf3 to Kd1 (absolute). The
// best move h2h3 covers g4 and prevents it; g4 is the Stockfish refutation.
const FACTS = allowedPinFixture as unknown as TeachingFactBundleV1;

function makeAnalysis(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    positionBefore: FACTS.fenBefore,
    positionAfter: FACTS.played.fenAfter,
    move: 'Rb1',
    classification: 'mistake',
    evalBefore: { cp: 0, depth: 14, pv: ['h3'] },
    evalAfter: { cp: -150, depth: 14, pv: ['Bg4'] },
    cpLoss: 1.5,
    rankedInsights: [],
    topExplanation: '',
    ...overrides,
  } as unknown as MoveAnalysis;
}

function cloneFacts(): TeachingFactBundleV1 {
  return JSON.parse(JSON.stringify(FACTS)) as TeachingFactBundleV1;
}

describe('allowed_pin compiler', () => {
  it('commits the allowed absolute pin, proven by the refutation', () => {
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(result.computed).toBe(true);
    if (!result.computed) return;
    const ev = result.events.find((e) => e.topicId === 'allowed_pin');
    expect(ev).toBeDefined();
    if (!ev) return;
    expect(ev.family).toBe('tactics');
    expect(ev.action).toBe('allowed');
    expect(ev.mechanism).toBe('pin');
    expect(ev.side).toBe('white');
    expect(ev.proof.attribution).toBe('proven_refutation');
    expect(ev.proof.badge).toBe('engine_line');
    expect(ev.actors.map((a) => a.id)).toEqual(['black-bishop-g4']);
    expect(ev.targets.map((t) => t.id)).toEqual(['white-knight-f3', 'white-king-d1']);
    expect(ev.punishment?.move).toBe('c8g4');
    expect(ev.correction?.move).toBe('h2h3');
    expect(ev.plan.headline).toContain('allowed a pin');
    expect(ev.plan.cause).toContain('pins the knight on f3 to the king on d1');
    expect(ev.plan.consequence).toContain('pinned to the king and cannot move');
    expect(ev.plan.correction).toContain('h3');
  });

  it('emits no pin when the played position has none', () => {
    const facts = cloneFacts();
    facts.played.position.availablePins = { status: 'computed', items: [] };
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'allowed_pin')).toBe(false);
  });

  it('withholds the claim without move-causation evidence', () => {
    const facts = cloneFacts();
    delete (facts as { refutation?: unknown }).refutation;
    if (facts.best) {
      facts.best.position.availablePins = JSON.parse(
        JSON.stringify(facts.played.position.availablePins),
      );
    }
    const result = compileTeachingEvents({ analysis: makeAnalysis(), facts });
    if (!result.computed) throw new Error('expected computed');
    expect(result.events.some((e) => e.topicId === 'allowed_pin')).toBe(false);
  });

  it('produces byte-stable output for identical input', () => {
    const a = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    const b = compileTeachingEvents({ analysis: makeAnalysis(), facts: FACTS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
