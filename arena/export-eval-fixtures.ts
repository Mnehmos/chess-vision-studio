// Eval-parity fixture exporter (legacy TS engine → Rust engine port).
// Reads FENs from the multipv dataset + a curated battery, computes the TS
// reference evaluateWhiteFloat under (a) default weights and (b) the trained
// mixed base+Rung-2 weights, and writes a JSON fixture the Rust `eval_parity`
// binary consumes. This is reference/fixture export ONLY — no engine changes.
//
//   npm run export:eval-fixtures
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Chess } from 'chess.js';
import {
  evaluateWhiteFloat,
  loadDataset,
  DEFAULT_VALUE_WEIGHTS,
  DEFAULT_RUNG2_WEIGHTS,
  type Rung2Weights,
  type ValueWeights,
} from '@cvs/engine';

const OUT = 'arena/out/eval-parity-fixtures.json';

const BATTERY = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  '4k3/8/8/8/8/8/8/3QK3 w - - 0 1',
  'r3k3/8/8/8/8/8/8/4K3 b - - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  '8/2k5/8/8/3K4/8/5R2/8 w - - 0 1',
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
  '5r2/pp5R/1kp3p1/6b1/4P1b1/1BNP2P1/PPP4P/1K6 w - - 1 22', // the d4 forensic position
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', // kiwipete
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
  '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
  'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
];

const base = JSON.parse(readFileSync('arena/out/value-weights-mixed.json', 'utf8')) as ValueWeights;
const rung2 = JSON.parse(readFileSync('arena/out/rung2-weights-mixed.json', 'utf8')) as Rung2Weights;

const dataset = loadDataset('arena/out/combined-multipv.jsonl').map((p) => p.fen);
const seen = new Set<string>();
const fens = [...BATTERY, ...dataset].filter((f) => {
  if (seen.has(f)) return false;
  seen.add(f);
  return true;
});

const positions = fens.map((fen) => {
  const c = new Chess(fen);
  return {
    fen,
    default: evaluateWhiteFloat(c, DEFAULT_VALUE_WEIGHTS),
    mixed: evaluateWhiteFloat(c, base, rung2),
  };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ baseWeights: base, rung2Weights: rung2, positions }, null, 1), 'utf8');
console.log(`wrote ${positions.length} fixtures -> ${OUT}`);
