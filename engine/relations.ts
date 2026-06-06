// [2] Relation layer — per-square attacker/defender maps for ONE position.
// Pure. Derived from attack geometry (board.ts), not legal-move generation,
// so defenders (friendly guards) and king-defended squares appear correctly.
import {
  parseFen,
  allPieces,
  attackersOf,
  toSquare,
  type Board,
  type BoardPiece,
  type Color,
} from './board';
import type { PieceId, PieceRelation, RelationMap, Square } from './types';

/** Canonical PieceId: color + UPPER type + current square, e.g. 'wNf3'. */
export function pieceIdOf(p: BoardPiece): PieceId {
  return p.color + p.type.toUpperCase() + p.square;
}

/** Short piece label used by PieceRelation.piece, e.g. 'wN'. */
export function pieceLabelOf(p: BoardPiece): string {
  return p.color + p.type.toUpperCase();
}

export function buildRelationMap(fen: string): RelationMap {
  const board = parseFen(fen);
  const bySquare: Record<Square, PieceRelation> = {};

  for (const piece of allPieces(board)) {
    const enemy: Color = piece.color === 'w' ? 'b' : 'w';
    const attackers = attackersOf(board, piece.square, enemy).map((a) =>
      pieceIdAt(board, a.square),
    );
    const defenders = attackersOf(board, piece.square, piece.color).map((a) =>
      pieceIdAt(board, a.square),
    );
    bySquare[piece.square] = {
      square: piece.square,
      piece: pieceLabelOf(piece),
      attackedBy: attackers.sort(),
      defendedBy: defenders.sort(),
    };
  }

  const controlledByWhite: Square[] = [];
  const controlledByBlack: Square[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = toSquare(f, r);
      if (attackersOf(board, sq, 'w').length > 0) controlledByWhite.push(sq);
      if (attackersOf(board, sq, 'b').length > 0) controlledByBlack.push(sq);
    }
  }

  return { bySquare, controlledByWhite, controlledByBlack };
}

function pieceIdAt(board: Board, square: string): PieceId {
  const p = board.grid[square.charCodeAt(0) - 97][square.charCodeAt(1) - 49]!;
  return pieceIdOf(p);
}
