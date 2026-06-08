// Orchestrator — the ONE place the async engine meets the pure seam. Computes
// the two evals with Stockfish, then hands them to the pure analyzeMove. The
// app imports this; nothing in the pure layers depends on it.
import { Chess } from 'chess.js';
import { UciEngine } from './evaluation';
import { analyzeMove } from './saliency';
import { pliesFromPgn } from './position';
import {
  deepCheckTrigger,
  withDeepCheck,
  DEEP_CHECK_DEPTH,
  DEEP_CHECK_TIMEOUT_MS,
} from './deepcheck';
import type { Eval, MoveAnalysis } from './types';

export const DEFAULT_DEPTH = 14;

/** Tuning for the selective deep re-search of forcing/sacrificial moves. */
export interface DeepCheckOptions {
  enabled?: boolean; // default true — set false to skip the second pass entirely
  depth?: number; // default DEEP_CHECK_DEPTH
  timeoutMs?: number; // default DEEP_CHECK_TIMEOUT_MS
}

/** Analyze a single SAN move played from `fenBefore`, using live Stockfish evals.
 *  A forcing/sacrificial move that the base depth scores as adverse is re-searched
 *  deeper (see deepcheck.ts) — the deeper eval stays the oracle, never overridden. */
export async function analyzeMoveLive(
  engine: UciEngine,
  fenBefore: string,
  san: string,
  depth: number = DEFAULT_DEPTH,
  deep: DeepCheckOptions = {},
): Promise<MoveAnalysis> {
  const chess = new Chess(fenBefore);
  const moved = chess.move(san);
  if (!moved) throw new Error(`illegal move ${san} in ${fenBefore}`);
  const fenAfter = chess.fen();

  // A terminal position (checkmate/stalemate) has no eval — don't ask Stockfish.
  // analyzeMove short-circuits on a delivered mate, so evalAfter is unused there.
  const terminal = chess.isGameOver();
  const terminalEval = (d: number): Eval => ({ depth: d, pv: [], status: 'terminal' });
  const afterEval = (d: number, timeoutMs?: number): Promise<Eval> =>
    terminal ? Promise.resolve(terminalEval(d)) : engine.evaluate({ fen: fenAfter, depth: d, timeoutMs });

  const [evalBefore, evalAfter] = await Promise.all([
    engine.evaluate({ fen: fenBefore, depth }),
    afterEval(depth),
  ]);
  const shallow = analyzeMove({ fenBefore, fenAfter, san, evalBefore, evalAfter });

  // §forcing-line override — only forcing/sacrificial moves the base depth judged
  // adverse get the (expensive) second pass.
  if (deep.enabled === false) return shallow;
  const trigger = deepCheckTrigger(fenBefore, san, shallow);
  if (!trigger) return shallow;

  const deepDepth = deep.depth ?? DEEP_CHECK_DEPTH;
  const timeoutMs = deep.timeoutMs ?? DEEP_CHECK_TIMEOUT_MS;
  const [deepBefore, deepAfter] = await Promise.all([
    engine.evaluate({ fen: fenBefore, depth: deepDepth, timeoutMs }),
    afterEval(deepDepth, timeoutMs),
  ]);
  // A failed/timed-out deep search must NEVER downgrade the good shallow verdict
  // to 'unclassified'. Keep the shallow analysis untouched in that case.
  if (deepBefore.status === 'unavailable' || deepAfter.status === 'unavailable') return shallow;

  const deepAnalysis = analyzeMove({ fenBefore, fenAfter, san, evalBefore: deepBefore, evalAfter: deepAfter });
  return withDeepCheck(deepAnalysis, shallow, deepDepth, trigger);
}

export interface AnalyzedPly {
  ply: number;
  moveNumber: number;
  san: string;
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
  analysis: MoveAnalysis;
}

/** Analyze a whole game ply-by-ply. Sequential so a single shared engine is safe. */
export async function analyzeGame(
  engine: UciEngine,
  pgn: string,
  depth: number = DEFAULT_DEPTH,
  onProgress?: (done: number, total: number) => void,
  deep: DeepCheckOptions = {},
): Promise<AnalyzedPly[]> {
  const plies = pliesFromPgn(pgn);
  const out: AnalyzedPly[] = [];
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    const analysis = await analyzeMoveLive(engine, p.fenBefore, p.san, depth, deep);
    out.push({ ...p, analysis });
    onProgress?.(i + 1, plies.length);
  }
  return out;
}
