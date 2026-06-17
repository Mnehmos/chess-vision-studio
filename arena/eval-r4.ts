// R4 gate — Rust engine vs TS engine vs the Stockfish scorer.
//
// Treats the Rust engine as an external move backend (its `analyze` CLI emits
// JSONL picks per FEN) and scores BOTH engines' searched moves with the same
// cached Stockfish depth-24 oracle. Two questions:
//   1. Parity: Rust d2–d4 should match TS d2–d4 (R3 showed exact search parity).
//   2. Superiority: Rust d5/d6 (depths TS can't afford) should improve cpLoss /
//      blunder profile on the holdout AND the independent slice.
//
//   npm run eval:r4
//
// Engine adapter work only — no TS engine capability changes (legacy/reference).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import {
  CvsEngine,
  loadDataset,
  DEFAULT_POLICY_WEIGHTS,
  type Rung2Weights,
  type TrainingPosition,
  type ValueWeights,
} from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { computeCpLoss } from '../engine/classify';
import { median, normalize } from './quality';
import { SfCachePool } from './sf-cache';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from './review-config';

const CFG = {
  input: 'arena/out/combined-multipv.jsonl',
  holdoutOffset: 543,
  holdoutCount: 95,
  unseenOffset: 603, // the gate-independent slice (subset of holdout, never used by any keep-gate)
  unseenCount: 35,
  tsDepths: [2, 3, 4],
  rustDepths: [2, 3, 4, 5, 6],
  sfDepth: DEFAULT_STOCKFISH_REVIEW_DEPTH,
  cache: 'arena/out/sf-eval-cache.jsonl',
  rustExe: '../chess-vision-studio-rust-engine/target/release/analyze.exe',
  baseWeights: 'arena/out/value-weights-mixed.json',
  rung2Weights: 'arena/out/rung2-weights-mixed.json',
  fensTmp: 'arena/out/r4-fens.txt',
  out: 'arena/reports/engine-training/r4-gate.md',
};

interface Pick {
  uci: string;
  timeMs: number;
  nodes: number;
}

interface Row {
  engine: string;
  depth: number;
  slice: string;
  scored: number;
  top1: number;
  avgCpLoss: number;
  medianCpLoss: number;
  blunderRate: number;
  mateMissed: number;
  illegal: number;
  moveTimeMs: number; // total engine think time for the slice
}

