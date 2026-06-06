// [4] SEE module — Static Exchange Evaluation on a single square. PURE.
// Highest test bar in the project (Invariant 3): "attacked & undefended" is
// WRONG. A piece is losing material iff SEE on its square is negative for its
// owner. Two rooks aimed at a pawn-defended knight is SAFE — the attackers are
// too expensive. SEE knows this; counting doesn't.
import {
  parseFen,
  pieceAt,
  attackersOf,
  type Board,
  type Color,
  type PieceType,
} from './board';
import type { SEEResult, Square } from './types';

/** Material values in pawns. King is effectively infinite for exchange logic. */
export const PIECE_VALUE: Record<PieceType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 1000,
};

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/**
 * Least valuable attacker of `target` for `side`, honoring the `ignore` set
 * (captured/moved pieces) so x-ray sliders behind a peeled attacker are
 * revealed. A king is returned only when capturing is legal — i.e. the square
 * is no longer defended by the opponent (otherwise the king would move into
 * check, an illegal capture).
 */
function leastValuableAttacker(
  board: Board,
  target: string,
  side: Color,
  ignore: Set<string>,
): { square: string; type: PieceType } | null {
  const attackers = attackersOf(board, target, side, ignore);
  if (attackers.length === 0) return null;
  let best = attackers[0];
  for (const a of attackers) {
    if (PIECE_VALUE[a.type] < PIECE_VALUE[best.type]) best = a;
  }
  if (best.type === 'k') {
    // The king can only capture if the opponent cannot recapture.
    const defenders = attackersOf(board, target, other(side), ignore);
    if (defenders.length > 0) return null;
  }
  return { square: best.square, type: best.type };
}

/**
 * Material the `side` to capture can guarantee by initiating a capture sequence
 * on `target` whose current occupant is worth `occupantValue`. Each side may
 * stop (stand pat) when continuing the exchange is unfavorable — hence the
 * Math.max(0, …): a rational side never plays a capture that loses material.
 */
function seeRec(
  board: Board,
  target: string,
  side: Color,
  occupantValue: number,
  ignore: Set<string>,
): number {
  const lva = leastValuableAttacker(board, target, side, ignore);
  if (!lva) return 0;
  ignore.add(lva.square); // the attacker moves onto `target`
  const gain = occupantValue - seeRec(board, target, other(side), PIECE_VALUE[lva.type], ignore);
  ignore.delete(lva.square); // backtrack
  return Math.max(0, gain);
}

/**
 * SEE on the piece standing on `square`. Returns the material the OWNER stands
 * to lose if the opponent initiates optimal captures.
 *   swing > 0  → capturing side wins material (the piece is losing material)
 *   swing == 0 → safe for the owner (no profitable capture exists)
 */
export function seeOnSquare(fen: string, square: Square): SEEResult {
  const board = parseFen(fen);
  return seeOnSquareBoard(board, square);
}

export function seeOnSquareBoard(board: Board, square: Square): SEEResult {
  const victim = pieceAt(board, square);
  if (!victim) {
    return { square, swing: 0, losingSideToMove: false };
  }
  const attackerColor = other(victim.color);
  const swing = seeRec(board, square, attackerColor, PIECE_VALUE[victim.type], new Set());
  return { square, swing, losingSideToMove: swing > 0 };
}

/**
 * SEE for a specific capturing move from→to. Returns the material the moving
 * side nets (the captured piece, minus whatever the exchange on `to` costs
 * afterwards). Negative means the capture loses material. Used by the diff /
 * motif / saliency layers to score a refutation capture or a fork's payoff.
 */
export function seeCapture(fen: string, from: Square, to: Square): number {
  const board = parseFen(fen);
  const mover = pieceAt(board, from);
  const captured = pieceAt(board, to);
  if (!mover) return 0;
  const capturedValue = captured ? PIECE_VALUE[captured.type] : 0;
  const ignore = new Set<string>([from]); // mover leaves `from`, now sits on `to`
  // After the capture, the opponent may recapture on `to`; the mover's piece
  // (value PIECE_VALUE[mover.type]) is what's at risk.
  const loss = seeRec(board, to, other(mover.color), PIECE_VALUE[mover.type], ignore);
  return capturedValue - loss;
}
