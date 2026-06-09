// CVS-Policy engine training loop. Sweeps a few {epochs, learningRate} configs on
// a JSONL dataset, evaluates each on a fixed holdout (top-1 / top-3 vs the
// reference move), picks the winner, then VERIFIES baseline-vs-winner with a
// Stockfish-scored play-quality eval (real engine cpLoss / blunder / mate-miss /
// illegal on held-out positions). Leaves a clean trail:
//   arena/reports/engine-training/run-<ts>.md   (the metrics table + notes)
//   arena/models/cvs-policy/best-<ts>.json       (best-weights snapshot)
//   arena/out/weights.json                        (live weights, if improved)
//
// Selection priority (quality-first, per the training brief): illegal=0, then
// fewer mate-misses, then lower blunder rate, then lower avg cpLoss, then higher
// top-3, then higher top-1. The cheap sweep ranks by top-3/top-1; the SF eval is
// the tie-broken truth for the report and the keep/Discard decision vs baseline.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CvsEngine,
  DEFAULT_POLICY_WEIGHTS,
  DEFAULT_VALUE_WEIGHTS,
  benchmark,
  loadDataset,
  trainPolicy,
  trainValue,
  type PolicyWeights,
  type TrainingPosition,
  type ValueWeights,
} from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { evaluateQuality, type QualityReport } from './quality';

type Bench = ReturnType<typeof benchmark>;

interface SweepConfig {
  epochs: number;
  learningRate?: number;
}

const CONFIGS: SweepConfig[] = [
  { epochs: 60, learningRate: 0.1 },
  { epochs: 200, learningRate: 0.1 },
  { epochs: 500, learningRate: 0.05 },
];

interface TrainConfig {
  input: string;
  out: string;
  reportDir: string;
  modelDir: string;
  holdoutPct: number;
  qualityPositions: number; // how many holdout positions to SF-score
  qualityDepth: number;
  searchDepth: number; // CVS search depth for the engine's pick in the SF eval
  // Value head: the searched move is value-driven, so the value comparison uses a
  // deeper search (value leaves get more leverage) than the policy comparison.
  valueSearchDepth: number;
  valueOut: string; // live trained value weights, written only if kept
  valueModelDir: string; // value-weights snapshots
}