function rustPicks(fens: string[], depth: number): Map<string, Pick> {
  writeFileSync(CFG.fensTmp, fens.join('\n') + '\n', 'utf8');
  const out = execFileSync(CFG.rustExe, [
    '--fens', CFG.fensTmp,
    '--depth', String(depth),
    '--base', CFG.baseWeights,
    '--rung2', CFG.rung2Weights,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const picks = new Map<string, Pick>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { fen: string; uci?: string; timeMs?: number; nodes?: number; error?: string };
    if (o.uci) picks.set(o.fen, { uci: o.uci, timeMs: o.timeMs ?? 0, nodes: o.nodes ?? 0 });
  }
  return picks;
}

// The TS engine is a FROZEN legacy reference: its picks never change, so they are
// measured once and persisted. Subsequent runs load this cache and skip the slow
// TS searches entirely (only Rust + the Stockfish scorer execute).
const TS_PICKS_CACHE = 'arena/out/ts-picks-cache.json';

function loadTsPickCache(): Record<string, Pick> {
  try {
    return JSON.parse(readFileSync(TS_PICKS_CACHE, 'utf8')) as Record<string, Pick>;
  } catch {
    return {};
  }
}

function tsPicks(fens: string[], depth: number, engine: CvsEngine, cache: Record<string, Pick>): { picks: Map<string, Pick>; fromCache: boolean } {
  const picks = new Map<string, Pick>();
  let missing = false;
  for (const fen of fens) {
    const hit = cache[`${fen}@${depth}`];
    if (hit) picks.set(fen, hit);
    else missing = true;
  }
  if (!missing) return { picks, fromCache: true };
  picks.clear();
  for (const fen of fens) {
    const t0 = Date.now();
    const mv = engine.bestMove(fen, { depth });
    if (mv) {
      const p = { uci: mv.uci, timeMs: Date.now() - t0, nodes: 0 };
      picks.set(fen, p);
      cache[`${fen}@${depth}`] = p;
    }
  }
  writeFileSync(TS_PICKS_CACHE, JSON.stringify(cache, null, 1), 'utf8');
  return { picks, fromCache: false };
}

async function scorePicks(
  label: { engine: string; depth: number; slice: string },
  positions: TrainingPosition[],
  picks: Map<string, Pick>,
  pool: SfCachePool,
): Promise<Row> {
  const losses: number[] = [];
  let top1 = 0;
  let mateMissed = 0;
  let illegal = 0;
  let moveTimeMs = 0;
  for (const pos of positions) {
    const before = await pool.evalFen(pos.fen);
    if (before.status === 'unavailable' || !before.pv?.[0]) continue;
    const pick = picks.get(pos.fen);
    if (!pick) continue;
    moveTimeMs += pick.timeMs;
    const chess = new Chess(pos.fen);
    let fenAfter: string | null = null;
    let san = '';
    try {
      const m = chess.move({ from: pick.uci.slice(0, 2), to: pick.uci.slice(2, 4), promotion: pick.uci.slice(4) || undefined });
      if (m) {
        fenAfter = chess.fen();
        san = m.san;
      }
    } catch {
      fenAfter = null;
    }
    if (!fenAfter) {
      illegal += 1;
      continue;
    }
    if (normalize(san) === normalize(before.pv[0])) top1 += 1;
    const after = await pool.evalFen(fenAfter);
    const loss = Math.max(0, computeCpLoss(before, after));
    losses.push(loss);
    if (before.mate !== undefined && before.mate > 0 && !(after.mate !== undefined && after.mate < 0) && loss >= 2) {
      mateMissed += 1;
    }
  }
  return {
    ...label,
    scored: losses.length,
    top1: positions.length ? top1 / positions.length : 0,
    avgCpLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
    medianCpLoss: median(losses),
    blunderRate: losses.length ? losses.filter((l) => l >= 2).length / losses.length : 0,
    mateMissed,
    illegal,
    moveTimeMs,
  };
}

async function main(): Promise<void> {
  const all = loadDataset(CFG.input);
  const holdout = all.slice(CFG.holdoutOffset, CFG.holdoutOffset + CFG.holdoutCount);
  const unseen = all.slice(CFG.unseenOffset, CFG.unseenOffset + CFG.unseenCount);
  const fens = holdout.map((p) => p.fen);
  const base = JSON.parse(readFileSync(CFG.baseWeights, 'utf8')) as ValueWeights;
  const rung2 = JSON.parse(readFileSync(CFG.rung2Weights, 'utf8')) as Rung2Weights;
  const tsEngine = new CvsEngine({ weights: DEFAULT_POLICY_WEIGHTS, valueWeights: base, rung2Weights: rung2 });

  console.log(`R4 gate: holdout ${holdout.length} [${CFG.holdoutOffset}..${CFG.holdoutOffset + CFG.holdoutCount}), unseen ${unseen.length} [${CFG.unseenOffset}..${CFG.unseenOffset + CFG.unseenCount}), SF depth ${CFG.sfDepth}`);

  // 1) Collect picks. Rust first (fast), then TS (the slow part).
  const rustByDepth = new Map<number, Map<string, Pick>>();
  for (const d of CFG.rustDepths) {
    const t0 = Date.now();
    rustByDepth.set(d, rustPicks(fens, d));
    console.log(`rust picks d${d}: ${rustByDepth.get(d)!.size} moves in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  const tsCache = loadTsPickCache();
  const tsByDepth = new Map<number, Map<string, Pick>>();
  for (const d of CFG.tsDepths) {
    const t0 = Date.now();
    const { picks, fromCache } = tsPicks(fens, d, tsEngine, tsCache);
    tsByDepth.set(d, picks);
    console.log(`ts picks d${d}: ${picks.size} moves in ${((Date.now() - t0) / 1000).toFixed(1)}s${fromCache ? ' (cached — TS reference measured once, reused)' : ''}`);
  }

  // 2) Direct move agreement at shared depths (R3 parity prediction).
  console.log('\n## TS vs Rust move agreement (same depth, same weights)');
  for (const d of CFG.tsDepths) {
    const ts = tsByDepth.get(d)!;
    const ru = rustByDepth.get(d)!;
    let same = 0;
    let total = 0;
    const diffs: string[] = [];
    for (const [fen, tp] of ts) {
      const rp = ru.get(fen);
      if (!rp) continue;
      total++;
      if (rp.uci === tp.uci) same++;
      else if (diffs.length < 8) diffs.push(`  d${d} ${fen.split(' ')[0]} ts:${tp.uci} rust:${rp.uci}`);
    }
    console.log(`depth ${d}: ${same}/${total} identical moves (${((100 * same) / Math.max(1, total)).toFixed(1)}%)`);
    for (const x of diffs) console.log(x);
  }

  // 3) Stockfish-score everything through the shared cache.
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  const pool = new SfCachePool([sf], CFG.sfDepth, CFG.cache);
  const rows: Row[] = [];
  try {
    for (const d of CFG.tsDepths) {
      rows.push(await scorePicks({ engine: 'TS', depth: d, slice: 'holdout' }, holdout, tsByDepth.get(d)!, pool));
    }
    for (const d of CFG.rustDepths) {
      rows.push(await scorePicks({ engine: 'Rust', depth: d, slice: 'holdout' }, holdout, rustByDepth.get(d)!, pool));
    }
    for (const d of [3, 5, 6]) {
      rows.push(await scorePicks({ engine: 'Rust', depth: d, slice: 'unseen' }, unseen, rustByDepth.get(d)!, pool));
    }
    for (const d of CFG.tsDepths) {
      rows.push(await scorePicks({ engine: 'TS', depth: d, slice: 'unseen' }, unseen, tsByDepth.get(d)!, pool));
    }
  } finally {
    sf.dispose();
  }

  // 4) Report.
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`| Engine | Depth | Slice | Top-1 | Avg cpLoss | Median | Blunder % | Mate missed | Illegal | Think time(s) |`);
  lines.push(`|---|---:|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of rows) {
    lines.push(
      `| ${r.engine} | ${r.depth} | ${r.slice} | ${pct(r.top1)} | ${r.avgCpLoss.toFixed(3)} | ${r.medianCpLoss.toFixed(3)} | ${pct(r.blunderRate)} | ${r.mateMissed} | ${r.illegal} | ${(r.moveTimeMs / 1000).toFixed(1)} |`,
    );
  }
  const table = lines.join('\n');
  console.log('\n' + table);

  // Forensic 549 callout (it sits inside the holdout slice).
  const fen549 = all[549]!.fen;
  console.log('\n## Forensic #549 (d4/d5 horizon case) — Rust moves');
  for (const d of CFG.rustDepths) {
    const p = rustByDepth.get(d)!.get(fen549);
    console.log(`  d${d}: ${p?.uci ?? '(none)'}`);
  }

  mkdirSync('arena/reports/engine-training', { recursive: true });
  writeFileSync(CFG.out, `# R4 gate — Rust vs TS vs Stockfish scorer\n\n${table}\n`, 'utf8');
  console.log(`\nreport: ${CFG.out}`);
}

main().catch((e) => {
  console.error('eval-r4 failed:', e);
  process.exit(1);
});
