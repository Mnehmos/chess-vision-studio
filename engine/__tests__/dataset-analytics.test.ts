import { describe, it, expect } from 'vitest';
import {
  bucketForHour,
  gameStartDate,
  computeDatasetAnalysis,
  type AnalysisCache,
} from '../dataset-analytics';
import type { ParsedGame, PlyRecord } from '../position';
import type { MoveAnalysis } from '../types';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const mkAnalysis = (over: Partial<MoveAnalysis>): MoveAnalysis => ({
  positionBefore: '',
  positionAfter: '',
  move: '?',
  classification: 'good',
  evalBefore: { depth: 14, pv: [] },
  evalAfter: { depth: 14, pv: [] },
  cpLoss: 0,
  rankedInsights: [],
  topExplanation: '',
  ...over,
});

const mkPly = (ply: number, color: 'w' | 'b', san: string): PlyRecord => ({
  ply,
  moveNumber: Math.floor((ply - 1) / 2) + 1,
  san,
  color,
  from: '',
  to: '',
  fenBefore: '',
  fenAfter: '',
});

describe('bucketForHour', () => {
  it('maps hours to the right time-of-day key', () => {
    expect(bucketForHour(3).key).toBe('night');
    expect(bucketForHour(6).key).toBe('morning');
    expect(bucketForHour(13).key).toBe('afternoon');
    expect(bucketForHour(20).key).toBe('evening');
  });
});

describe('gameStartDate', () => {
  it('parses UTCDate + UTCTime into a Date', () => {
    const d = gameStartDate({ UTCDate: '2026.06.02', UTCTime: '20:12:16' });
    expect(d).not.toBeNull();
    expect(d!.getUTCHours()).toBe(20);
    expect(d!.getUTCMinutes()).toBe(12);
  });

  it('returns null for missing or malformed headers', () => {
    expect(gameStartDate({})).toBeNull();
    expect(gameStartDate({ UTCDate: '2026.06.02' })).toBeNull();
    expect(gameStartDate({ UTCDate: 'nope', UTCTime: '20:12:16' })).toBeNull();
  });
});

describe('computeDatasetAnalysis', () => {
  // g1: hero is White, played at 08:00 UTC → morning (assuming a UTC test runner).
  const g1: ParsedGame = {
    index: 0,
    headers: {
      White: 'Me',
      Black: 'Rival',
      Result: '1-0',
      UTCDate: '2026.06.02',
      UTCTime: '08:00:00',
    },
    initialFen: START_FEN,
    plies: [mkPly(1, 'w', 'e4'), mkPly(2, 'b', 'e5')],
    label: '#1  Me vs Rival · 1-0',
  };
  // g2: hero is Black.
  const g2: ParsedGame = {
    index: 1,
    headers: {
      White: 'Rival',
      Black: 'Me',
      Result: '0-1',
      UTCDate: '2026.06.02',
      UTCTime: '08:30:00',
    },
    initialFen: START_FEN,
    plies: [mkPly(1, 'w', 'd4'), mkPly(2, 'b', 'd5')],
    label: '#2  Rival vs Me · 0-1',
  };

  const cache: AnalysisCache = new Map([
    [
      'g0',
      new Map([
        [0, mkAnalysis({ move: 'e4', classification: 'best', cpLoss: 0 })],
        [1, mkAnalysis({ move: 'e5', classification: 'blunder', cpLoss: 3 })],
      ]),
    ],
    ['g1', new Map([[1, mkAnalysis({ move: 'd5', classification: 'inaccuracy', cpLoss: 1.5 })]])],
  ]);

  const keyOf = (g: ParsedGame) => `g${g.index}`;
  const res = computeDatasetAnalysis([g1, g2], cache, keyOf, 'Me');

  it('reports coverage counts', () => {
    expect(res.coverage.gamesTotal).toBe(2);
    expect(res.coverage.gamesAnalyzed).toBe(2);
    expect(res.coverage.pliesTotal).toBe(4);
    expect(res.coverage.pliesAnalyzed).toBe(3); // 2 from g1 + 1 from g2
    expect(res.coverage.gamesFull).toBe(1); // only g1 is fully analyzed (2/2)
  });

  it('computes overall analytics over every analyzed ply', () => {
    expect(res.overall.white.moves).toBe(1); // g1 ply0 (e4)
    expect(res.overall.black.moves).toBe(2); // g1 ply1 (e5) + g2 ply1 (d5)
  });

  it('collects worst teaching moments across the dataset', () => {
    expect(res.worst[0].cpLoss).toBe(3); // the blunder
    expect(res.worst[0].gameIndex).toBe(0);
    expect(res.worst[0].gameLabel).toContain('Me vs Rival');
  });

  it('always returns four time-of-day buckets in fixed order', () => {
    expect(res.timeOfDay).toHaveLength(4);
    expect(res.timeOfDay.map((b) => b.key)).toEqual([
      'morning',
      'afternoon',
      'evening',
      'night',
    ]);
  });

  it('places the games in the bucket matching their start hour', () => {
    const hour = gameStartDate(g1.headers)!.getHours();
    const key = bucketForHour(hour).key;
    const bucket = res.timeOfDay.find((b) => b.key === key)!;
    expect(bucket.games).toBeGreaterThanOrEqual(1);
    // Both games are hero games (win as White, win as Black) in the same bucket.
    expect(bucket.scorePct).not.toBeNull();
  });
});
