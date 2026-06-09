// Search hot-path microbenchmark for the forensic positions. Reports, per
// (engine, position, depth): time, nodes, qNodes, nodes/sec, qNodes/sec, best
// move, eval score. The best-move + score columns double as a PARITY KEY: run
// before and after a perf change and diff the "PARITY" lines — they must be
// identical (semantics preserved). Pure CVS (no Stockfish).
//
//   npm run bench:search -- --tag before        # baseline
//   npm run bench:search -- --tag after          # after a perf change, then diff
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import {
  Searcher,
  evaluate,
  DEFAULT_VALUE_WEIGHTS,
  DEFAULT_RUNG2_WEIGHTS,
  type Rung2Weights,
  type ValueWeights,
} from '@cvs/engine';

const j = <T,>(p: string, d: T): T => {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return d;
  }
};

// Forensic positions: index 549 is the d4/d5 horizon-blunder case.
const POSITIONS: { name: string; fen: string }[] = [
  { name: '549-d4d5-blunder', fen: '5r2/pp5R/1kp3p1/6b1/4P1b1/1BNP2P1/PPP4P/1K6 w - - 1 22' },
  { name: 'startpos', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: 'midgame-r1', fen: '4r1k1/1p3pp1/p1p3rp/P1Qnq3/1PB5/4P3/5PPP/3R1RK1 b - - 5 27' },
];

interface Cfg {
  tag: string;
  depths: number[];
}
const DEFAULT_CONFIG: Cfg = { tag: 'bench', depths: [2, 3, 4] };

export function runBench(cfg: Cfg = DEFAULT_CONFIG, log: (m: string) => void = (m) => console.log(m)): void {
  const base = j<ValueWeights>('arena/out/value-weights-mixed.json', DEFAULT_VALUE_WEIGHTS);
  const rung2 = j<Rung2Weights>('arena/out/rung2-weights-mixed.json', DEFAULT_RUNG2_WEIGHTS);
  // Mirror CvsEngine's wiring exactly: default uses the handcrafted eval; mixed
  // injects the trained value+rung2 leaf evaluator. Searcher exposes full telemetry.
  const engines: { name: string; searcher: Searcher }[] = [
    { name: 'default', searcher: new Searcher() },
    { name: 'mixed', searcher: new Searcher((c) => evaluate(c, base, rung2)) },
  ];

  log(`# bench:search tag=${cfg.tag} depths=${cfg.depths.join(',')}`);
  log(`| Engine | Position | Depth | Time(ms) | Nodes | qNodes | Nodes/s | qNodes/s | Best | Score |`);
  log(`|---|---|---:|---:|---:|---:|---:|---:|---|---:|`);
  const parity: string[] = [];
  for (const { name, searcher } of engines) {
    for (const pos of POSITIONS) {
      for (const depth of cfg.depths) {
        // Warm a fresh search each time; measure wall-clock around the call.
        new Chess(pos.fen); // validate FEN early (throws on bad input)
        const t0 = Date.now();
        const r = searcher.search(pos.fen, { depth });
        const ms = Date.now() - t0;
        const q = r.telemetry?.qNodes ?? 0;
        const nps = ms > 0 ? Math.round((r.nodes / ms) * 1000) : 0;
        const qps = ms > 0 ? Math.round((q / ms) * 1000) : 0;
        const best = r.bestMove?.uci ?? '(none)';
        log(`| ${name} | ${pos.name} | ${depth} | ${ms} | ${r.nodes} | ${q} | ${nps} | ${qps} | ${best} | ${r.scoreCp} |`);
        parity.push(`PARITY ${name}|${pos.name}|d${depth} => ${best}@${r.scoreCp}`);
      }
    }
  }
  log('');
  for (const p of parity) log(p);
}

function parseArgs(argv: string[]): Cfg {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--tag') cfg.tag = next();
    else if (a === '--depths') cfg.depths = next().split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
  }
  return cfg;
}

if (!process.env.VITEST) {
  runBench(parseArgs(process.argv.slice(2)));
}
