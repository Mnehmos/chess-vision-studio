// Relational threat detectors — the "obligation layer" facts the coach narrates,
// the kind chess.com's eval hides:
//   • threatened pieces — a man losing material by SEE (the other side threatens it)
//   • shields           — a friendly piece blocking an enemy slider's line to another
//                         friendly piece (it SHIELDS the man behind it)
// Both PURE and VALIDATED (Static Exchange / pure geometry) — never an invented tactic.
import {
  parseFen,
  allPieces,
  fileOf,
  rankOf,
  onBoard,
  type Color,
  type PieceType,
} from './board';
import { seeOnSquareBoard, PIECE_VALUE } from './see';

const PIECE_NAME: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const sideName = (c: Color): string => (c === 'w' ? 'White' : 'Black');

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

// ── threatened pieces ─────────────────────────────────────────────────────────
export interface ThreatenedPiece {
  square: string;
  piece: PieceType;
  owner: Color;
  threatenedBy: Color; // the side that wins material
  gain: number; // pawns won (SEE swing)
}

/** Every piece currently losing material by SEE — the other side threatens to win it.
 *  Turn-independent (a standing threat), validated by Static Exchange (Invariant 3). */
export function findThreatenedPieces(fen: string): ThreatenedPiece[] {
  const board = parseFen(fen);
  const out: ThreatenedPiece[] = [];
  for (const p of allPieces(board)) {
    if (p.type === 'k') continue; // a king is "in check", not "won"
    const swing = seeOnSquareBoard(board, p.square).swing;
    if (swing > 0) {
      out.push({ square: p.square, piece: p.type, owner: p.color, threatenedBy: other(p.color), gain: swing });
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

// ── shields (defends-by-blocking) ─────────────────────────────────────────────
export interface Shield {
  blocker: string;
  blockerPiece: PieceType;
  shielded: string;
  shieldedPiece: PieceType;
  attacker: string;
  attackerPiece: PieceType;
  side: Color; // owner of the blocker + shielded man
}

/** A friendly piece interposed on an enemy slider's ray toward another friendly piece:
 *  the blocker SHIELDS the man behind it from that slider. Pure geometry — exactly
 *  the relation DecodeChess phrases as "shields c5 from the bishop's attack". */
export function findShields(fen: string): Shield[] {
  const board = parseFen(fen);
  const out: Shield[] = [];
  for (const slider of allPieces(board)) {
    const dirs =
      slider.type === 'b'
        ? BISHOP_DIRS
        : slider.type === 'r'
          ? ROOK_DIRS
          : slider.type === 'q'
            ? [...BISHOP_DIRS, ...ROOK_DIRS]
            : null;
    if (!dirs) continue;
    const defender = other(slider.color); // the shielded side
    for (const [df, dr] of dirs) {
      let f = fileOf(slider.square) + df;
      let r = rankOf(slider.square) + dr;
      // first piece on the ray = the potential blocker
      while (onBoard(f, r) && !board.grid[f][r]) {
        f += df;
        r += dr;
      }
      if (!onBoard(f, r)) continue;
      const blocker = board.grid[f][r]!;
      if (blocker.color !== defender) continue; // must be a defender's man to shield
      // next piece on the ray = the man being shielded
      f += df;
      r += dr;
      while (onBoard(f, r) && !board.grid[f][r]) {
        f += df;
        r += dr;
      }
      if (!onBoard(f, r)) continue;
      const shielded = board.grid[f][r]!;
      if (shielded.color !== defender) continue; // a shield protects a friendly man
      out.push({
        blocker: blocker.square,
        blockerPiece: blocker.type,
        shielded: shielded.square,
        shieldedPiece: shielded.type,
        attacker: slider.square,
        attackerPiece: slider.type,
        side: defender,
      });
    }
  }
  // most valuable shielded man first
  return out.sort((a, b) => PIECE_VALUE[b.shieldedPiece] - PIECE_VALUE[a.shieldedPiece]);
}

// ── plain-language one-liners (validated facts only) ──────────────────────────
export function threatLines(fen: string, max = 4): string[] {
  return findThreatenedPieces(fen)
    .slice(0, max)
    .map(
      (t) =>
        `${sideName(t.threatenedBy)} threatens to win the ${sideName(t.owner).toLowerCase()} ${
          PIECE_NAME[t.piece]
        } on ${t.square} (+${t.gain})`,
    );
}

export function shieldLines(fen: string, max = 2): string[] {
  return findShields(fen)
    .slice(0, max)
    .map(
      (s) =>
        `${sideName(s.side)}'s ${PIECE_NAME[s.blockerPiece]} on ${s.blocker} shields the ${
          PIECE_NAME[s.shieldedPiece]
        } on ${s.shielded} from the ${PIECE_NAME[s.attackerPiece]} on ${s.attacker}`,
    );
}
