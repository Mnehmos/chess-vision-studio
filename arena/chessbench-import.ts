// ChessBench importer (FEN-seed mode). Pulls diverse real positions from the
// heidar-an/ChessBench HF mirror via the datasets-server rows API and labels each
// with LOCAL Stockfish (best move), writing @cvs/engine "predict Stockfish's move"
// rows. ChessBench is used only as a source of diverse FENs; labels come from our
// own oracle so they match the benchmark (and avoid the noisy one-move-per-row
// problem of the mirror).
//
// TODO(chessbench-full): prdev/chessbench-full-policy-value has per-position ALL
// legal moves + Stockfish evals — ideal for the move-quality target — but its HF
// Dataset Viewer is currently broken ("no supported data files"), so it can't be
// sliced via the rows API. Revisit via direct parquet download + a parquet reader,
// or DeepMind's bagz format, when bulk per-position action-values are needed.
import { mkdirSync, appendFileSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { dirname } from 'node:path';
import { Chess } from 'chess.js';
import { buildTrainingPosition } from '@cvs/engine';
import type { TrainingPosition } from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';

const ROWS_API = 'https://datasets-server.huggingface.co/rows';

export interface ChessbenchConfig {
  dataset: string;
  config: string;
  split: string;
  out: string;
  positions: number;
  offset: number;
  depth: number;
  source: TrainingPosition['source'];
}

const DEFAULT_CONFIG: ChessbenchConfig = {
  dataset: 'heidar-an/ChessBench',
  config: 'default',
  split: 'train',
  out: 'arena/out/chessbench-dataset.jsonl',
  positions: 500,
  offset: 0,
  depth: 10,
  source: 'master_game',
};

interface RowsResponse {
  rows: { row: { fen: string; move_uci?: string; value?: number } }[];
  num_rows_total: number;
}

/** Distinct, unseen FENs from a page of rows (the mirror lists one move per row). */
export function distinctFens(rows: { fen: string }[], seen: Set<string>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const fen = r.fen?.trim();
    if (!fen || seen.has(fen)) continue;
    seen.add(fen);
    out.push(fen);
  }
  return out;
}

async function fetchPage(cfg: ChessbenchConfig, offset: number): Promise<{ fens: { fen: string }[]; total: number }> {
  const url =
    `${ROWS_API}?dataset=${encodeURIComponent(cfg.dataset)}` +
    `&config=${encodeURIComponent(cfg.config)}&split=${encodeURIComponent(cfg.split)}` +
    `&offset=${offset}&length=100`;
  const json = (await httpGetJson(url)) as RowsResponse;
  return { fens: json.rows.map((r) => ({ fen: r.row.fen })), total: json.num_rows_total };
}

/** Minimal HTTPS GET → parsed JSON (no dependency on a global fetch). */
function httpGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'User-Agent': 'cvs-chessbench-import', Accept: 'application/json' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 400) {
        res.resume();
        reject(new Error(`rows API HTTP ${status} @ ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

export async function importChessbench(
  cfg: ChessbenchConfig = DEFAULT_CONFIG,
  log: (m: string) => void = (m) => console.log(m),
): Promise<{ positions: number }> {
  mkdirSync(dirname(cfg.out), { recursive: true });
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  const seen = new Set<string>();
  let written = 0;
  let offset = cfg.offset;
  let total = Infinity;
  try {
    while (written < cfg.positions && offset < total) {
      const { fens, total: t } = await fetchPage(cfg, offset);
      total = t;
      offset += 100;
      if (fens.length === 0) break;
      for (const fen of distinctFens(fens, seen)) {
        if (written >= cfg.positions) break;
        let bestSan: string | undefined;
        let cp: number | undefined;
        let mate: number | undefined;
        let evalDepth = cfg.depth;
        try {
          const e = await sf.evaluate({ fen, depth: cfg.depth });
          if (e.status === 'unavailable') continue;
          bestSan = e.pv?.[0]; // UciEngine returns the PV in SAN
          cp = e.cp;
          mate = e.mate;
          evalDepth = e.depth;
        } catch {
          continue;
        }
        if (!bestSan) continue;
        // Stockfish cp/mate are side-to-move POV; the value-head regression target
        // (evalBefore) is stored in WHITE POV so all targets share one convention.
        const stm = new Chess(fen).turn();
        const evalBefore = typeof cp === 'number' ? (stm === 'w' ? cp : -cp) : undefined;
        let bestUci = '';
        try {
          bestUci = new Chess(fen).move(bestSan)?.lan ?? '';
        } catch {
          bestUci = '';
        }
        let row: TrainingPosition | null = null;
        try {
          row = buildTrainingPosition(fen, bestSan, {
            bestMove: bestSan,
            evalBefore,
            cpLoss: 0,
            topMoves: [{ san: bestSan, uci: bestUci, cp, mate, depth: evalDepth }],
            source: cfg.source,
          });
        } catch {
          row = null;
        }
        if (row) {
          appendFileSync(cfg.out, JSON.stringify(row) + '\n', 'utf8');
          written += 1;
          if (written % 25 === 0) log(`labeled ${written}/${cfg.positions} positions (offset ${offset}/${total})`);
        }
      }
    }
    log(`done: ${written} positions -> ${cfg.out}`);
    return { positions: written };
  } finally {
    sf.dispose();
  }
}

function parseArgs(argv: string[]): ChessbenchConfig {
  const cfg = { ...DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--out') cfg.out = next();
    else if (a === '--positions') cfg.positions = Number(next()) || cfg.positions;
    else if (a === '--offset') cfg.offset = Number(next()) || cfg.offset;
    else if (a === '--depth') cfg.depth = Number(next()) || cfg.depth;
    else if (a === '--dataset') cfg.dataset = next();
    else if (a === '--help' || a === '-h') {
      console.log('Usage: npm run chessbench:import -- [--positions 500] [--offset 0] [--depth 10] [--out arena/out/chessbench-dataset.jsonl]');
      process.exit(0);
    }
  }
  return cfg;
}

if (!process.env.VITEST) {
  importChessbench(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('chessbench import failed:', e);
    process.exit(1);
  });
}