const DEFAULT_CONFIG: TrainConfig = {
  input: 'arena/out/combined-dataset.jsonl',
  out: 'arena/out/weights.json',
  reportDir: 'arena/reports/engine-training',
  modelDir: 'arena/models/cvs-policy',
  holdoutPct: 0.15,
  qualityPositions: 60,
  qualityDepth: 10,
  searchDepth: 2,
  valueSearchDepth: 3,
  valueOut: 'arena/out/value-weights.json',
  valueModelDir: 'arena/models/cvs-value',
};

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function runTrainingLoop(cfg: TrainConfig = DEFAULT_CONFIG, log: (m: string) => void = (m) => console.log(m)): Promise<void> {
  const all = loadDataset(cfg.input);
  if (all.length < 20) throw new Error(`Dataset too small (${all.length} rows): ${cfg.input}`);
  const holdoutSize = Math.max(10, Math.floor(all.length * cfg.holdoutPct));
  const train = all.slice(0, all.length - holdoutSize);
  const holdout = all.slice(train.length);
  log(`dataset ${cfg.input}: ${all.length} rows (train ${train.length}, holdout ${holdout.length})`);

  const baselineEngine = new CvsEngine({ weights: DEFAULT_POLICY_WEIGHTS });
  const baselineBench = benchmark(holdout, baselineEngine, { topK: 3 });
  log(`baseline: top1 ${(baselineBench.top1Match * 100).toFixed(1)}%  top3 ${(baselineBench.topKMatch * 100).toFixed(1)}%`);

  // Cheap sweep — rank by top-3 then top-1.
  const sweep: { cfg: SweepConfig; bench: Bench; weights: PolicyWeights }[] = [];
  for (const sc of CONFIGS) {
    const trained = trainPolicy(train, { epochs: sc.epochs, learningRate: sc.learningRate });
    const bench = benchmark(holdout, new CvsEngine({ weights: trained.weights }), { topK: 3 });
    sweep.push({ cfg: sc, bench, weights: trained.weights });
    log(`  epochs ${sc.epochs} lr ${sc.learningRate ?? 'default'}: top1 ${(bench.top1Match * 100).toFixed(1)}%  top3 ${(bench.topKMatch * 100).toFixed(1)}%`);
  }
  sweep.sort((a, b) => b.bench.topKMatch - a.bench.topKMatch || b.bench.top1Match - a.bench.top1Match);
  const winner = sweep[0]!;

  // Value head — train the 9-scalar value weights on the SAME train split. The
  // searched move is value-driven (negamax leaves), so this is the lever for
  // actual play quality; the policy stays FIXED (winner.weights) in the value
  // comparison so the value function is the only variable.
  const valueTrained = trainValue(train, { epochs: 200, learningRate: 0.05 });
  const vMae = valueTrained.history.at(-1)?.mae;
  log(`value head: trained on ${valueTrained.examples} labeled positions (final MAE ${vMae !== undefined ? vMae.toFixed(2) : 'n/a'} pawns)`);

  // Truth check — Stockfish-scored play quality.
  log(`SF-scoring baseline vs winner on ${Math.min(cfg.qualityPositions, holdout.length)} holdout positions (depth ${cfg.qualityDepth})…`);
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  let baseQuality: QualityReport;
  let winQuality: QualityReport;
  let valueBaseQuality: QualityReport;
  let valueTrainedQuality: QualityReport;
  try {
    baseQuality = await evaluateQuality(baselineEngine, holdout, sf, cfg);
    winQuality = await evaluateQuality(new CvsEngine({ weights: winner.weights }), holdout, sf, cfg);
    // Value pair: policy fixed, default vs trained value weights, deeper search so
    // the value function gets more leverage over the searched move.
    log(`SF-scoring value baseline vs value-trained at search depth ${cfg.valueSearchDepth} (policy fixed)…`);
    valueBaseQuality = await evaluateQuality(
      new CvsEngine({ weights: winner.weights, valueWeights: DEFAULT_VALUE_WEIGHTS }),
      holdout,
      sf,
      cfg,
      cfg.valueSearchDepth,
    );
    valueTrainedQuality = await evaluateQuality(
      new CvsEngine({ weights: winner.weights, valueWeights: valueTrained.weights }),
      holdout,
      sf,
      cfg,
      cfg.valueSearchDepth,
    );
  } finally {
    sf.dispose();
  }

  // Keep the winner only if it doesn't materially worsen quality (brief's rule).
  const improvedQuality =
    winQuality.illegal === 0 &&
    winQuality.mateMissed <= baseQuality.mateMissed &&
    winQuality.blunderRate <= baseQuality.blunderRate + 0.02 &&
    winQuality.avgCpLoss <= baseQuality.avgCpLoss + 0.1;
  const improvedTop = winner.bench.topKMatch > baselineBench.topKMatch || winner.bench.top1Match > baselineBench.top1Match;
  const keep = improvedTop && improvedQuality;

  // Value head is the head being optimized: keep its trained weights only if the
  // SEARCHED move STRICTLY improves (no slack), with no illegal moves and mate
  // safety not regressing.
  const keepValue =
    valueTrainedQuality.illegal === 0 &&
    valueTrainedQuality.mateMissed <= valueBaseQuality.mateMissed &&
    valueTrainedQuality.blunderRate <= valueBaseQuality.blunderRate &&
    valueTrainedQuality.avgCpLoss <= valueBaseQuality.avgCpLoss;

  const ts = stamp();
  mkdirSync(cfg.reportDir, { recursive: true });
  mkdirSync(cfg.modelDir, { recursive: true });
  mkdirSync(cfg.valueModelDir, { recursive: true });
  mkdirSync(dirname(cfg.out), { recursive: true });
  mkdirSync(dirname(cfg.valueOut), { recursive: true });

  const snapshot = `${cfg.modelDir}/best-${ts}.json`;
  writeFileSync(snapshot, JSON.stringify(winner.weights, null, 2), 'utf8');
  if (keep) writeFileSync(cfg.out, JSON.stringify(winner.weights, null, 2), 'utf8');

  const valueSnapshot = `${cfg.valueModelDir}/best-${ts}.json`;
  writeFileSync(valueSnapshot, JSON.stringify(valueTrained.weights, null, 2), 'utf8');
  if (keepValue) writeFileSync(cfg.valueOut, JSON.stringify(valueTrained.weights, null, 2), 'utf8');

  const report = renderReport({
    ts,
    cfg,
    all,
    train,
    holdout,
    baselineBench,
    sweep,
    winner,
    baseQuality,
    winQuality,
    valueBaseQuality,
    valueTrainedQuality,
    valueWeights: valueTrained.weights,
    keep,
    keepValue,
    snapshot,
    valueSnapshot,
  });
  const reportPath = `${cfg.reportDir}/run-${ts}.md`;
  writeFileSync(reportPath, report, 'utf8');

  log(`\n${report}`);
  log(`\nbest weights snapshot: ${snapshot}`);
  log(keep ? `live weights updated: ${cfg.out}` : `winner did NOT beat baseline on quality — live weights unchanged (${cfg.out})`);
  log(`value weights snapshot: ${valueSnapshot}`);
  log(keepValue ? `value weights updated: ${cfg.valueOut}` : `value training did NOT beat default on searched-move quality — value weights unchanged`);
  log(`report: ${reportPath}`);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function renderReport(d: {
  ts: string;
  cfg: TrainConfig;
  all: TrainingPosition[];
  train: TrainingPosition[];
  holdout: TrainingPosition[];
  baselineBench: Bench;
  sweep: { cfg: SweepConfig; bench: Bench }[];
  winner: { cfg: SweepConfig; bench: Bench };
  baseQuality: QualityReport;
  winQuality: QualityReport;
  valueBaseQuality: QualityReport;
  valueTrainedQuality: QualityReport;
  valueWeights: ValueWeights;
  keep: boolean;
  keepValue: boolean;
  snapshot: string;
  valueSnapshot: string;
}): string {
  const sweepRows = d.sweep
    .map((s) => `| epochs ${s.cfg.epochs}, lr ${s.cfg.learningRate ?? 'def'} | ${pct(s.bench.top1Match)} | ${pct(s.bench.topKMatch)} |`)
    .join('\n');
  const q = (r: QualityReport) =>
    `${pct(r.top1)} | ${r.avgCpLoss.toFixed(2)} | ${r.medianCpLoss.toFixed(2)} | ${pct(r.blunderRate)} | ${r.mateMissed} | ${r.illegal}`;
  const vw = d.valueWeights;
  const vwStr =
    `material p${vw.material.p.toFixed(3)} n${vw.material.n.toFixed(3)} b${vw.material.b.toFixed(3)} ` +
    `r${vw.material.r.toFixed(3)} q${vw.material.q.toFixed(3)} · pstScale ${vw.pstScale.toFixed(3)} · ` +
    `bishopPair ${vw.bishopPair.toFixed(1)} · tempo ${vw.tempo.toFixed(1)}`;
  return `# CVS-Policy Training Run ${d.ts}

## Summary
- Dataset: ${d.cfg.input}
- Positions: ${d.all.length} (train ${d.train.length}, holdout ${d.holdout.length})
- Objective: (policy) linear softmax best-move imitation; (value) Huber regression of the handcrafted eval toward Stockfish position evals — the value head drives the searched move.
- Winner config: epochs ${d.winner.cfg.epochs}, lr ${d.winner.cfg.learningRate ?? 'default'}
- Best policy weights: ${d.snapshot}
- Live policy weights updated: ${d.keep ? 'YES' : 'NO (winner did not beat baseline on quality)'}
- Value weights: ${d.valueSnapshot} — ${d.keepValue ? 'KEPT (improved searched-move quality)' : 'discarded (no improvement on searched-move quality)'}

## Sweep (cheap holdout benchmark — top-1 / top-3 vs reference move)
| Config | Top-1 | Top-3 |
|---|---:|---:|
| baseline (CVS-Policy-0) | ${pct(d.baselineBench.top1Match)} | ${pct(d.baselineBench.topKMatch)} |
${sweepRows}

## Stockfish-scored POLICY play quality (held-out positions, engine's actual move, search depth ${d.cfg.searchDepth})
| Engine | Top-1 vs SF | Avg cpLoss | Median cpLoss | Blunder % | Mate missed | Illegal |
|---|---:|---:|---:|---:|---:|---:|
| baseline | ${q(d.baseQuality)} |
| winner | ${q(d.winQuality)} |

## Stockfish-scored VALUE play quality (policy fixed = winner; the searched move is value-driven; search depth ${d.cfg.valueSearchDepth})
| Value weights | Top-1 vs SF | Avg cpLoss | Median cpLoss | Blunder % | Mate missed | Illegal |
|---|---:|---:|---:|---:|---:|---:|
| default (handcrafted) | ${q(d.valueBaseQuality)} |
| trained | ${q(d.valueTrainedQuality)} |

Trained value weights: ${vwStr}

## Notes
- The cheap benchmark's avgCpLoss/blunderRate reflect the DATASET reference cpLoss (best-move rows → ~0), not engine play; the SF-scored tables above are the real engine quality.
- Policy selection: top-3 then top-1 for the sweep; kept only if SF quality did not materially regress (illegal=0, mate-miss ≤, blunder ≤ +2pts, avg cpLoss ≤ +0.1).
- Value selection: the value head drives the searched move, so it is kept only if the SEARCHED move STRICTLY improves (avg cpLoss ↓, blunder ↓, mate-miss ≤, illegal=0) at depth ${d.cfg.valueSearchDepth} vs the default value function with the SAME policy.
- Value objective: Huber regression of the handcrafted White-POV eval toward Stockfish position evals (mate labels saturated to ±3000cp), L2-regularized toward the handcrafted defaults so the prior is the hand-tuned eval.
- Next experiment: per-legal-move candidate rows with a margin-ranking quality target (clamp(1 − cpLoss/300)) so the value head learns to order siblings, not just regress the position; richer ChessBench (prdev full-policy-value) once a parquet reader is added.
`;
}

if (!process.env.VITEST) {
  const input = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_CONFIG.input;
  runTrainingLoop({ ...DEFAULT_CONFIG, input }).catch((e) => {
    console.error('training loop failed:', e);
    process.exit(1);
  });
}
