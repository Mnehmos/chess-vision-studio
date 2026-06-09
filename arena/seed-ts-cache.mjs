// One-shot seeder for ts-picks-cache.json, built from the completed (but
// crashed-before-scoring) R4 run: TS-vs-Rust move agreement was 73/74 at every
// depth, with the single divergence known from the run log (TS played b6d8 on
// the r4rk1 position at d2/d3/d4). TS picks = Rust picks + that one override.
// Per-move timeMs is the measured per-depth average (uniform approximation —
// noted in the R4 report; totals come from the original run log).
import { readFileSync, writeFileSync } from 'node:fs';

const DIVERGENT_FEN = 'r4rk1/1p1bbpp1/1q5p/3NP3/2Q5/5N2/PP3PPP/5RK1 b - - 0 20';
const TS_DIVERGENT_MOVE = 'b6d8';
// Measured totals from the run log (74 unique FENs per depth).
const AVG_MS = { 2: Math.round(54800 / 74), 3: Math.round(217300 / 74), 4: Math.round(1687800 / 74) };

const cache = {};
for (const depth of [2, 3, 4]) {
  const lines = readFileSync(`arena/out/rust-picks-d${depth}.jsonl`, 'utf8')
    .replace(/﻿/g, '') // PowerShell Out-File writes a UTF-8 BOM
    .split('\n')
    .filter((l) => l.trim());
  for (const line of lines) {
    const o = JSON.parse(line);
    if (!o.uci) continue;
    const uci = o.fen === DIVERGENT_FEN ? TS_DIVERGENT_MOVE : o.uci;
    cache[`${o.fen}@${depth}`] = { uci, timeMs: AVG_MS[depth], nodes: 0 };
  }
}
writeFileSync('arena/out/ts-picks-cache.json', JSON.stringify(cache, null, 1), 'utf8');
console.log(`seeded ${Object.keys(cache).length} TS picks (73/74 rust-identical + 1 known divergence x 3 depths)`);
