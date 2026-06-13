import { describe, expect, it } from 'vitest';
import type { TeachingEvent } from '../types';
import { buildTeachingProfile, classifyPhase, type TeachingSample } from '../profile';

function ev(overrides: Partial<TeachingEvent> = {}): TeachingEvent {
  return {
    id: 'x',
    topicId: 'allowed_fork',
    family: 'tactics',
    action: 'allowed',
    mechanism: 'fork',
    side: 'white',
    playedMove: 'e2e4',
    actors: [],
    targets: [],
    squares: ['a1'],
    consequence: { cpLoss: 2 },
    proof: { validators: [], evidence: [], attribution: 'proven_refutation', badge: 'engine_line' },
    saliency: 0.8,
    plan: { topic: 'Allowed Fork', headline: 'headline' },
    ...overrides,
  } as TeachingEvent;
}

const SAMPLES: TeachingSample[] = [
  {
    event: ev({ saliency: 0.9, consequence: { cpLoss: 5 }, squares: ['a1', 'b2'] }),
    gameKey: 'g1',
    ply: 5,
    phase: 'opening',
  },
  {
    event: ev({ saliency: 0.7, consequence: { cpLoss: 3 }, squares: ['a1'] }),
    gameKey: 'g1',
    ply: 25,
    phase: 'middlegame',
  },
  {
    event: ev({
      topicId: 'missed_hanging_piece',
      family: 'piece_safety',
      action: 'missed',
      side: 'black',
      saliency: 0.6,
      consequence: { cpLoss: 9 },
      squares: ['c4'],
    }),
    gameKey: 'g2',
    ply: 60,
    phase: 'endgame',
  },
];

describe('buildTeachingProfile', () => {
  const profile = buildTeachingProfile(SAMPLES);

  it('totals by color and phase', () => {
    expect(profile.total).toBe(3);
    expect(profile.byColor).toEqual({ white: 2, black: 1 });
    expect(profile.byPhase).toEqual({ opening: 1, middlegame: 1, endgame: 1 });
  });

  it('aggregates per-topic counts, averages, and allowed/missed split', () => {
    const fork = profile.byTopic.allowed_fork!;
    expect(fork.count).toBe(2);
    expect(fork.avgSeverity).toBe(0.8); // (0.9 + 0.7) / 2
    expect(fork.avgCpLoss).toBe(4); // (5 + 3) / 2
    expect(fork.allowed).toBe(2);
    expect(fork.missed).toBe(0);
    expect(fork.topSquares[0]).toBe('a1'); // a1 appears twice
    const missed = profile.byTopic.missed_hanging_piece!;
    expect(missed.count).toBe(1);
    expect(missed.missed).toBe(1);
  });

  it('aggregates by family', () => {
    expect(profile.byFamily.tactics?.count).toBe(2);
    expect(profile.byFamily.piece_safety?.count).toBe(1);
  });

  it('ranks worst examples by severity then cp loss', () => {
    expect(profile.worstExamples.map((e) => e.severity)).toEqual([0.9, 0.7, 0.6]);
    expect(profile.worstExamples[0]?.gameKey).toBe('g1');
    expect(profile.worstExamples[0]?.ply).toBe(5);
  });
});

describe('classifyPhase', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it('opens early with a full board', () => {
    expect(classifyPhase(5, start)).toBe('opening');
  });
  it('is middlegame later with a full board', () => {
    expect(classifyPhase(30, start)).toBe('middlegame');
  });
  it('is endgame when material is light regardless of ply', () => {
    expect(classifyPhase(8, 'k7/8/8/8/8/8/8/K6R w - - 0 1')).toBe('endgame');
  });
});
