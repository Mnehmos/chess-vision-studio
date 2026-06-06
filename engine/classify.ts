// [3] Centipawn-loss + classification (§5 Step A). The eval sign discipline is
// the whole game here: Stockfish reports from the SIDE-TO-MOVE's POV, and the
// side to move flips between positionBefore and positionAfter.
import type { Classification, Eval } from './types';
import { UciEngine } from './evaluation';
import { Chess } from 'chess.js';

/** Mate scores map to a large sentinel BEFORE any arithmetic (§5 Step A). */
const MATE_SENTINEL = 100; // pawns

/** Signed evaluation in pawns, from the POV of the side to move at that node. */
export function evalToPawns(e: Eval): number {
  if (e.mate !== undefined && e.mate !== 0) {
    const sign = e.mate > 0 ? 1 : -1;
    // Closer mates are bigger: |mate in 1| > |mate in 5|.
    return sign * (MATE_SENTINEL - Math.min(Math.abs(e.mate), MATE_SENTINEL - 1));
  }
  return (e.cp ?? 0) / 100;
}

/**
 * Centipawn loss in PAWNS for the move that led from `evalBefore`'s node to
 * `evalAfter`'s node, where:
 *   - evalBefore = best-move eval at positionBefore (already from mover S's POV)
 *   - evalAfter  = eval at positionAfter (reported from the OPPONENT's POV)
 * eval_after_from_S = −evalAfter, so
 *   cpLoss = evalBest − eval_after_from_S = evalBestPawns + evalAfterPawns.
 * Clamped at ≥0 (a played move cannot beat the engine's best; small negatives
 * are search noise).
 */
export function computeCpLoss(evalBefore: Eval, evalAfter: Eval): number {
  const best = evalToPawns(evalBefore);
  const afterFromOpponent = evalToPawns(evalAfter);
  return Math.max(0, best + afterFromOpponent);
}

/** Classification thresholds (§5), in pawns of loss. */
export function classify(cpLoss: number): Classification {
  if (cpLoss < 0.1) return 'best';
  if (cpLoss < 0.3) return 'excellent';
  if (cpLoss < 0.6) return 'good';
  if (cpLoss < 1.2) return 'inaccuracy';
  if (cpLoss < 2.5) return 'mistake';
  return 'blunder';
}

export interface MoveGrade {
  evalBefore: Eval; // best-move eval at positionBefore
  evalAfter: Eval; // eval at positionAfter (opponent's POV)
  cpLoss: number;
  classification: Classification;
}

/**
 * Engine-driven grading of a single SAN move at FIXED depth. Plays `san` from
 * `fenBefore`, evaluates both nodes, and applies the sign-correct cpLoss.
 */
export async function gradeMove(
  engine: UciEngine,
  fenBefore: string,
  san: string,
  depth: number,
): Promise<MoveGrade & { fenAfter: string }> {
  const chess = new Chess(fenBefore);
  const move = chess.move(san);
  if (!move) throw new Error(`illegal move ${san} in ${fenBefore}`);
  const fenAfter = chess.fen();

  const evalBefore = await engine.evaluate({ fen: fenBefore, depth });
  const evalAfter = await engine.evaluate({ fen: fenAfter, depth });
  const cpLoss = computeCpLoss(evalBefore, evalAfter);
  return {
    evalBefore,
    evalAfter,
    cpLoss,
    classification: classify(cpLoss),
    fenAfter,
  };
}
