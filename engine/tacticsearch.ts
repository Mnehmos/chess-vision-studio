// Forcing-move tactical search — a pure, deterministic quiescence negamax over
// CHECKS + CAPTURES (and all legal replies when in check). This is the robust
// ground-truth oracle that the fragile hand-rolled SEE-enumeration could not be:
// it naturally sees poisoned defenders (…Nc2+ Qxc2?? …Bxc2) and forced mates in
// N, so it validates forks, deep mates, and (later) Tier-2 motifs by OUTCOME.
//
// The motif NAME still comes from geometry; this supplies the VALIDITY/PAYOFF.
import { Chess } from 'chess.js';

export const MATE = 100000; // mate sentinel (in centipawn-ish search units)

// Material in pawns *100, king excluded (always present).
const MAT: Record<string, number> = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 0 };

interface VerboseMove {
  san: string;
  from: string;
  to: string;
  flags: string;
  piece: string;
  captured?: string;
}

/** Static material balance from the side-to-move POV (centipawns). */
function material(chess: Chess): number {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      const v = MAT[sq.type];
      score += sq.color === chess.turn() ? v : -v;
    }
  }
  return score;
}

function isCheckMove(m: VerboseMove): boolean {
  return m.san.includes('+') || m.san.includes('#');
}
function isCapture(m: VerboseMove): boolean {
  return m.flags.includes('c') || m.flags.includes('e');
}

/** MVV-LVA-ish ordering: big captures and checks first (better alpha-beta). */
function orderMoves(moves: VerboseMove[]): VerboseMove[] {
  return [...moves].sort((a, b) => score(b) - score(a));
  function score(m: VerboseMove): number {
    let s = 0;
    if (m.captured) s += MAT[m.captured] * 10 - MAT[m.piece];
    if (isCheckMove(m)) s += 50;
    return s;
  }
}

/**
 * Quiescence negamax. Returns the best achievable score for the side to move,
 * in centipawns, where a forced mate is `MATE - pliesToMate`.
 */
function quiesce(chess: Chess, depth: number, alpha: number, beta: number, ply: number): number {
  if (chess.isCheckmate()) return -MATE + ply; // side to move is mated
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDraw()) return 0;

  const inCheck = chess.inCheck();
  const stand = material(chess);

  if (!inCheck) {
    if (stand >= beta) return beta; // stand-pat cutoff
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha; // quiet leaf
  } else if (depth <= -6) {
    // Bound check-extension runaway: stop extending very deep check chains.
    return stand;
  }

  const all = chess.moves({ verbose: true }) as VerboseMove[];
  // When in check we must consider EVERY legal reply (escape the check).
  // Otherwise only forcing moves (captures + checks) keep the quiescence finite.
  const moves = inCheck ? all : all.filter((m) => isCapture(m) || isCheckMove(m));
  if (moves.length === 0) return inCheck ? -MATE + ply : alpha;

  for (const m of orderMoves(moves)) {
    chess.move(m.san);
    const score = -quiesce(chess, depth - 1, -beta, -alpha, ply + 1);
    chess.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

export interface TacticOutcome {
  /** Material the side to move nets via forcing play, in PAWNS (mate → large). */
  gain: number;
  /** Mate distance in plies if a forced mate exists for the side to move. */
  mateInPlies: number | null;
  /** The forcing principal variation (SAN). */
  line: string[];
}

/**
 * Evaluate the best forcing outcome for the side to move at `fen`.
 * `gain` is measured RELATIVE to the current material (so a check that wins a
 * rook reports ≈ +5, not the whole board balance).
 */
export function tacticalOutcome(fen: string, depth = 6): TacticOutcome {
  const root = new Chess(fen);
  const base = material(root);
  const { score, line } = searchRoot(root, depth);

  let mateInPlies: number | null = null;
  if (score >= MATE - 100) mateInPlies = MATE - score;

  return { gain: (score - base) / 100, mateInPlies, line };
}

function searchRoot(chess: Chess, depth: number): { score: number; line: string[] } {
  if (chess.isCheckmate()) return { score: -MATE, line: [] };
  const inCheck = chess.inCheck();
  const all = chess.moves({ verbose: true }) as VerboseMove[];
  const moves = inCheck ? all : all.filter((m) => isCapture(m) || isCheckMove(m));
  if (moves.length === 0) return { score: material(chess), line: [] };

  let alpha = -Infinity;
  let bestLine: string[] = [];
  for (const m of orderMoves(moves)) {
    chess.move(m.san);
    const sub = -quiesce(chess, depth - 1, -Infinity, -alpha, 1);
    // recover a short PV for display by re-searching the child cheaply
    chess.undo();
    if (sub > alpha) {
      alpha = sub;
      bestLine = [m.san, ...principalVariation(chess, m.san, depth - 1)];
    }
  }
  return { score: alpha, line: bestLine };
}

/** Cheap PV recovery: greedily follow the best forcing move a few plies. */
function principalVariation(chess: Chess, firstSan: string, depth: number): string[] {
  const line: string[] = [];
  const c = new Chess(chess.fen());
  c.move(firstSan);
  for (let d = depth; d > 0; d--) {
    if (c.isCheckmate()) break;
    const inCheck = c.inCheck();
    const all = c.moves({ verbose: true }) as VerboseMove[];
    const moves = inCheck ? all : all.filter((m) => isCapture(m) || isCheckMove(m));
    if (moves.length === 0) break;
    let bestSan = '';
    let best = -Infinity;
    for (const m of orderMoves(moves)) {
      c.move(m.san);
      const s = -quiesce(c, depth - 1, -Infinity, Infinity, 1);
      c.undo();
      if (s > best) {
        best = s;
        bestSan = m.san;
      }
    }
    if (!bestSan) break;
    c.move(bestSan);
    line.push(bestSan);
  }
  return line;
}

/** Forced mate in N full-moves for the side to move (within `maxPlies`), or null. */
export function forcedMateIn(fen: string, maxPlies = 7): number | null {
  const out = tacticalOutcome(fen, maxPlies);
  if (out.mateInPlies === null) return null;
  return Math.ceil(out.mateInPlies / 2);
}
