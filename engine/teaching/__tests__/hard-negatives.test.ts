import { describe, expect, it } from 'vitest';
import allowedForkFixture from '../../../fixtures/teaching-facts/v1/allowed-fork.json';
import allowedPinFixture from '../../../fixtures/teaching-facts/v1/allowed-pin.json';
import failedFixture from '../../../fixtures/teaching-facts/v1/failed-defense.json';
import missedFixture from '../../../fixtures/teaching-facts/v1/missed-hanging-piece.json';
import pawnFixture from '../../../fixtures/teaching-facts/v1/pawn-structure-damage.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';

// Gate 1 (plan §19): a look-alike must NEVER produce a false named topic. Each case
// takes a real fixture, removes the one piece of evidence the topic requires, and
// asserts the topic does not commit — claim discipline over coverage.

function analysis(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    positionBefore: '',
    positionAfter: '',
    move: 'e4',
    classification: 'mistake',
    evalBefore: { cp: 0, depth: 14, pv: ['x'] },
    evalAfter: { cp: 0, depth: 14, pv: ['x'] },
    cpLoss: 3,
    rankedInsights: [],
    topExplanation: '',
    ...over,
  } as unknown as MoveAnalysis;
}

function clone(fixture: unknown): TeachingFactBundleV1 {
  return JSON.parse(JSON.stringify(fixture)) as TeachingFactBundleV1;
}

function topicsOf(facts: TeachingFactBundleV1, a: MoveAnalysis): string[] {
  const result = compileTeachingEvents({ analysis: a, facts });
  return result.computed ? result.events.map((e) => e.topicId) : ['__uncomputed__'];
}

describe('teaching compiler — hard negatives (no false topics)', () => {
  it('a quiet position with no facts commits nothing', () => {
    const facts = clone(pawnFixture);
    facts.played.deltas.createdStructures = { status: 'computed', items: [] };
    expect(topicsOf(facts, analysis({ move: 'c3', classification: 'best', cpLoss: 0 }))).toEqual([]);
  });

  it('allowed_fork: a fork the best move ALSO concedes (no counterfactual) is not "allowed"', () => {
    const facts = clone(allowedForkFixture);
    delete (facts as { refutation?: unknown }).refutation;
    if (facts.best) {
      facts.best.position.availableMotifs = JSON.parse(
        JSON.stringify(facts.played.position.availableMotifs),
      );
    }
    expect(topicsOf(facts, analysis({ move: 'e4' }))).not.toContain('allowed_fork');
  });

  it('allowed_pin: a pin the best move ALSO concedes is not "allowed"', () => {
    const facts = clone(allowedPinFixture);
    delete (facts as { refutation?: unknown }).refutation;
    if (facts.best) {
      facts.best.position.availablePins = JSON.parse(
        JSON.stringify(facts.played.position.availablePins),
      );
    }
    expect(topicsOf(facts, analysis({ move: 'Rb1' }))).not.toContain('allowed_pin');
  });

  it('missed_hanging_piece: a hanging piece the engine does NOT take is not "missed"', () => {
    const facts = clone(missedFixture);
    if (facts.best) facts.best.move.uci = 'e1d1'; // best is not the capture
    expect(topicsOf(facts, analysis({ move: 'Kf1', evalBefore: { cp: 0, depth: 14, pv: ['Kd1'] } }))).not.toContain(
      'missed_hanging_piece',
    );
  });

  it('failed_defense: a piece that is defended after the move is not "failed"', () => {
    const facts = clone(failedFixture);
    // the rook is attacked but no longer SEE-losing → adequately defended
    for (const p of facts.played.position.pieces) {
      if (p.id === 'white-rook-c2') p.see = { status: 'computed', value: { losing: false } };
    }
    expect(topicsOf(facts, analysis({ move: 'Kf2' }))).not.toContain('failed_defense');
  });

  it('pawn_structure_damage: a good move that damages structure is a tradeoff, never a mistake claim', () => {
    const events = compileTeachingEvents({
      analysis: analysis({ move: 'bxc4', classification: 'best', cpLoss: 0 }),
      facts: clone(pawnFixture),
    });
    if (!events.computed) throw new Error('expected computed');
    const pawn = events.events.find((e) => e.topicId === 'pawn_structure_damage');
    expect(pawn?.action).not.toBe('worsened'); // not a causal-mistake claim
    expect(pawn?.proof.attribution).toBe('descriptive_only');
  });
});
