// Offline Lichess open-database importer. Streams decompressed PGN, filters for
// strong standard games, reviews every selected ply with Stockfish, and appends
// @cvs/engine training rows with source "master_game".
import { createReadStream, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Chess } from 'chess.js';
import type { TrainingPosition } from '@cvs/engine';
import { UciEngine } from '../../engine/evaluation';
import { createNodeStockfishTransport } from '../../engine/stockfish-node';
import { reviewGame } from '../review';
import { reviewedToTraining } from '../dataset';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from '../review-config';
import type { PlayedPly } from '../match';

export interface ImportConfig {
  input: string;
  out: string;
  depth: number;
  limit: number;
  maxPlies: number;
  minElo: number;
  sampleEvery: number;
}

interface ImportGame {
  headers: Record<string, string>;
  plies: PlayedPly[];
}

interface Counters {
  seen: number;
  imported: number;
  skipped: number;
  rows: number;
}

const DEFAULT_CONFIG: ImportConfig = {
  input: '-',
  out: 'arena/out/lichess-master-dataset.jsonl',
  depth: DEFAULT_STOCKFISH_REVIEW_DEPTH,
  limit: 50,
  maxPlies: 80,
  minElo: 2200,
  sampleEvery: 1,
};

function headersFromPgn(chunk: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const m of chunk.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) headers[m[1]] = m[2];
  return headers;
}

function toUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function parseImportGame(chunk: string): ImportGame | null {
  const headers = headersFromPgn(chunk);
  const chess = new Chess();
  try {
    chess.loadPgn(chunk);
  } catch {
    return null;
  }

  const replay = new Chess();
  const plies: PlayedPly[] = [];
  const history = chess.history({ verbose: true }) as Array<{
    san: string;
    color: 'w' | 'b';
    from: string;
    to: string;
    promotion?: string;
  }>;

  for (const move of history) {
    const by = replay.turn() === 'w' ? 'white' : 'black';
    const fenBefore = replay.fen();
    let moved: { san: string } | null;
    try {
      moved = replay.move(move.san);
    } catch {
      moved = null;
    }
    if (!moved) return null;
    plies.push({
      ply: plies.length + 1,
      by,
      player: by === 'white' ? (headers.White ?? 'white') : (headers.Black ?? 'black'),
      fenBefore,
      san: moved.san,
      uci: toUci(move),
      fenAfter: replay.fen(),
    });
  }

  return plies.length > 0 ? { headers, plies } : null;
}

function numericHeader(headers: Record<string, string>, key: string): number | null {
  const raw = headers[key];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shouldImportGame(game: ImportGame, cfg: ImportConfig): boolean {
  const variant = game.headers.Variant;
  if (variant && variant.toLowerCase() !== 'standard') return false;
  if (game.plies.length === 0) return false;
  if (cfg.minElo > 0) {
    const whiteElo = numericHeader(game.headers, 'WhiteElo');
    const blackElo = numericHeader(game.headers, 'BlackElo');
    if (whiteElo === null || blackElo === null) return false;
    if (Math.min(whiteElo, blackElo) < cfg.minElo) return false;
  }
  return true;
}

async function* pgnChunks(input: string): AsyncGenerator<string> {
  const stream = input === '-' ? process.stdin : createReadStream(input, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let current: string[] = [];
  let sawMoves = false;

  for await (const line of rl) {
    if (/^\[Event\b/.test(line) && sawMoves) {
      yield current.join('\n');
      current = [line];
      sawMoves = false;
    } else {
      current.push(line);
      if (line.trim() && !line.startsWith('[')) sawMoves = true;
    }
  }
  if (current.some((line) => line.trim())) yield current.join('\n');
}

function parseArgs(argv: string[]): ImportConfig {
  const cfg = { ...DEFAULT_CONFIG };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--out') cfg.out = next();
    else if (a === '--depth') cfg.depth = Number(next()) || cfg.depth;
    else if (a === '--limit') cfg.limit = Number(next()) || cfg.limit;
    else if (a === '--max-plies') cfg.maxPlies = Number(next()) || cfg.maxPlies;
    else if (a === '--min-elo') cfg.minElo = Number(next()) || 0;
    else if (a === '--sample-every') cfg.sampleEvery = Math.max(1, Number(next()) || cfg.sampleEvery);
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
  npm run lichess:import -- <games.pgn|-> [--out arena/out/lichess-master-dataset.jsonl]
    [--depth 24] [--limit 50] [--max-plies 80] [--min-elo 2200] [--sample-every 1]

Examples:
  zstd -dc lichess_db_standard_rated_2026-05.pgn.zst | npm run lichess:import -- -
  npm run lichess:import -- master-games.pgn --limit 200 --min-elo 2400`);
}

export async function importLichessDatabase(
  cfg: ImportConfig,
  log: (m: string) => void = (m) => console.log(m),
): Promise<Counters> {
  mkdirSync(dirname(cfg.out), { recursive: true });
  const counters: Counters = { seen: 0, imported: 0, skipped: 0, rows: 0 };
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  try {
    for await (const chunk of pgnChunks(cfg.input)) {
      counters.seen += 1;
      if (cfg.sampleEvery > 1 && counters.seen % cfg.sampleEvery !== 0) continue;
      const game = parseImportGame(chunk);
      if (!game || !shouldImportGame(game, cfg)) {
        counters.skipped += 1;
        continue;
      }

      const reviewed = await reviewGame(sf, game.plies.slice(0, cfg.maxPlies), cfg.depth);
      const rows: TrainingPosition[] = [];
      for (const r of reviewed) {
        const row = reviewedToTraining(r, 'master_game');
        if (row) rows.push(row);
      }
      if (rows.length) {
        appendFileSync(cfg.out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        counters.imported += 1;
        counters.rows += rows.length;
        log(
          `imported game ${counters.imported}/${cfg.limit}: ${game.headers.White ?? '?'} - ${game.headers.Black ?? '?'} (${rows.length} rows)`,
        );
      }
      if (counters.imported >= cfg.limit) break;
    }
    log(`done: seen=${counters.seen}, imported=${counters.imported}, skipped=${counters.skipped}, rows=${counters.rows}, out=${cfg.out}`);
    return counters;
  } finally {
    sf.dispose();
  }
}

if (!process.env.VITEST) {
  importLichessDatabase(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error('Lichess import failed:', e);
    process.exit(1);
  });
}
