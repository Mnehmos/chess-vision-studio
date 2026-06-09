// Shared Stockfish-scored play-quality metric: for a sample of positions, take
// the engine's SEARCHED move and score it against Stockfish's best (cpLoss,
// blunder rate, mate-safety, illegality). Used by both the training loop and the
// standalone value-weight evaluator so they measure quality identically.
import { Chess } from 'chess.js';
import type { CvsEngine, TrainingPosition } from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { computeCpLoss } from '../engine/classify';

export interface QualityReport {
  positions: number;
  top1: number; // engine #1 == Stockfish best
  avgCpLoss: number; // pawns, engine's move vs SF best
  medianCpLoss: number;
  blunderRate: number; // cpLoss >= 2 pawns
  mateMissed: number; // SF had mate, engine's move didn't keep it
  illegal: number; // engine produced an illegal move (should be 0)
}

export interface QualityConfig {
  qualityPositions: number; // how many positions to SF-score
  qualityDepth: number; // Stockfish reference depth
  searchDepth: number; // default CVS search depth for the engine's pick
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function normalize(m: string): string {
  return m.replace(/[+#!?]/g, '').trim();
}

/** Stockfish-scored play quality of `engine` on a sample of `positions`. */
export async function evaluateQuality(
  engine: CvsEngine,
  positions: TrainingPosition[],
  sf: UciEngine,
  cfg: QualityConfig,
  searchDepth: number = cfg.searchDepth,
): Promise<QualityReport> {
  const sample = positions.slice(0, cfg.qualityPositions);
  const losses: number[] = [];
  let top1 = 0;
  let mateMissed = 0;
  let illegal = 0;
  for (const pos of sample) {
    let before;
    try {
      before = await sf.evaluate({ fen: pos.fen, depth: cfg.qualityDepth });
    } catch {
      continue;
    }
    if (before.status === 'unavailable' || !before.pv?.[0]) continue;
    const pick = engine.bestMove(pos.fen, { depth: searchDepth }) ?? engine.predict(pos.fen, 1)[0];
    if (!pick) continue;
    const chess = new Chess(pos.fen);
    let fenAfter: string | null = null;
    try {
      const m = chess.move({ from: pick.uci.slice(0, 2), to: pick.uci.slice(2, 4), promotion: pick.uci.slice(4) || undefined });
      fenAfter = m ? chess.fen() : null;
    } catch {
      fenAfter = null;
    }
    if (!fenAfter) {
      illegal += 1;
      continue;
    }
    if (normalize(pick.san) === normalize(before.pv[0])) top1 += 1;
    let after;
    try {
      after = await sf.evaluate({ fen: fenAfter, depth: cfg.qualityDepth });
    } catch {
      continue;
    }
    const loss = Math.max(0, computeCpLoss(before, after));
    losses.push(loss);
    if (before.mate !== undefined && before.mate > 0 && !(after.mate !== undefined && after.mate < 0)) {
      // SF had a forced mate for the mover; the engine's move failed to keep a mating line.
      if (loss >= 2) mateMissed += 1;
    }
  }
  return {
    positions: losses.length,
    top1: sample.length ? top1 / sample.length : 0,
    avgCpLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    medianCpLoss: median(losses),
    blunderRate: losses.length ? losses.filter((l) => l >= 2).length / losses.length : 0,
    mateMissed,
    illegal,
  };
}
