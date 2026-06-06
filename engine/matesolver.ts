// DEEP forced-mate solver — a PURE, full-width negamax that proves forced mates
// up to N moves, INCLUDING mates whose first move is QUIET (not a check or a
// capture). The existing geometric `findMatesIn1` only sees mate-in-1, and the
// forcing-only `tacticsearch` (checks + captures) is BLIND to a quiet key like a
// rook lift (Rb7 …  Ra8#) because it never generates the non-forcing first move.
//
// The contract here is the OPPOSITE of quiescence: at EVERY node we generate ALL
// legal moves (chess.js .moves()) so a quiet mating move is never pruned. Mate is
// rules-provable — `chess.isCheckmate()` — never a heuristic. Speed comes from
// THREE soundness-preserving devices:
//   1. Iterative deepening over ODD ply bounds (1,3,5,7): the mover delivers mate
//      on odd plies, so the first depth that scores a mate gives the SHORTEST one,
//      and shallow mates terminate almost instantly.
//   2. A mate-only alpha window (alpha = MATE−depth−1): we only ask "is there a
//      mate within `depth` plies?", so any branch that cannot reach a mate score
//      is cut immediately. This is exact for the mate question, not a heuristic.
//   3. A transposition table keyed by FEN+depth: positions reached by different
//      move orders are scored once.
// Move ordering (checks/captures first) is a pure speed tweak — every legal move
// is still searched, so a quiet mating move is found, just ordered last.
//
// Pure & headless: chess.js (rules) only, no engine, no I/O.
import { Chess } from 'chess.js';

const MATE = 1_000_000; // mate sentinel; a mate at `ply` scores MATE - ply.

// TIME budget — the architecture is to GATE invocation (no obligation → no call),
// but a wall-clock deadline is the safety net so even an ungated call returns null
// ("no proof within budget" = an acceptable TIMEOUT) instead of the catastrophic
// full-width explosion. A node budget can't do this: chess.js move-gen is slow
// enough that even ~100k nodes is seconds, so we bound wall-clock directly.
export const DEFAULT_MATE_MS = 2000;
const ABORT = Symbol('mate-budget');
interface NodeCtx {
  nodes: number;
  deadline: number; // Date.now() timestamp past which we abort
}

interface VMove {
  san: string;
  from: string;
  to: string;
  flags: string;
  piece: string;
  captured?: string;
}

function isCheckSan(san: string): boolean {
  return san.includes('+') || san.includes('#');
}
function isCaptureMove(m: VMove): boolean {
  return m.flags.includes('c') || m.flags.includes('e');
}

/**
 * Check-first (then captures) ordering. Pure speed: forcing moves early produce
 * earlier beta cutoffs, but EVERY legal move is still searched — a quiet mating
 * move that gives no check is ordered last, never dropped.
 */
function order(moves: VMove[]): VMove[] {
  return [...moves].sort((a, b) => rank(b) - rank(a));
  function rank(m: VMove): number {
    let s = 0;
    if (isCheckSan(m.san)) s += 1000;
    if (isCaptureMove(m)) s += 100;
    return s;
  }
}

/**
 * Negamax over the FULL move list, bounded by `depth` plies, scored from the
 * side-to-move POV: `MATE − pliesFromRoot` when the side to move forces mate
 * within the bound, a large negative when it is the one being mated, 0 otherwise
 * (no forced mate found, or a draw-ish leaf — we only care about mate, not
 * material). The single `Chess` instance is mutated with move/undo for speed.
 */
function search(
  chess: Chess,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  tt: Map<string, number>,
  ctx: NodeCtx,
): number {
  // Check the deadline every 2048 nodes (Date.now() per node would itself be costly).
  if ((++ctx.nodes & 2047) === 0 && Date.now() > ctx.deadline) throw ABORT;
  if (chess.isCheckmate()) return -MATE + ply; // side to move is mated
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDraw()) return 0;
  if (depth <= 0) return 0; // bound reached without a proven mate

  const key = chess.fen() + '|' + depth;
  const cached = tt.get(key);
  if (cached !== undefined) return cached;

  const all = chess.moves({ verbose: true }) as VMove[];
  if (all.length === 0) return 0; // no moves, not checkmate ⇒ stalemate (scored 0)

  let best = -Infinity;
  for (const m of order(all)) {
    chess.move(m.san);
    const score = -search(chess, depth - 1, ply + 1, -beta, -alpha, tt, ctx);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // cutoff — ordering only, soundness unaffected
  }
  tt.set(key, best);
  return best;
}

