// Phase B driver: train the sibling-RANKING value head on a multi-PV dataset and
// snapshot the weights. No Stockfish at train time — the per-candidate cpLoss is
// already in topMoves (from `dataset:relabel --multipv K`). Verification (the real
// gate: SF-scored searched move across depths + an independent slice) is done
// separately with `eval:value --b <this snapshot>`.
//
// The trained weights are written to a SNAPSHOT + value-weights-ranking.json for
// the verifier to read; promotion to the live value head is a manual decision made
// only after the acceptance gate passes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataset, trainValueRanking, type ValueWeights } from '@cvs/engine';

interface RankConfig {
  input: string;
  holdoutPct: number;
  out: string;
  modelDir: string;
  epochs: number;
  learningRate: number;
  l2: number;
  marginScale: number;
  marginCapCp: number;
  topK: number;
}

const DEFAULT_CONFIG: RankConfig = {
  input: 'arena/out/combined-multipv.jsonl',
  holdoutPct: 0.15,
  out: 'arena/out/value-weights-ranking.json',
  modelDir: 'arena/models/cvs-value-ranking',
  epochs: 400,
  learningRate: 0.01,
  l2: 1e-3,
  marginScale: 1.0,
  marginCapCp: Infinity,
  topK: 8,
};

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function vwStr(w: ValueWeights): string {
  return (
    `material p${w.material.p.toFixed(3)} n${w.material.n.toFixed(3)} b${w.material.b.toFixed(3)} ` +
    `r${w.material.r.toFixed(3)} q${w.material.q.toFixed(3)} · pstScale ${w.pstScale.toFixed(3)} · ` +
    `bishopPair ${w.bishopPair.toFixed(1)} · tempo ${w.tempo.toFixed(1)}`
  );
}

export async function runRanking(
  cfg: RankConfig = DEFAULT_CONFIG,
  log: (m: string) => void = (m) => console.log(m),
): Promise<{ snapshot: string }> {
  const all = loadDataset(cfg.input);
  const holdoutSize = Math.max(10, Math.floor(all.length * cfg.holdoutPct));
  const train = all.slice(0, all.length - holdoutSize);
  log(`dataset ${cfg.input}: ${all.length} rows (train ${train.length}, holdout ${holdoutSize})`);

  const res = trainValueRanking(train, {
    epochs: cfg.epochs,
    learningRate: cfg.learningRate,
    l2: cfg.l2,
    marginScale: cfg.marginScale,
    marginCapCp: cfg.marginCapCp,
    topK: cfg.topK,
  });

  const h0 = res.history[0];
  const hN = res.history.at(-1);
  const pct = (x?: number) => (x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const p4 = (x?: number) => (x === undefined ? 'n/a' : x.toFixed(4));
  log(`ranking: ${res.examples} parents, ${res.pairs} ranking pairs`);
  log(`  hinge loss ${p4(h0?.loss)} -> ${p4(hN?.loss)} pawns`);
  log(`  margin violations ${pct(h0?.violationRate)} -> ${pct(hN?.violationRate)}`);
  log(`  in-sample rank accuracy ${pct(h0?.rankAccuracy)} -> ${pct(hN?.rankAccuracy)}`);
  log(`  ${vwStr(res.weights)}`);

  const ts = stamp();
  mkdirSync(cfg.modelDir, { recursive: true });
  mkdirSync(dirname(cfg.out), { recursive: true });
  const snapshot = `${cfg.modelDir}/best-${ts}.json`;
  writeFileSync(snapshot, JSON.stringify(res.weights, null, 2), 'utf8');
  writeFileSync(cfg.out, JSON.stringify(res.weights, null, 2), 'utf8');
  log(`snapshot: ${snapshot}`);
  log(`ranking weights (for verification, NOT promoted): ${cfg.out}`);
  return { snapshot };
}

function parseArgs(argv: string[]): RankConfig {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--input') cfg.input = next();
    else if (a === '--out') cfg.out = next();
    else if (a === '--epochs') cfg.epochs = Number(next()) || cfg.epochs;
    else if (a === '--lr') cfg.learningRate = Number(next()) || cfg.learningRate;
    else if (a === '--l2') cfg.l2 = Number(next());
    else if (a === '--margin') cfg.marginScale = Number(next());
    else if (a === '--margin-cap') cfg.marginCapCp = Number(next());
    else if (a === '--topk') cfg.topK = Number(next()) || cfg.topK;
  }
  return cfg;
}

if (!process.env.VITEST) {
  runRanking(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('train-ranking failed:', e);
    process.exit(1);
  });
}
