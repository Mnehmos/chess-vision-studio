// Cached value-gate matrix runner. Replaces N separate eval-value processes (which
// recompute the same Stockfish "before" evals per depth) with ONE process that:
//   - caches every Stockfish eval by FEN@depth (in-memory + persisted jsonl), so a
//     position's eval is paid ONCE across all depths/engines/re-runs,
//   - sweeps engines × depths and emits a single comparison table,
//   - keeps SF depth configurable (default 10 = promotion gate; 8 = fast smoke),
//   - bounds Stockfish parallelism with --concurrency.
// Same searched-move quality metrics as eval-value (cpLoss / blunder / mate / illegal),
// just without the duplicated scoring.
//
//   npm run eval:matrix -- --positions 95 --offset 543 --depths 2,3,4 \
//     --sf-depth 10 --engines default,mixed --concurrency 2 \
//     --cache arena/out/sf-eval-cache.jsonl
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Chess } from 'chess.js';
import {
  CvsEngine,
  loadDataset,
  DEFAULT_POLICY_WEIGHTS,
  DEFAULT_VALUE_WEIGHTS,
  DEFAULT_RUNG2_WEIGHTS,
  type PolicyWeights,
  type Rung2Weights,
  type ValueWeights,
} from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { computeCpLoss } from '../engine/classify';
import { median, normalize } from './quality';
import { SfCachePool } from './sf-cache';

interface Cfg {
  input: string;
  offset: number;
  positions: number;
  depths: number[];
  sfDepth: number;
  engines: string[];
  policy: string;
  cache: string;
  concurrency: number;
}

const DEFAULT_CONFIG: Cfg = {
  input: 'arena/out/combined-multipv.jsonl',
  offset: 543,
  positions: 95,
  depths: [2, 3, 4],
  sfDepth: 10,
  engines: ['default', 'mixed'],
  policy: 'arena/out/weights.json',
  cache: 'arena/out/sf-eval-cache.jsonl',
  concurrency: 2,
};

// Named engines differ only in the VALUE head (policy is shared via --policy), so
// the matrix isolates the value/rung2 contribution exactly like the gate did.
const ENGINE_VALUE_PATHS: Record<string, { base: string; rung2: string }> = {
  default: { base: 'default', rung2: 'default' },
  mixed: { base: 'arena/out/value-weights-mixed.json', rung2: 'arena/out/rung2-weights-mixed.json' },
  regression: { base: 'arena/out/value-weights.json', rung2: 'default' },
  ranking: { base: 'arena/out/value-weights-ranking.json', rung2: 'default' },
};

const loadJson = <T,>(p: string, d: T): T => (p === 'default' ? d : (JSON.parse(readFileSync(p, 'utf8')) as T));

interface Report {
  depth: number;
  engine: string;
  scored: number;
  top1: number;
  avgCpLoss: number;
  medianCpLoss: number;
  blunderRate: number;
  mateMissed: number;
  illegal: number;
  elapsedMs: number;
  nodes: number;
}

// SfCachePool lives in ./sf-cache (side-effect-free) so other harnesses can
// import it WITHOUT triggering this script's auto-run below.

async function parallelMap<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!, idx);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  return out;
}

