// One-shot dataset relabel: add Stockfish position evals to an existing JSONL
// dataset whose rows predate the value-head importer change. Reuses the FENs
// already in the dataset (no network) and labels each with LOCAL Stockfish, so
// the value-head trainer (which regresses the eval toward SF) has targets.
//
// Adds, per row that lacks them:
//   - evalBefore: WHITE-POV centipawns (SF cp is side-to-move POV; negated for Black)
//   - topMoves[0]: { san, uci, cp, mate, depth } for the SF best move (mate fallback target)
// Idempotent: rows that already have evalBefore are left untouched. Writes to a
// NEW file by default so the original dataset is preserved.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Chess } from 'chess.js';
import type { TrainingPosition } from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';

export interface RelabelConfig {
  input: string;
  out: string;
  depth: number;
}

const DEFAULT_CONFIG: RelabelConfig = {
  input: 'arena/out/combined-dataset.jsonl',
  out: 'arena/out/combined-evals.jsonl',
  depth: 10,
};

export async function relabel(
  cfg: RelabelConfig = DEFAULT_CONFIG,
  log: (m: string) => void = (m) => console.log(m),
): Promise<{ labeled: number; total: number }> {
  const lines = readFileSync(cfg.input, 'utf8').split('\n').filter((l) => l.trim());
  const rows: TrainingPosition[] = lines.map((l) => JSON.parse(l));
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  let labeled = 0;
  try {
    for (const row of rows) {
      if (typeof row.evalBefore === 'number') continue;
      let e;
      try {
        e = await sf.evaluate({ fen: row.fen, depth: cfg.depth });
      } catch {
        continue;
      }
      if (e.status === 'unavailable') continue;
      const stm = new Chess(row.fen).turn();
      if (typeof e.cp === 'number') row.evalBefore = stm === 'w' ? e.cp : -e.cp;
      const bestSan = e.pv?.[0] ?? row.bestMove ?? row.playedMove;
      let bestUci = '';
      try {
        bestUci = new Chess(row.fen).move(bestSan)?.lan ?? '';
      } catch {
        bestUci = '';
      }
      if (!row.topMoves || row.topMoves.length === 0) {
        row.topMoves = [{ san: bestSan, uci: bestUci, cp: e.cp, mate: e.mate, depth: e.depth }];
      }
      labeled += 1;
      if (labeled % 50 === 0) log(`labeled ${labeled}/${rows.length}…`);
    }
    mkdirSync(dirname(cfg.out), { recursive: true });
    writeFileSync(cfg.out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    log(`done: ${labeled} newly labeled, ${rows.length} total -> ${cfg.out}`);
    return { labeled, total: rows.length };
  } finally {
    sf.dispose();
  }
}

function parseArgs(argv: string[]): RelabelConfig {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--input') cfg.input = next();
    else if (a === '--out') cfg.out = next();
    else if (a === '--depth') cfg.depth = Number(next()) || cfg.depth;
  }
  return cfg;
}

if (!process.env.VITEST) {
  relabel(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('relabel failed:', e);
    process.exit(1);
  });
}
