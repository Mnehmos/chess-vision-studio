// Bridge to @cvs/engine's training schema. Every reviewed position becomes a
// "predict Stockfish's move" row: label = Stockfish's best (the teacher), played =
// what was actually played, cpLoss = the gap. buildTrainingPosition recomputes the
// engine's own feature block from the FEN, so the only thing crossing the boundary
// is strings (FEN + SAN). cpLoss is converted PAWNS → CENTIPAWNS (the engine's unit).
import { buildTrainingPosition } from '@cvs/engine';
import type { TrainingPosition } from '@cvs/engine';
import type { ReviewedPly } from './review';
import type { PlayoutPosition } from './disagree';

/** A reviewed ply → a labelled training row (label = Stockfish's best move). */
export function reviewedToTraining(
  r: ReviewedPly,
  source: TrainingPosition['source'] = 'bot_game',
): TrainingPosition | null {
  if (!r.sfBestSan) return null; // no oracle label → not usable
  return buildTrainingPosition(r.fenBefore, r.playedSan, {
    bestMove: r.sfBestSan,
    cpLoss: Math.round(r.cpLoss * 100), // pawns → centipawns
    classification: r.classification,
    source,
  });
}

/** A Stockfish-best-line position → a clean imitation row (played = best, cpLoss 0). */
export function playoutToTraining(
  p: PlayoutPosition,
  source: TrainingPosition['source'] = 'stockfish_selfplay',
): TrainingPosition {
  return buildTrainingPosition(p.fen, p.bestSan, {
    bestMove: p.bestSan,
    cpLoss: 0,
    source,
  });
}
