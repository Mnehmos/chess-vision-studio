import { describe, expect, it } from 'vitest';
import {
  applyReviewAnalysis,
  buildReviewMoment,
  predictionBreakInsight,
  type ReviewMoment,
} from './play-mode-review';
import type { AlternativeLine } from './arrow-analysis-store';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const ALT: AlternativeLine = {
  id: 'alt-1',
  rootFen: START_FEN,
  moves: [
    {
      uci: 'e2e4',
      san: 'e4',
      from: 'e2',
      to: 'e4',
      fenBefore: START_FEN,
      fenAfter: AFTER_E4,
    },
  ],
  isAnalyzing: false,
  scoreCp: 120,
  mate: null,
  pv: ['e2e4', 'e7e5'],
  depth: 12,
  teachingNodes: [],
  pinned: false,
  revealed: false,
};

describe('play mode review helpers', () => {
  it('creates immutable review moments from broken predicted lines', () => {
    const moment = buildReviewMoment({
      ply: 4,
      playedMoveUci: 'd2d4',
      playedMoveSan: 'd4',
      brokenAlt: ALT,
      fenBefore: START_FEN,
      nowMs: 123,
    });

    expect(moment).toMatchObject({
      id: 'rev-123-d2d4',
      ply: 4,
      playedMove: 'd2d4',
      playedMoveSan: 'd4',
      insight: 'Analyzing break at ply 5...',
      predictedLine: { scoreCp: 120, mate: null, pv: ['e2e4', 'e7e5'] },
    });
    expect(moment.predictedLine.moves).not.toBe(ALT.moves);
    expect(moment.predictedLine.pv).not.toBe(ALT.pv);
  });

  it('scores prediction breaks from the mover perspective', () => {
    expect(
      predictionBreakInsight({
        fenBefore: START_FEN,
        playedMoveSan: 'd4',
        predictedMoveSan: 'e4',
        playedScore: -80,
        predictedScore: 120,
      }),
    ).toBe('Blunder! You played d4 but predicted e4. This dropped the evaluation by 2.00 pawns.');

    expect(
      predictionBreakInsight({
        fenBefore: AFTER_E4,
        playedMoveSan: 'c5',
        predictedMoveSan: 'e5',
        playedScore: 140,
        predictedScore: -20,
      }),
    ).toBe('Blunder! You played c5 but predicted e5. This dropped the evaluation by 1.60 pawns.');
  });

  it('updates only the analyzed review moment', () => {
    const moments: ReviewMoment[] = [
      buildReviewMoment({ ply: 0, playedMoveUci: 'a2a3', playedMoveSan: 'a3', brokenAlt: ALT, fenBefore: START_FEN, nowMs: 1 }),
      buildReviewMoment({ ply: 1, playedMoveUci: 'h7h6', playedMoveSan: 'h6', brokenAlt: ALT, fenBefore: AFTER_E4, nowMs: 2 }),
    ];

    expect(applyReviewAnalysis(moments, 'rev-2-h7h6', { scoreCp: -50, mate: null }, 'Comparable')).toEqual([
      moments[0],
      { ...moments[1], insight: 'Comparable', playedScore: -50, playedMate: null },
    ]);
  });
});