export async function runMatrix(cfg: Cfg = DEFAULT_CONFIG, log: (m: string) => void = (m) => console.log(m)): Promise<Report[]> {
  const all = loadDataset(cfg.input);
  const slice = all.slice(cfg.offset, cfg.offset + cfg.positions);
  const policy = loadJson<PolicyWeights>(cfg.policy, DEFAULT_POLICY_WEIGHTS);

  const engines = cfg.engines.map((name) => {
    const paths = ENGINE_VALUE_PATHS[name];
    if (!paths) throw new Error(`unknown engine '${name}' (known: ${Object.keys(ENGINE_VALUE_PATHS).join(', ')})`);
    const base = loadJson<ValueWeights>(paths.base, DEFAULT_VALUE_WEIGHTS);
    const rung2 = loadJson<Rung2Weights>(paths.rung2, DEFAULT_RUNG2_WEIGHTS);
    return { name, engine: new CvsEngine({ weights: policy, valueWeights: base, rung2Weights: rung2 }) };
  });

  mkdirSync(dirname(cfg.cache), { recursive: true });
  // The single-threaded Stockfish WASM build is ONE instance per process, so we
  // run a single SF engine. --concurrency only governs request fan-out (calls
  // still serialize on the one engine, which is fine — the win here is the eval
  // CACHE, not SF parallelism; true parallel SF would need separate processes).
  const sfEngines = [new UciEngine(await createNodeStockfishTransport())];
  const pool = new SfCachePool(sfEngines, cfg.sfDepth, cfg.cache);

  const reports: Report[] = [];
  try {
    log(`eval-matrix: ${slice.length} positions [${cfg.offset}..${cfg.offset + cfg.positions}), depths ${cfg.depths.join('/')}, SF depth ${cfg.sfDepth}, engines [${cfg.engines.join(', ')}], concurrency ${cfg.concurrency}`);
    log(`cache: ${cfg.cache} (${pool.cachedCount} entries loaded)`);

    // Phase 1: pay every "before" eval once (parallel across the SF pool, cached).
    log(`scoring ${slice.length} "before" evals (cached)…`);
    await parallelMap(slice, cfg.concurrency, (pos) => pool.evalFen(pos.fen));

    // Phase 2: engines × depths. CVS searches are CPU-bound/serial; SF "after" evals are cached + pooled.
    for (const depth of cfg.depths) {
      for (const { name, engine } of engines) {
        const t0 = Date.now();
        let nodes = 0;
        const losses: number[] = [];
        let top1 = 0;
        let mateMissed = 0;
        let illegal = 0;
        for (const pos of slice) {
          const before = await pool.evalFen(pos.fen);
          if (before.status === 'unavailable' || !before.pv?.[0]) continue;
          const res = engine.analyze(pos.fen, { depth });
          const pick = res.bestMove ?? engine.predict(pos.fen, 1)[0];
          nodes += res.nodes;
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
          const after = await pool.evalFen(fenAfter);
          const loss = Math.max(0, computeCpLoss(before, after));
          losses.push(loss);
          if (before.mate !== undefined && before.mate > 0 && !(after.mate !== undefined && after.mate < 0) && loss >= 2) {
            mateMissed += 1;
          }
        }
        reports.push({
          depth,
          engine: name,
          scored: losses.length,
          top1: slice.length ? top1 / slice.length : 0,
          avgCpLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
          medianCpLoss: median(losses),
          blunderRate: losses.length ? losses.filter((l) => l >= 2).length / losses.length : 0,
          mateMissed,
          illegal,
          elapsedMs: Date.now() - t0,
          nodes,
        });
      }
    }
  } finally {
    for (const e of sfEngines) e.dispose();
  }

  // One table.
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  log(`\n| Depth | Engine | Top-1 | Avg cpLoss | Median | Blunder % | Mate missed | Illegal | Time(s) | Nodes |`);
  log(`|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of reports) {
    log(
      `| ${r.depth} | ${r.engine} | ${pct(r.top1)} | ${r.avgCpLoss.toFixed(3)} | ${r.medianCpLoss.toFixed(3)} | ${pct(r.blunderRate)} | ${r.mateMissed} | ${r.illegal} | ${(r.elapsedMs / 1000).toFixed(1)} | ${r.nodes} |`,
    );
  }
  return reports;
}

function parseArgs(argv: string[]): Cfg {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--input') cfg.input = next();
    else if (a === '--offset') cfg.offset = Number(next()) || 0;
    else if (a === '--positions') cfg.positions = Number(next()) || cfg.positions;
    else if (a === '--depths') cfg.depths = next().split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
    else if (a === '--sf-depth') cfg.sfDepth = Number(next()) || cfg.sfDepth;
    else if (a === '--engines') cfg.engines = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--policy') cfg.policy = next();
    else if (a === '--cache') cfg.cache = next();
    else if (a === '--concurrency') cfg.concurrency = Number(next()) || cfg.concurrency;
  }
  return cfg;
}

if (!process.env.VITEST) {
  runMatrix(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('eval-matrix failed:', e);
    process.exit(1);
  });
}
