import { Chess } from 'chess.js';
import type { AlternativeLine, AlternativeLineMove } from './arrow-analysis-store';

export interface ReviewMoment {
  id: string;
  ply: number;
  fenBefore: string;
  playedMove: string;
  playedMoveSan: string;
  predictedLine: {
    moves: AlternativeLineMove[];
    scoreCp: number;
    mate: number | null;
    pv: string[];
  };
  insight: string;
  playedScore?: number;
  playedMate?: number | null;
}

export interface BuildReviewMomentInput {
  ply: number;
  playedMoveUci: string;
  playedMoveSan: string;
  brokenAlt: AlternativeLine;
  fenBefore: string;
  nowMs: number;
}

export interface PredictionBreakInsightInput {
  fenBefore: string;
  playedMoveSan: string;
  predictedMoveSan: string;
  playedScore: number;
  predictedScore: number;
}

export interface ReviewAnalysisResult {
  scoreCp: number;
  mate?: number | null;
}

export function buildReviewMoment(input: BuildReviewMomentInput): ReviewMoment {
  return {
    id: `rev-${input.nowMs}-${input.playedMoveUci}`,
    ply: input.ply,
    fenBefore: input.fenBefore,
    playedMove: input.playedMoveUci,
    playedMoveSan: input.playedMoveSan,
    predictedLine: {
      moves: [...input.brokenAlt.moves],
      scoreCp: input.brokenAlt.scoreCp,
      mate: input.brokenAlt.mate,
      pv: [...input.brokenAlt.pv],
    },
    insight: `Analyzing break at ply ${input.ply + 1}...`,
  };
}

export function predictionBreakInsight(input: PredictionBreakInsightInput): string {
  const mover = new Chess(input.fenBefore).turn() === 'w' ? 1 : -1;
  const diff = ((input.playedScore - input.predictedScore) * mover) / 100;

  if (diff < -1.5) {
    return `Blunder! You played ${input.playedMoveSan} but predicted ${input.predictedMoveSan}. This dropped the evaluation by ${Math.abs(diff).toFixed(2)} pawns.`;
  }
  if (diff < -0.5) {
    return `Mistake. Played ${input.playedMoveSan} instead of predicted ${input.predictedMoveSan}, losing ${Math.abs(diff).toFixed(2)} pawns.`;
  }
  if (diff > 0.5) {
    return `Nice find! Played ${input.playedMoveSan} is better than predicted ${input.predictedMoveSan} by ${diff.toFixed(2)} pawns.`;
  }
  return `Played ${input.playedMoveSan} is comparable to your predicted ${input.predictedMoveSan} (diff: ${diff.toFixed(2)} pawns).`;
}

export function applyReviewAnalysis(
  moments: readonly ReviewMoment[],
  momentId: string,
  analysis: ReviewAnalysisResult,
  insight: string,
): ReviewMoment[] {
  return moments.map((m) =>
    m.id === momentId ? { ...m, insight, playedScore: analysis.scoreCp, playedMate: analysis.mate } : m,
  );
}
