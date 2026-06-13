import { describe, expect, it } from 'vitest';
import allowedForkFixture from '../../../fixtures/teaching-facts/v1/allowed-fork.json';
import missedFixture from '../../../fixtures/teaching-facts/v1/missed-hanging-piece.json';
import pawnFixture from '../../../fixtures/teaching-facts/v1/pawn-structure-damage.json';
import type { MoveAnalysis } from '../../types';
import type { TeachingEvent, TeachingFactBundleV1 } from '../types';
import { compileTeachingEvents } from '../compile';
import {
  buildTeachingPuzzle,
  candidateLossFromBest,
  isAlternativePuzzleSolution,
  isPuzzleSolution,
  type PuzzleStage,
} from '../puzzle';

function analysis(over: Partial<MoveAnalysis>): MoveAnalysis {
  return {
    positionBefore: '',
    positionAfter: '',
    move: '',
    classification: 'blunder',
    evalBefore: { cp: 0, depth: 12, pv: [] },
    evalAfter: { cp: 0, depth: 12, pv: [] },
    cpLoss: 5,
    rankedInsights: [],
    topExplanation: '',
    ...over,
  } as unknown as MoveAnalysis;
}

function primary(facts: TeachingFactBundleV1, a: MoveAnalysis): TeachingEvent {
  const result = compileTeachingEvents({ analysis: a, facts });
  if (!result.computed || !result.primaryEvent) throw new Error('no committed event');
  return result.primaryEvent;
}

describe('buildTeachingPuzzle', () => {
  it('builds a two-stage puzzle for an allowed fork', () => {
    const facts = allowedForkFixture as unknown as TeachingFactBundleV1;
    const event = primary(
      facts,
      analysis({ move: 'e4', evalBefore: { cp: 0, depth: 14, pv: ['Kh1'] } }),
    );
    const puzzle = buildTeachingPuzzle(event, facts);
    expect(puzzle).not.toBeNull();
    if (!puzzle) return;
    expect(puzzle.topicId).toBe('allowed_fork');
    expect(puzzle.stages).toHaveLength(2);

    const punish = puzzle.stages[0];
    expect(punish.kind).toBe('punishment');
    expect(punish.fen).toBe(facts.played.fenAfter);
    expect(punish.sideToMove).toBe('black');
    expect(punish.solutionUci).toBe('g5f3');
    expect(punish.prompt).toContain('Find the punishment');

    const prevent = puzzle.stages[1];
    expect(prevent.kind).toBe('prevention');
    expect(prevent.fen).toBe(facts.fenBefore);
    expect(prevent.sideToMove).toBe('white');
    expect(prevent.solutionUci).toBe('g1h1');
    expect(prevent.prompt).toContain('avoids the fork');
    expect(prevent.requiredAvoidedFacts).toEqual(event.correction?.avoidedFacts);
  });

  it('builds a find-the-capture stage for a missed hanging piece', () => {
    const facts = missedFixture as unknown as TeachingFactBundleV1;
    const event = primary(
      facts,
      analysis({ move: 'Kf1', evalBefore: { cp: 0, depth: 14, pv: ['Rxe4'] } }),
    );
    const puzzle = buildTeachingPuzzle(event, facts);
    expect(puzzle).not.toBeNull();
    if (!puzzle) return;
    expect(puzzle.topicId).toBe('missed_hanging_piece');
    expect(puzzle.stages).toHaveLength(1);
    expect(puzzle.stages[0].kind).toBe('prevention');
    expect(puzzle.stages[0].fen).toBe(facts.fenBefore);
    expect(puzzle.stages[0].solutionUci).toBe('f3e5');
    expect(puzzle.stages[0].prompt).toContain('wins the free piece');
  });

  it('returns null when the event has neither punishment nor correction', () => {
    const facts = pawnFixture as unknown as TeachingFactBundleV1;
    const bare = {
      topicId: 'pawn_structure_damage',
      side: 'white',
      action: 'created',
    } as unknown as TeachingEvent;
    expect(buildTeachingPuzzle(bare, facts)).toBeNull();
  });
});

describe('isPuzzleSolution', () => {
  const stage: PuzzleStage = {
    kind: 'punishment',
    fen: '6k1/8/8/6n1/4P3/8/8/4R1K1 b - - 0 1',
    sideToMove: 'black',
    prompt: 'Find the punishment.',
    solutionUci: 'g5f3',
    acceptableUci: ['g5f3'],
    requiredAvoidedFacts: [],
  };

  it('accepts the solution move and rejects others', () => {
    expect(isPuzzleSolution(stage, 'g5f3')).toBe(true);
    expect(isPuzzleSolution(stage, 'g5e4')).toBe(false);
  });

  it('matches a promotion solution from a bare from-to drop', () => {
    const promo: PuzzleStage = { ...stage, solutionUci: 'e7e8q', acceptableUci: ['e7e8q'] };
    expect(isPuzzleSolution(promo, 'e7e8')).toBe(true);
  });
});

describe('isAlternativePuzzleSolution', () => {
  it('accepts a prevention that removes the committed fact within tolerance', () => {
    const facts = allowedForkFixture as unknown as TeachingFactBundleV1;
    const event = primary(
      facts,
      analysis({ move: 'Re1', evalBefore: { cp: 20, depth: 14, pv: ['Kh1'] } }),
    );
    const puzzle = buildTeachingPuzzle(event, facts);
    const stage = puzzle?.stages.find((candidate) => candidate.kind === 'prevention');
    expect(stage).toBeDefined();
    if (!stage) return;

    const candidateFacts = structuredClone(facts.played);
    candidateFacts.move.uci = 'g1f1';
    candidateFacts.position.availableMotifs = { status: 'computed', items: [] };

    expect(
      isAlternativePuzzleSolution(
        stage,
        'g1f1',
        candidateFacts,
        { cp: 20, depth: 14, pv: [] },
        { cp: -10, depth: 14, pv: [] },
      ),
    ).toBe(true);

    candidateFacts.position.availableMotifs = structuredClone(
      facts.played.position.availableMotifs,
    );
    expect(
      isAlternativePuzzleSolution(
        stage,
        'g1f1',
        candidateFacts,
        { cp: 20, depth: 14, pv: [] },
        { cp: -10, depth: 14, pv: [] },
      ),
    ).toBe(false);
  });

  it('normalizes the post-move opponent evaluation and rejects unavailable scores', () => {
    expect(
      candidateLossFromBest(
        { cp: 20, depth: 14, pv: [] },
        { cp: -10, depth: 14, pv: [] },
      ),
    ).toBe(10);
    expect(
      candidateLossFromBest(
        { cp: 20, depth: 14, pv: [] },
        { cp: 80, depth: 14, pv: [] },
      ),
    ).toBe(100);
    expect(
      candidateLossFromBest(
        { cp: 20, depth: 14, pv: [] },
        { depth: 14, pv: [], status: 'unavailable' },
      ),
    ).toBeNull();
  });
});
