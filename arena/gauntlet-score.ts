// Gauntlet score — Stockfish-scores every CVS move from a gauntlet run.
// Reads runs/<id>/moves.jsonl, adds the SF oracle columns + a classification,
// writes runs/<id>/scored_moves.jsonl. Uses the shared persisted SF eval cache.
//
//   npm run gauntlet:score -- --run arena/gauntlet/runs/<id> [--sf-depth 24]
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { computeCpLoss } from '../engine/classify';
import { normalize } from './quality';
import { SfCachePool } from './sf-cache';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from './review-config';

interface MoveRow {
  gameId: string;
  ply: number;
  fenBefore: string;
  sideToMove: string;
  cvsMove: string;
  cvsSan: string | null;
  cvsScore: number;
  cvsPV: string[];
  cvsDepth: number;
  nodes: number;
  qNodes: number;
  ttHits: number;
  timeMs: number;
  illegal: boolean;
}

export type Classification =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'mate_missed'
  | 'slow_mate'
  | 'illegal'
  | 'timeout';

/**
 * cpLoss thresholds (PAWNS, computeCpLoss convention):
 *   best = matches SF's first line · excellent ≤0.1 · good ≤0.3 · inaccuracy ≤0.75
 *   mistake <2.0 · blunder ≥2.0 · mate_missed = forced mate available, no longer
 *   forced after the move (loss ≥2) · slow_mate = forced mate available, mover
 *   STILL forces mate after the move but didn't play the oracle line.
 */
export function classify(
  cpLoss: number,
  isBest: boolean,
  mateMissed: boolean,
  illegal: boolean,
  slowMate = false,
): Classification {
  if (illegal) return 'illegal';
  if (mateMissed) return 'mate_missed';
  if (isBest) return 'best';
  if (slowMate) return 'slow_mate';
  if (cpLoss <= 0.1) return 'excellent';
  if (cpLoss <= 0.3) return 'good';
  if (cpLoss <= 0.75) return 'inaccuracy';
  if (cpLoss < 2.0) return 'mistake';
  return 'blunder';
}

function parseArgs(argv: string[]): { run: string; sfDepth: number } {
  let run = '';
  let sfDepth = DEFAULT_STOCKFISH_REVIEW_DEPTH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') run = argv[++i] ?? '';
    else if (argv[i] === '--sf-depth') sfDepth = Number(argv[++i]) || DEFAULT_STOCKFISH_REVIEW_DEPTH;
  }
  if (!run) throw new Error('--run <dir> required');
  return { run, sfDepth };
}

async function main(): Promise<void> {
  const { run, sfDepth } = parseArgs(process.argv.slice(2));
  const rows: MoveRow[] = readFileSync(`${run}/moves.jsonl`, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  console.log(`scoring ${rows.length} CVS moves from ${run} at SF depth ${sfDepth}…`);

  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  const pool = new SfCachePool([sf], sfDepth, 'arena/out/sf-eval-cache.jsonl');
  const out: string[] = [];
  let done = 0;
  try {
    for (const row of rows) {
      const scored: Record<string, unknown> = { ...row };
      if (row.illegal) {
        scored.classification = 'illegal';
        scored.cpLoss = null;
        out.push(JSON.stringify(scored));
        continue;
      }
      const before = await pool.evalFen(row.fenBefore);
      if (before.status === 'unavailable' || !before.pv?.[0]) {
        scored.classification = 'timeout';
        scored.cpLoss = null;
        out.push(JSON.stringify(scored));
        continue;
      }
      const chess = new Chess(row.fenBefore);
      let fenAfter: string | null = null;
      try {
        const m = chess.move({ from: row.cvsMove.slice(0, 2), to: row.cvsMove.slice(2, 4), promotion: row.cvsMove.slice(4) || undefined });
        fenAfter = m ? chess.fen() : null;
      } catch {
        fenAfter = null;
      }
      if (!fenAfter) {
        scored.classification = 'illegal';
        scored.cpLoss = null;
        out.push(JSON.stringify(scored));
        continue;
      }
      // Terminal after-positions can't be SF-scored (a mated position has no PV).
      // Delivering checkmate IS the best move; a drawn terminal scores as 0cp.
      if (chess.isCheckmate()) {
        scored.stockfishBest = before.pv[0];
        scored.stockfishEvalBefore = before.mate !== undefined ? `M${before.mate}` : before.cp;
        scored.stockfishEvalAfter = 'mate_delivered';
        scored.fenAfter = fenAfter;
        scored.cpLoss = 0;
        scored.oracleDepth = sfDepth;
        scored.classification = 'best';
        out.push(JSON.stringify(scored));
        if (++done % 200 === 0) console.log(`  ${done}/${rows.length}…`);
        continue;
      }
      const after = chess.isGameOver()
        ? { cp: 0, depth: 0, pv: [] } // stalemate / draw terminal: dead-equal by rule
        : await pool.evalFen(fenAfter);
      const cpLoss = Math.max(0, computeCpLoss(before, after));
      const isBest = normalize(row.cvsSan ?? '') === normalize(before.pv[0]);
      const hadMate = before.mate !== undefined && before.mate > 0;
      const keptMate = after.mate !== undefined && after.mate < 0; // opponent still gets mated
      const mateMissed = hadMate && !keptMate && cpLoss >= 2;
      const slowMate = hadMate && keptMate && !isBest;
      scored.stockfishBest = before.pv[0];
      scored.stockfishEvalBefore = before.mate !== undefined ? `M${before.mate}` : before.cp;
      scored.stockfishEvalAfter = after.mate !== undefined ? `M${after.mate}` : after.cp;
      scored.fenAfter = fenAfter;
      scored.cpLoss = Number(cpLoss.toFixed(3));
      scored.oracleDepth = sfDepth;
      scored.classification = classify(cpLoss, isBest, mateMissed, false, slowMate);
      out.push(JSON.stringify(scored));
      if (++done % 200 === 0) console.log(`  ${done}/${rows.length}…`);
    }
  } finally {
    sf.dispose();
  }
  writeFileSync(`${run}/scored_moves.jsonl`, out.join('\n') + '\n', 'utf8');
  console.log(`wrote ${out.length} scored moves -> ${run}/scored_moves.jsonl`);
}

main().catch((e) => {
  console.error('gauntlet:score failed:', e);
  process.exit(1);
});
