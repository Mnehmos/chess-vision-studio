// [1] Position layer — chess.js wrapper → PositionState.
// Pure: legality, FEN/PGN, history, legal move generation.
import { Chess } from 'chess.js';
import type { PositionState } from './types';

export function positionFromFen(fen: string): PositionState {
  const chess = new Chess(fen);
  return {
    fen: chess.fen(),
    sideToMove: chess.turn(),
    moveNumber: chess.moveNumber(),
    legalMoves: chess.moves(),
  };
}

/** Parse a PGN into the sequence of half-moves (SAN) and the FEN before each. */
export interface PlyRecord {
  ply: number; // 1-based half-move index
  moveNumber: number; // full-move number
  san: string;
  color: 'w' | 'b';
  from: string; // origin square of the move
  to: string; // destination square (the piece that just moved lands here)
  fenBefore: string;
  fenAfter: string;
}

export function pliesFromPgn(pgn: string): PlyRecord[] {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  // Replay to capture before/after FENs for each ply.
  const replay = new Chess();
  const records: PlyRecord[] = [];
  history.forEach((move, i) => {
    const fenBefore = replay.fen();
    replay.move(move.san);
    records.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      san: move.san,
      color: move.color,
      from: move.from,
      to: move.to,
      fenBefore,
      fenAfter: replay.fen(),
    });
  });
  return records;
}
