// Rung-2 driver: train the COMBINED value head (8 base + 18 Rung-2 = 26 dims)
// with a mixed regression(α) + sibling-ranking(β) objective on a multi-PV dataset
// (needs both evalBefore and topMoves cpLoss). Writes base + Rung-2 weight
// snapshots for the verifier; promotion is a manual decision after the gate.
//
//   npm run train:mixed -- --input arena/out/combined-multipv.jsonl --alpha 1 --beta 1
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataset, trainValueMixed, RUNG2_KEYS, type Rung2Weights, type ValueWeights } from '@cvs/engine';

interface MixedConfig {
  input: string;
  holdoutPct: number;
  baseOut: string;
  rung2Out: string;
  modelDir: string;
  epochs: number;
  learningRate: number;
  l2: number;
  alpha: number;
  beta: number;
  marginScale: number;
  marginCapCp: number;
  topK: number;
}

const DEFAULT_CONFIG: MixedConfig = {
  input: 'arena/out/combined-multipv.jsonl',
  holdoutPct: 0.15,
  baseOut: 'arena/out/value-weights-mixed.json',
  rung2Out: 'arena/out/rung2-weights-mixed.json',
  modelDir: 'arena/models/cvs-value-mixed',
  epochs: 400,
  learningRate: 0.1,
  l2: 1e-3,
  alpha: 1,
  beta: 1,
  marginScale: 1,
  marginCapCp: 100,
  topK: 8,
};

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function baseStr(w: ValueWeights): string {
  return (
    `material p${w.material.p.toFixed(3)} n${w.material.n.toFixed(3)} b${w.material.b.toFixed(3)} ` +
    `r${w.material.r.toFixed(3)} q${w.material.q.toFixed(3)} · pstScale ${w.pstScale.toFixed(3)} · ` +
    `bishopPair ${w.bishopPair.toFixed(1)} · tempo ${w.tempo.toFixed(1)}`
  );
}

function rung2Str(w: Rung2Weights): string {
  // Show the learned Rung-2 weights sorted by magnitude (cp per feature unit).
  return RUNG2_KEYS.map((k) => ({ k, v: w[k] }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .map(({ k, v }) => `${k} ${v.toFixed(2)}`)
    .join(' · ');
}

export async function runMixed(
  cfg: MixedConfig = DEFAULT_CONFIG,
  log: (m: string) => void = (m) => console.log(m),
): Promise<{ baseSnapshot: string; rung2Snapshot: string }> {
  const all = loadDataset(cfg.input);
  const holdoutSize = Math.max(10, Math.floor(all.length * cfg.holdoutPct));
  const train = all.slice(0, all.length - holdoutSize);
  log(`dataset ${cfg.input}: ${all.length} rows (train ${train.length}, holdout ${holdoutSize})`);
  log(`objective: α(regression)=${cfg.alpha} β(ranking)=${cfg.beta} marginCap=${cfg.marginCapCp}cp`);

  const res = trainValueMixed(train, {
    epochs: cfg.epochs,
    learningRate: cfg.learningRate,
    l2: cfg.l2,
    regressionWeight: cfg.alpha,
    rankingWeight: cfg.beta,
    marginScale: cfg.marginScale,
    marginCapCp: cfg.marginCapCp,
    topK: cfg.topK,
  });

  const h0 = res.history[0];
  const hN = res.history.at(-1);
  const pct = (x?: number) => (x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const p4 = (x?: number) => (x === undefined ? 'n/a' : x.toFixed(4));
  log(`mixed: ${res.regExamples} regression positions, ${res.rankPairs} ranking pairs`);
  log(`  reg loss   ${p4(h0?.regLoss)} -> ${p4(hN?.regLoss)} pawns`);
  log(`  rank loss  ${p4(h0?.rankLoss)} -> ${p4(hN?.rankLoss)} pawns`);
  log(`  rank acc   ${pct(h0?.rankAccuracy)} -> ${pct(hN?.rankAccuracy)}`);
  log(`  base : ${baseStr(res.base)}`);
  log(`  rung2: ${rung2Str(res.rung2)}`);

  const ts = stamp();
  mkdirSync(cfg.modelDir, { recursive: true });
  mkdirSync(dirname(cfg.baseOut), { recursive: true });
  const baseSnapshot = `${cfg.modelDir}/base-${ts}.json`;
  const rung2Snapshot = `${cfg.modelDir}/rung2-${ts}.json`;
  writeFileSync(baseSnapshot, JSON.stringify(res.base, null, 2), 'utf8');
  writeFileSync(rung2Snapshot, JSON.stringify(res.rung2, null, 2), 'utf8');
  writeFileSync(cfg.baseOut, JSON.stringify(res.base, null, 2), 'utf8');
  writeFileSync(cfg.rung2Out, JSON.stringify(res.rung2, null, 2), 'utf8');
  log(`snapshots: ${baseSnapshot} + ${rung2Snapshot}`);
  log(`weights (for verification, NOT promoted): ${cfg.baseOut} + ${cfg.rung2Out}`);
  return { baseSnapshot, rung2Snapshot };
}

function parseArgs(argv: string[]): MixedConfig {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--input') cfg.input = next();
    else if (a === '--epochs') cfg.epochs = Number(next()) || cfg.epochs;
    else if (a === '--lr') cfg.learningRate = Number(next()) || cfg.learningRate;
    else if (a === '--l2') cfg.l2 = Number(next());
    else if (a === '--alpha') cfg.alpha = Number(next());
    else if (a === '--beta') cfg.beta = Number(next());
    else if (a === '--margin') cfg.marginScale = Number(next());
    else if (a === '--margin-cap') cfg.marginCapCp = Number(next());
    else if (a === '--topk') cfg.topK = Number(next()) || cfg.topK;
  }
  return cfg;
}

if (!process.env.VITEST) {
  runMixed(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('train-mixed failed:', e);
    process.exit(1);
  });
}
