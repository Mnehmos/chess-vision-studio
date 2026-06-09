// Standalone value-weight evaluator — NO training. Loads a dataset slice and two
// value-weight sets (A vs B), holds the POLICY fixed, and Stockfish-scores the
// SEARCHED move for each so a trained value head can be verified on a larger /
// independent sample (and at any depth) than the training loop's quick check.
//
// Usage:
//   npm run eval:value -- --input arena/out/combined-evals.jsonl \
//     --policy arena/out/weights.json \
//     --a default --b arena/out/value-weights.json \
//     --offset 543 --positions 95 --depth 3
//
// --a/--b accept a path to a JSON ValueWeights file, or the literal "default"
// for DEFAULT_VALUE_WEIGHTS. --offset/--positions select the dataset slice (e.g.
// offset 543 = the training loop's holdout region for a 638-row set).
import { readFileSync } from 'node:fs';
import {
  CvsEngine,
  DEFAULT_POLICY_WEIGHTS,
  DEFAULT_VALUE_WEIGHTS,
  loadDataset,
  type PolicyWeights,
  type ValueWeights,
} from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { evaluateQuality, type QualityConfig, type QualityReport } from './quality';

interface EvalConfig {
  input: string;
  policy: string; // path to policy weights JSON, or "default"
  a: string; // path to value weights JSON, or "default"
  b: string; // path to value weights JSON, or "default"
  offset: number;
  positions: number;
  depth: number; // CVS search depth
  qualityDepth: number; // Stockfish reference depth
}

const DEFAULT_CONFIG: EvalConfig = {
  input: 'arena/out/combined-evals.jsonl',
  policy: 'arena/out/weights.json',
  a: 'default',
  b: 'arena/out/value-weights.json',
  offset: 543,
  positions: 95,
  depth: 3,
  qualityDepth: 10,
};

function loadPolicy(path: string): PolicyWeights {
  if (path === 'default') return DEFAULT_POLICY_WEIGHTS;
  return JSON.parse(readFileSync(path, 'utf8')) as PolicyWeights;
}

function loadValue(path: string): ValueWeights {
  if (path === 'default') return DEFAULT_VALUE_WEIGHTS;
  return JSON.parse(readFileSync(path, 'utf8')) as ValueWeights;
}

function fmt(label: string, r: QualityReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    `| ${label} | ${pct(r.top1)} | ${r.avgCpLoss.toFixed(3)} | ${r.medianCpLoss.toFixed(3)} | ` +
    `${pct(r.blunderRate)} | ${r.mateMissed} | ${r.illegal} | ${r.positions} |`
  );
}

export async function evalValue(
  cfg: EvalConfig = DEFAULT_CONFIG,
  log: (m: string) => void = (m) => console.log(m),
): Promise<{ a: QualityReport; b: QualityReport }> {
  const all = loadDataset(cfg.input);
  const slice = all.slice(cfg.offset, cfg.offset + cfg.positions);
  const policy = loadPolicy(cfg.policy);
  const aWeights = loadValue(cfg.a);
  const bWeights = loadValue(cfg.b);

  // For the A/B comparison we always inject a value closure (even for "default")
  // so both sides take the identical injected-Searcher code path.
  const engineA = new CvsEngine({ weights: policy, valueWeights: aWeights });
  const engineB = new CvsEngine({ weights: policy, valueWeights: bWeights });

  const qcfg: QualityConfig = { qualityPositions: cfg.positions, qualityDepth: cfg.qualityDepth, searchDepth: cfg.depth };

  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  let a: QualityReport;
  let b: QualityReport;
  try {
    log(`eval-value: ${slice.length} positions [${cfg.offset}..${cfg.offset + cfg.positions}) @ CVS depth ${cfg.depth}, SF depth ${cfg.qualityDepth}`);
    log(`  A = ${cfg.a}`);
    log(`  B = ${cfg.b}`);
    a = await evaluateQuality(engineA, slice, sf, qcfg, cfg.depth);
    b = await evaluateQuality(engineB, slice, sf, qcfg, cfg.depth);
  } finally {
    sf.dispose();
  }

  log(`\n| Value weights | Top-1 vs SF | Avg cpLoss | Median cpLoss | Blunder % | Mate missed | Illegal | Scored |`);
  log(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  log(fmt(`A (${cfg.a})`, a));
  log(fmt(`B (${cfg.b})`, b));

  const dAvg = b.avgCpLoss - a.avgCpLoss;
  const dBlunder = b.blunderRate - a.blunderRate;
  const verdict =
    b.illegal === 0 && b.mateMissed <= a.mateMissed && dBlunder <= 0 && dAvg <= 0
      ? 'B IMPROVES (or ties) A on every gate metric'
      : 'B does NOT strictly beat A';
  log(`\nΔ avgCpLoss (B−A): ${dAvg.toFixed(3)} pawns · Δ blunderRate: ${(dBlunder * 100).toFixed(1)} pts · ${verdict}`);
  return { a, b };
}

function parseArgs(argv: string[]): EvalConfig {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--input') cfg.input = next();
    else if (a === '--policy') cfg.policy = next();
    else if (a === '--a') cfg.a = next();
    else if (a === '--b') cfg.b = next();
    else if (a === '--offset') cfg.offset = Number(next()) || 0;
    else if (a === '--positions') cfg.positions = Number(next()) || cfg.positions;
    else if (a === '--depth') cfg.depth = Number(next()) || cfg.depth;
    else if (a === '--quality-depth') cfg.qualityDepth = Number(next()) || cfg.qualityDepth;
  }
  return cfg;
}

if (!process.env.VITEST) {
  evalValue(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('eval-value failed:', e);
    process.exit(1);
  });
}
