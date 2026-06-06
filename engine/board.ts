// Shared board model + attack geometry. Pure, no chess.js dependency for the
// hot path — relations.ts and see.ts both build on this. Geometry (not move
// generation) is used so we can see DEFENDERS (a piece guarding its own man)
// and cast x-ray rays for SEE, neither of which normal legal-move generation
// exposes.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface BoardPiece {
  color: Color;
  type: PieceType;
  square: string; // 'e4'
}

export interface Board {
  // file (0=a..7=h), rank (0=rank1..7=rank8) → piece or null
  grid: (BoardPiece | null)[][];
  turn: Color;
}

export function fileOf(square: string): number {
  return square.charCodeAt(0) - 97; // 'a' -> 0
}
export function rankOf(square: string): number {
  return square.charCodeAt(1) - 49; // '1' -> 0
}
export function toSquare(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + String.fromCharCode(49 + rank);
}
export function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

/** Parse the piece-placement + active-color fields of a FEN into a Board. */
export function parseFen(fen: string): Board {
  const [placement, turn] = fen.trim().split(/\s+/);
  const grid: (BoardPiece | null)[][] = Array.from({ length: 8 }, () =>
    Array<BoardPiece | null>(8).fill(null),
  );
  const ranks = placement.split('/'); // ranks[0] = rank 8
  for (let r = 0; r < 8; r++) {
    const rankStr = ranks[r];
    const rankIdx = 7 - r; // FEN lists rank 8 first
    let file = 0;
    for (const ch of rankStr) {
      if (ch >= '1' && ch <= '8') {
        file += parseInt(ch, 10);
      } else {
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toLowerCase() as PieceType;
        grid[file][rankIdx] = { color, type, square: toSquare(file, rankIdx) };
        file++;
      }
    }
  }
  return { grid, turn: (turn as Color) ?? 'w' };
}

export function pieceAt(board: Board, square: string): BoardPiece | null {
  return board.grid[fileOf(square)][rankOf(square)];
}

const KNIGHT_OFFSETS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_OFFSETS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const BISHOP_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface Attacker {
  square: string;
  type: PieceType;
  color: Color;
}

/**
 * All pieces of `byColor` that attack `target` (directly — no x-ray).
 * "Attack" = could capture a piece standing on `target`; for pawns this is the
 * diagonal capture squares only, never the push.
 *
 * @param ignore squares to treat as EMPTY (used by SEE to peel attackers off and
 *               reveal x-ray sliders behind them).
 */
export function attackersOf(
  board: Board,
  target: string,
  byColor: Color,
  ignore: Set<string> = new Set(),
): Attacker[] {
  const tf = fileOf(target);
  const tr = rankOf(target);
  const result: Attacker[] = [];
  const occupied = (f: number, r: number): BoardPiece | null => {
    const sq = toSquare(f, r);
    if (ignore.has(sq)) return null;
    return board.grid[f][r];
  };

  // Pawns: a `byColor` pawn attacks `target` if it sits one rank "behind"
  // (relative to its march direction) on an adjacent file.
  const pawnRank = byColor === 'w' ? tr - 1 : tr + 1; // where such a pawn would stand
  for (const df of [-1, 1]) {
    const pf = tf + df;
    if (onBoard(pf, pawnRank)) {
      const p = occupied(pf, pawnRank);
      if (p && p.color === byColor && p.type === 'p') {
        result.push({ square: p.square, type: 'p', color: byColor });
      }
    }
  }

  // Knights
  for (const [df, dr] of KNIGHT_OFFSETS) {
    const f = tf + df;
    const r = tr + dr;
    if (onBoard(f, r)) {
      const p = occupied(f, r);
      if (p && p.color === byColor && p.type === 'n') {
        result.push({ square: p.square, type: 'n', color: byColor });
      }
    }
  }

  // King
  for (const [df, dr] of KING_OFFSETS) {
    const f = tf + df;
    const r = tr + dr;
    if (onBoard(f, r)) {
      const p = occupied(f, r);
      if (p && p.color === byColor && p.type === 'k') {
        result.push({ square: p.square, type: 'k', color: byColor });
      }
    }
  }

  // Sliders: bishop/queen on diagonals, rook/queen on orthogonals.
  const scanRay = (dirs: number[][], sliders: PieceType[]) => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      while (onBoard(f, r)) {
        const p = occupied(f, r);
        if (p) {
          if (p.color === byColor && sliders.includes(p.type)) {
            result.push({ square: p.square, type: p.type, color: byColor });
          }
          break; // first blocker stops the ray (x-ray handled via `ignore`)
        }
        f += df;
        r += dr;
      }
    }
  };
  scanRay(BISHOP_DIRS, ['b', 'q']);
  scanRay(ROOK_DIRS, ['r', 'q']);

  return result;
}

export function allPieces(board: Board): BoardPiece[] {
  const out: BoardPiece[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (p) out.push(p);
    }
  }
  return out;
}
