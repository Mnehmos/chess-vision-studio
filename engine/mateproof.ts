// Mate-proof explanation. The oracle (Stockfish, or the bounded mate solver) says
// "mate exists"; this layer turns the forcing LINE into OBLIGATION facts the UI
// (and later the LLM) can visualize: the mating piece, the checking line, the
// king's collapsing escape squares, the support piece. Pure.
import { Chess } from 'chess.js';
import { parseFen, attackersOf, pieceAt, fileOf, rankOf, toSquare, type Color } from './board';
import { describePieceId } from './relationship';
import type { MateProof } from './types';

const PIECE_NAMES: Record<string, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

/** Truncate a PV at the first mating move (…#) and build the obligation facts. */
export function buildMateProof(
  fen: string,
  pvSan: string[],
  mateInMoves: number,
): MateProof | null {
  const start = parseFen(fen);
  const matingSide: Color = start.turn;

  // Walk the line until the mating move; stop at the first '#'.
  const chess = new Chess(fen);
  const line: string[] = [];
  let mateMove: { san: string; to: string; piece: string; color: Color } | null = null;
  for (const san of pvSan) {
    let m;
    try {
      m = chess.move(san);
    } catch {
      break;
    }
    if (!m) break;
    line.push(m.san);
    if (m.san.includes('#')) {
      mateMove = { san: m.san, to: m.to, piece: m.piece, color: m.color as Color };
      break;
    }
  }
  if (!mateMove) return null; // PV did not actually reach mate

  // Position AT mate (after the final move): locate the mated king + the geometry.
  const matedBoard = parseFen(chess.fen());
  const enemy: Color = matingSide === 'w' ? 'b' : 'w';
  const kingSq = findKing(matedBoard, enemy);

  // King escape squares in the START position (before the forcing line begins).
  const kingEscapesAtStart = countKingEscapes(start, enemy);

  // The mating piece + how it checks (file / rank / diagonal / knight).
  const matingPiece = `${PIECE_NAMES[mateMove.piece] ?? 'Piece'} ${mateMove.to}`;
  const checkingLine = describeCheckLine(mateMove.piece, mateMove.to, kingSq);

  // Support: a friendly piece defending the mating square (the "second rook").
  const supporters = attackersOf(matedBoard, mateMove.to, matingSide);
  const support = supporters[0];
  const supportPiece = support
    ? describePieceId(`${matingSide}${pieceAt(matedBoard, support.square)!.type.toUpperCase()}${support.square}`).label
    : undefined;

  return {
    mateInMoves,
    matingSide: matingSide === 'w' ? 'white' : 'black',
    line,
    matingMove: mateMove.san,
    matingPiece,
    checkingLine,
    supportPiece,
    trappedKing: kingSq,
    kingEscapesAtStart,
  };
}

function findKing(board: ReturnType<typeof parseFen>, color: Color): string {
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (p && p.color === color && p.type === 'k') return toSquare(f, r);
    }
  return '';
}

/** Adjacent squares the king could flee to (empty/enemy and not enemy-controlled). */
function countKingEscapes(board: ReturnType<typeof parseFen>, kingColor: Color): number {
  const kingSq = findKing(board, kingColor);
  if (!kingSq) return 0;
  const enemy: Color = kingColor === 'w' ? 'b' : 'w';
  const kf = fileOf(kingSq);
  const kr = rankOf(kingSq);
  let escapes = 0;
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const f = kf + df;
      const r = kr + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const occ = board.grid[f][r];
      if (occ && occ.color === kingColor) continue; // own piece blocks
      const sq = toSquare(f, r);
      if (attackersOf(board, sq, enemy).length === 0) escapes++; // not covered → an escape
    }
  return escapes;
}

function describeCheckLine(piece: string, from: string, king: string): string {
  if (!king) return 'direct';
  if (piece === 'n') return 'knight check';
  if (piece === 'p') return 'pawn check';
  const sameFile = fileOf(from) === fileOf(king);
  const sameRank = rankOf(from) === rankOf(king);
  if (sameFile) return `${from[0]}-file`;
  if (sameRank) return `rank ${king[1]}`;
  return 'a diagonal';
}
