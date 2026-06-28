// Vendored cburnett SVG piece set (Lichess lila, GPL-compatible). Replaces the
// Unicode glyph fallbacks everywhere a piece is drawn so the board reads as a
// real chess set rather than font symbols. Keyed by the same `<color><TYPE>`
// codes the board already uses (e.g. "wK", "bP").
import wK from './assets/pieces/cburnett/wK.svg';
import wQ from './assets/pieces/cburnett/wQ.svg';
import wR from './assets/pieces/cburnett/wR.svg';
import wB from './assets/pieces/cburnett/wB.svg';
import wN from './assets/pieces/cburnett/wN.svg';
import wP from './assets/pieces/cburnett/wP.svg';
import bK from './assets/pieces/cburnett/bK.svg';
import bQ from './assets/pieces/cburnett/bQ.svg';
import bR from './assets/pieces/cburnett/bR.svg';
import bB from './assets/pieces/cburnett/bB.svg';
import bN from './assets/pieces/cburnett/bN.svg';
import bP from './assets/pieces/cburnett/bP.svg';

export type PieceCode =
  | 'wK' | 'wQ' | 'wR' | 'wB' | 'wN' | 'wP'
  | 'bK' | 'bQ' | 'bR' | 'bB' | 'bN' | 'bP';

export const PIECE_SVG: Record<PieceCode, string> = {
  wK, wQ, wR, wB, wN, wP,
  bK, bQ, bR, bB, bN, bP,
};

const PIECE_NAME: Record<string, string> = {
  K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn',
};

/** Source URL for a piece given `color` ('w'|'b') and `type` (any case). */
export function pieceSvg(color: 'w' | 'b', type: string): string {
  return PIECE_SVG[(color + type.toUpperCase()) as PieceCode];
}

/** Accessible label, e.g. "white knight". */
export function pieceLabel(color: 'w' | 'b', type: string): string {
  return `${color === 'w' ? 'white' : 'black'} ${PIECE_NAME[type.toUpperCase()] ?? type}`;
}
