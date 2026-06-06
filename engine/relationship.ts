// Per-square relationship report — the data behind the "relationship card".
// Turns raw PieceIds into human names (Bishop f4, not wBf4) and derives a single
// status label. Pure + testable; the FactsPanel just renders it.
import { buildRelationMap } from './relations';
import { seeOnSquare } from './see';
import { parseFen, pieceAt } from './board';
import type { Square } from './types';

const PIECE_NAMES: Record<string, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

export interface NamedPiece {
  label: string; // 'Bishop f4'
  name: string; // 'Bishop'
  square: Square;
  color: 'white' | 'black';
}

/** 'wBf4' → { label: 'Bishop f4', name: 'Bishop', square: 'f4', color: 'white' }. */
export function describePieceId(id: string): NamedPiece {
  const color = id[0] === 'w' ? 'white' : 'black';
  const name = PIECE_NAMES[id[1]?.toLowerCase()] ?? 'Piece';
  const square = id.slice(2);
  return { label: `${name} ${square}`, name, square, color };
}

export type SquareStatus =
  | 'empty'
  | 'hanging' // SEE-losing for its owner
  | 'defended_target' // attacked but defended (holds)
  | 'loose' // attacked, undefended, but SEE-safe (attacker too costly)
  | 'defended' // defended, not attacked
  | 'undefended'; // no attackers, no defenders

export interface SquareReport {
  square: Square;
  occupied: boolean;
  piece?: string; // 'bP'
  pieceName?: string; // 'Pawn'
  color?: 'white' | 'black';
  attackedBy: NamedPiece[];
  defendedBy: NamedPiece[];
  see: number; // swing in pawns; >0 = losing material
  safe: boolean;
  status: SquareStatus;
  statusLabel: string;
}

export function squareReport(fen: string, square: Square): SquareReport {
  const board = parseFen(fen);
  const p = pieceAt(board, square);
  if (!p) {
    return {
      square,
      occupied: false,
      attackedBy: [],
      defendedBy: [],
      see: 0,
      safe: true,
      status: 'empty',
      statusLabel: 'empty square',
    };
  }
  const rel = buildRelationMap(fen).bySquare[square];
  const see = seeOnSquare(fen, square).swing;
  const attackedBy = rel.attackedBy.map(describePieceId);
  const defendedBy = rel.defendedBy.map(describePieceId);
  const attacked = attackedBy.length > 0;
  const defended = defendedBy.length > 0;

  let status: SquareStatus;
  let statusLabel: string;
  if (see > 0) {
    status = 'hanging';
    statusLabel = `hanging — losing ${see}`;
  } else if (attacked && defended) {
    status = 'defended_target';
    statusLabel = 'defended target';
  } else if (attacked && !defended) {
    status = 'loose';
    statusLabel = 'loose — attacked but safe';
  } else if (defended) {
    status = 'defended';
    statusLabel = 'defended piece';
  } else {
    status = 'undefended';
    statusLabel = 'undefended';
  }

  return {
    square,
    occupied: true,
    piece: p.color + p.type.toUpperCase(),
    pieceName: PIECE_NAMES[p.type],
    color: p.color === 'w' ? 'white' : 'black',
    attackedBy,
    defendedBy,
    see,
    safe: see <= 0,
    status,
    statusLabel,
  };
}
