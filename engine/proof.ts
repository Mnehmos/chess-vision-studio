// Proof obligations — the architecture that tames the proof-obligation explosion.
// A cheap layer creates an OBLIGATION ("there may be a mating net here") only when
// cheap facts justify it; the expensive bounded solver then DISCHARGES it (proved /
// timeout). The start position creates ZERO mate obligations, so the solver is
// never invoked there. Pure & headless.
import { Chess } from 'chess.js';
import { parseFen, attackersOf, fileOf, rankOf, toSquare, type Color } from './board';
import { forcedMate, DEFAULT_MATE_MS } from './matesolver';

export interface AnalysisObligation {
  id: string;
  type: 'mate_proof';
  fen: string;
  reason: string; // which cheap gate fired
  priority: number; // higher = discharge first
  maxPlies: number;
  timeBudgetMs: number;
}

export interface ProofResult {
  status: 'proved' | 'timeout';
  mateInMoves?: number;
  line?: string[];
  reason: string;
}

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** Does the side to move have at least one CHECK available? (cheap mate-pressure signal) */
export function sideToMoveHasCheck(fen: string): boolean {
  try {
    return (new Chess(fen).moves() as string[]).some((s) => s.includes('+') || s.includes('#'));
  } catch {
    return false;
  }
}

/** Squares the `kingColor` king could flee to (empty/enemy and not enemy-controlled). */
export function kingEscapeSquares(fen: string, kingColor: Color): number {
  const board = parseFen(fen);
  let kingSq = '';
  for (let f = 0; f < 8 && !kingSq; f++)
    for (let r = 0; r < 8; r++) {
      const p = board.grid[f][r];
      if (p && p.color === kingColor && p.type === 'k') {
        kingSq = toSquare(f, r);
        break;
      }
    }
  if (!kingSq) return 9;
  const enemy = other(kingColor);
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
      if (occ && occ.color === kingColor) continue;
      if (attackersOf(board, toSquare(f, r), enemy).length === 0) escapes++;
    }
  return escapes;
}

let obCounter = 0;

/**
 * Create a mate-proof obligation ONLY when cheap facts suggest mate pressure:
 *   - Stockfish already reports a mate score (strongest signal), OR
 *   - the side to move has a check available AND the enemy king is cramped (≤2 escapes).
 * Otherwise return null — the expensive solver is never invoked. The start
 * position has no check available and a roomy king, so it yields no obligation.
 */
export function gateMateObligation(
  fen: string,
  opts: { stockfishMate?: number; timeBudgetMs?: number } = {},
): AnalysisObligation | null {
  const board = parseFen(fen);
  const enemyKingColor = other(board.turn);
  const escapes = kingEscapeSquares(fen, enemyKingColor);
  const hasCheck = sideToMoveHasCheck(fen);
  const sfMate = opts.stockfishMate;

  let reason: string | null = null;
  let priority = 0;
  let maxPlies = 7;
  if (sfMate !== undefined && sfMate > 0) {
    reason = `Stockfish reports mate in ${sfMate}`;
    priority = 100;
    maxPlies = Math.min(7, sfMate * 2 - 1);
  } else if (hasCheck && escapes <= 2) {
    reason = `check available, enemy king has ${escapes} escape square(s)`;
    priority = 50 + (2 - escapes) * 10;
  } else {
    return null; // no obligation → no expensive search
  }

  obCounter += 1;
  return {
    id: `mate-ob-${obCounter}`,
    type: 'mate_proof',
    fen,
    reason,
    priority,
    maxPlies,
    timeBudgetMs: opts.timeBudgetMs ?? DEFAULT_MATE_MS,
  };
}

/** Discharge a mate obligation with the bounded solver: proved (line) or timeout. */
export function dischargeMate(ob: AnalysisObligation): ProofResult {
  const fm = forcedMate(ob.fen, ob.maxPlies, ob.timeBudgetMs);
  if (fm) {
    return { status: 'proved', mateInMoves: fm.mateInMoves, line: fm.line, reason: ob.reason };
  }
  return { status: 'timeout', reason: 'no forced mate proved within budget' };
}

/** Convenience: gate + discharge in one call. Returns null if no obligation/timeout. */
export function proveMate(
  fen: string,
  opts: { stockfishMate?: number; timeBudgetMs?: number } = {},
): ProofResult | null {
  const ob = gateMateObligation(fen, opts);
  if (!ob) return null;
  const result = dischargeMate(ob);
  return result.status === 'proved' ? result : null;
}