/**
 * Recover the principal variation (SAN) for a position known to force mate in
 * `plies`. The number of plies still needed is known exactly at every node, so we
 * search each candidate with a MATE-ONLY window and take the FIRST move (in
 * check-first order) that still forces mate within the remaining plies. This is
 * dramatically cheaper than a full-window re-search — the window prunes every
 * non-mating branch — and yields the most forcing PV deterministically, ending on
 * the mating move (…#).
 */
function principalVariation(fen: string, plies: number): string[] {
  const line: string[] = [];
  const c = new Chess(fen);
  let remaining = plies;
  let ply = 0;
  // Fresh, generous deadline: this follows a KNOWN mate (mate-only window prunes
  // everything else), so it is fast and bounded by the mate depth.
  const ctx: NodeCtx = { nodes: 0, deadline: Date.now() + DEFAULT_MATE_MS };
  while (remaining > 0) {
    if (c.isCheckmate()) break;
    const all = c.moves({ verbose: true }) as VMove[];
    if (all.length === 0) break;

    let chosen: string | null = null;
    let bestScore = -Infinity;
    let bestSan: string | null = null;
    const tt = new Map<string, number>();
    // After our move it is the opponent's turn; for us to mate in `remaining`
    // plies the opponent's score must be ≤ −(MATE − remaining), i.e. our score
    // ≥ MATE − remaining. Search the child with the mate-only window and stop at
    // the first move that reaches it.
    try {
      for (const m of order(all)) {
        c.move(m.san);
        const score = -search(c, remaining - 1, ply + 1, -MATE, -(MATE - remaining - 1), tt, ctx);
        c.undo();
        if (score >= MATE - remaining) {
          chosen = m.san;
          break;
        }
        if (score > bestScore) {
          bestScore = score;
          bestSan = m.san;
        }
      }
    } catch (e) {
      if (e === ABORT) break; // return the partial line we have
      throw e;
    }
    const next = chosen ?? bestSan;
    if (next === null) break;
    c.move(next);
    line.push(next);
    ply += 1;
    remaining -= 1;
    if (c.isCheckmate()) break;
  }
  return line;
}

export interface ForcedMate {
  /** Mate distance in FULL moves (mate in 1, 2, 3, …). */
  mateInMoves: number;
  /** The mating principal variation in SAN, ending on the mating move (…#). */
  line: string[];
}

/**
 * Find the SHORTEST forced mate for the side to move at `fen`, within `maxPlies`
 * (default 7 plies = mate in 4). Returns the mate distance in full moves plus the
 * principal variation in SAN, or `null` if no forced mate exists within the bound.
 *
 * Iterative deepening over ODD ply bounds (the mover mates on odd plies) with a
 * mate-only alpha window makes forced-mate puzzles resolve in well under a second
 * and small no-mate positions refute quickly. (Full-width to 7 plies on a wide
 * 20-move position with no mate is inherently expensive — that is the price of
 * never pruning a quiet mating move.)
 */
export function forcedMate(
  fen: string,
  maxPlies = 7,
  timeBudgetMs = DEFAULT_MATE_MS,
): ForcedMate | null {
  const root = new Chess(fen);
  if (root.isCheckmate() || root.isStalemate()) return null; // nothing to solve

  const ctx: NodeCtx = { nodes: 0, deadline: Date.now() + timeBudgetMs };
  try {
    for (let depth = 1; depth <= maxPlies; depth += 2) {
      const tt = new Map<string, number>();
      // Mate-only window: we only care whether a mate within `depth` plies exists.
      // alpha = MATE − depth − 1 prunes every non-mating branch immediately.
      const score = search(root, depth, 0, MATE - depth - 1, MATE, tt, ctx);
      if (score >= MATE - depth) {
        const pliesToMate = MATE - score;
        const line = principalVariation(fen, pliesToMate);
        return { mateInMoves: Math.ceil(pliesToMate / 2), line };
      }
    }
  } catch (e) {
    if (e === ABORT) return null; // out of budget → no proof found (timeout)
    throw e;
  }
  return null;
}
