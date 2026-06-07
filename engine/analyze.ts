// Orchestrator — the ONE place the async engine meets the pure seam. Computes
// the two evals with Stockfish, then hands them to the pure analyzeMove. The
// app imports this; nothing in the pure layers depends on it.
import { Chess } from 'chess.js';
import { UciEngine } from './evaluation';
import { analyzeMove } from './saliency';
import { pliesFromPgn } from './position';
import type { MoveAnalysis } from './types';

export const DEFAULT_DEPTH = 14;

/** Analyze a single SAN move played from `fenBefore`, using live Stockfish evals. */
export async function analyzeMoveLive(
  engine: UciEngine,
  fenBefore: string,
  san: string,
  depth: number = DEFAULT_DEPTH,
): Promise<MoveAnalysis> {
  const chess = new Chess(fenBefore);
  const moved = chess.move(san);
  if (!moved) throw new Error(`illegal move ${san} in ${fenBefore}`);
  const fenAfter = chess.fen();

  // A terminal position (checkmate/stalemate) has no eval — don't ask Stockfish.
  // analyzeMove short-circuits on a delivered mate, so evalAfter is unused there.
  const terminal = chess.isGameOver();
  const [evalBefore, evalAfter] = await Promise.all([
    engine.evaluate({ fen: fenBefore, depth }),
    terminal
      ? Promise.resolve({ depth, pv: [], status: 'terminal' } as Awaited<ReturnType<typeof engine.evaluate>>)
      : engine.evaluate({ fen: fenAfter, depth }),
  ]);

  return analyzeMove({ fenBefore, fenAfter, san, evalBefore, evalAfter });
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
): Promise<AnalyzedPly[]> {
  const plies = pliesFromPgn(pgn);
  const out: AnalyzedPly[] = [];
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    const analysis = await analyzeMoveLive(engine, p.fenBefore, p.san, depth);
    out.push({ ...p, analysis });
    onProgress?.(i + 1, plies.length);
  }
  return out;
}
