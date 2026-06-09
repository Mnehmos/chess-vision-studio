// Train @cvs/engine policy weights from a JSONL dataset produced by OODA,
// bot harvests, or the offline Lichess open-database importer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CvsEngine,
  DEFAULT_POLICY_WEIGHTS,
  benchmark,
  loadDataset,
  trainPolicy,
} from '@cvs/engine';

interface TrainConfig {
  input: string;
  out: string;
  report: string;
  epochs: number;
  learningRate?: number;
  holdoutPct: number;
}

const DEFAULT_CONFIG: TrainConfig = {
  input: 'arena/out/lichess-master-dataset.jsonl',
  out: 'arena/out/weights.json',
  report: 'arena/out/train-report.json',
  epochs: 120,
  holdoutPct: 0.15,
};

function parseArgs(argv: string[]): TrainConfig {
  const cfg = { ...DEFAULT_CONFIG };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--out') cfg.out = next();
    else if (a === '--report') cfg.report = next();
    else if (a === '--epochs') cfg.epochs = Number(next()) || cfg.epochs;
    else if (a === '--learning-rate') cfg.learningRate = Number(next()) || undefined;
    else if (a === '--holdout-pct') cfg.holdoutPct = Math.max(0, Math.min(0.5, Number(next()) || cfg.holdoutPct));
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else positional.push(a);
  }
  cfg.input = positional[0] ?? cfg.input;
  return cfg;
}

function usage(): void {
  console.log(`Usage:
  npm run dataset:train -- <dataset.jsonl> [--out arena/out/weights.json]
    [--report arena/out/train-report.json] [--epochs 120] [--learning-rate 0.1]
    [--holdout-pct 0.15]`);
}

export function trainDataset(cfg: TrainConfig = DEFAULT_CONFIG): void {
  const all = loadDataset(cfg.input);
  if (all.length === 0) throw new Error(`Dataset is empty: ${cfg.input}`);

  const holdoutSize = Math.max(1, Math.floor(all.length * cfg.holdoutPct));
  const train = all.slice(0, Math.max(1, all.length - holdoutSize));
  const holdout = all.slice(train.length);
  const baseline = benchmark(holdout, new CvsEngine({ weights: DEFAULT_POLICY_WEIGHTS }), { topK: 3 });
  const trained = trainPolicy(train, {
    epochs: cfg.epochs,
    learningRate: cfg.learningRate,
  });
  const tuned = new CvsEngine({ weights: trained.weights });
  const tunedBench = benchmark(holdout, tuned, { topK: 3 });

  mkdirSync(dirname(cfg.out), { recursive: true });
  mkdirSync(dirname(cfg.report), { recursive: true });
  writeFileSync(cfg.out, JSON.stringify(trained.weights, null, 2), 'utf8');
  writeFileSync(
    cfg.report,
    JSON.stringify(
      {
        input: cfg.input,
        rows: all.length,
        trainRows: train.length,
        holdoutRows: holdout.length,
        epochs: cfg.epochs,
        baseline,
        tuned: tunedBench,
        historyTail: trained.history.slice(-10),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(
    `trained ${train.length} rows, holdout ${holdout.length}: top-1 ${(baseline.top1Match * 100).toFixed(1)}% -> ${(tunedBench.top1Match * 100).toFixed(1)}%; wrote ${cfg.out}`,
  );
}

if (!process.env.VITEST) {
  try {
    trainDataset(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error('Dataset training failed:', e);
    process.exit(1);
  }
}
