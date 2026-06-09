// RSI loss forensic — pull one game apart, move by move, against the tiered
// Stockfish oracle. For each CVS move: bulk-depth cpLoss + SF best; then the
// worst N moves get the deep oracle (d20) AND a deeper Rust re-search, so the
// failure class (value_miseval vs search_horizon vs king-safety etc.) is
// evidence-based, not vibes.
//
//   npm run forensic:loss -- --run arena/gauntlet/runs/<id> --game sf2200-g14
//     [--bulk-depth 12] [--deep-depth 20] [--worst 4] [--rust-depth 7]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { computeCpLoss } from '../engine/classify';
import { SfCachePool } from './sf-cache';

interface MoveRow {
  gameId: string;
  ply: number;
  fenBefore: string;
  sideToMove: string;
  cvsMove: string;
  cvsSan: string | null;
  cvsScore: number;
  timeMs: number;
}

function parseArgs(argv: string[]) {
  const cfg = { run: '', game: '', bulkDepth: 12, deepDepth: 20, worst: 4, rustDepth: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--run') cfg.run = next();
    else if (a === '--game') cfg.game = next();
    else if (a === '--bulk-depth') cfg.bulkDepth = Number(next()) || 12;
    else if (a === '--deep-depth') cfg.deepDepth = Number(next()) || 20;
    else if (a === '--worst') cfg.worst = Number(next()) || 4;
    else if (a === '--rust-depth') cfg.rustDepth = Number(next()) || 7;
  }
  if (!cfg.run || !cfg.game) throw new Error('--run and --game required');
  return cfg;
}

function applyUci(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return m ? c.fen() : null;
  } catch {
    return null;
  }
}

function rustProbe(fens: string[], depth: number): Map<string, { uci: string | null; scoreCp: number; pv: string[] }> {
  const tmp = 'arena/out/forensic-probe-fens.txt';
  writeFileSync(tmp, fens.join('\n') + '\n', 'utf8');
  const out = execFileSync('../chess-vision-studio-rust-engine/target/release/analyze.exe', [
    '--fens', tmp, '--depth', String(depth),
    '--base', 'arena/out/value-weights-mixed.json',
    '--rung2', 'arena/out/rung2-weights-mixed.json',
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const map = new Map();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    map.set(o.fen, { uci: o.uci ?? null, scoreCp: o.scoreCp ?? 0, pv: o.pv ?? [] });
  }
  return map;
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  const rows: MoveRow[] = readFileSync(`${cfg.run}/moves.jsonl`, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((r: MoveRow) => r.gameId === cfg.game);
  if (rows.length === 0) throw new Error(`no moves for ${cfg.game} in ${cfg.run}`);
  const game = readFileSync(`${cfg.run}/games.jsonl`, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((g: { gameId: string }) => g.gameId === cfg.game);

  console.log(`# Forensic: ${cfg.game} (${game?.openingId}, CVS ${game?.cvsColor}, ${game?.result}, ${game?.termination})`);
  console.log(`oracle: bulk d${cfg.bulkDepth}, deep d${cfg.deepDepth} on worst ${cfg.worst}; rust re-search d${cfg.rustDepth}\n`);

  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  const bulk = new SfCachePool([sf], cfg.bulkDepth, 'arena/out/sf-eval-cache.jsonl');
  const deep = new SfCachePool([sf], cfg.deepDepth, 'arena/out/sf-eval-cache.jsonl');
  const scoredRows: { row: MoveRow; cpLoss: number; sfBest: string; evalB: string; fenAfter: string | null }[] = [];
  try {
    console.log(`| Ply | CVS move | CVS self-eval | SF d${cfg.bulkDepth} eval | SF best | cpLoss |`);
    console.log(`|---:|---|---:|---:|---|---:|`);
    for (const row of rows) {
      const before = await bulk.evalFen(row.fenBefore);
      if (before.status === 'unavailable' || !before.pv?.[0]) continue;
      const fenAfter = applyUci(row.fenBefore, row.cvsMove);
      let cpLoss = 0;
      if (fenAfter) {
        const c = new Chess(fenAfter);
        const after = c.isCheckmate() ? null : c.isGameOver() ? { cp: 0, depth: 0, pv: [] } : await bulk.evalFen(fenAfter);
        cpLoss = after === null ? 0 : Math.max(0, computeCpLoss(before, after));
      }
      const evalB = before.mate !== undefined ? `M${before.mate}` : String(before.cp);
      scoredRows.push({ row, cpLoss, sfBest: before.pv[0], evalB, fenAfter });
      const flag = cpLoss >= 2 ? ' ⛔' : cpLoss >= 0.75 ? ' ⚠' : '';
      console.log(`| ${row.ply} | ${row.cvsSan} | ${row.cvsScore} | ${evalB} | ${before.pv[0]} | ${cpLoss.toFixed(2)}${flag} |`);
    }

    // Deep oracle + Rust deeper re-search on the worst moves.
    const worst = [...scoredRows].sort((a, b) => b.cpLoss - a.cpLoss).slice(0, cfg.worst);
    const probe = rustProbe(worst.map((w) => w.row.fenBefore), cfg.rustDepth);
    console.log(`\n## Deep forensic on the worst ${worst.length} moves\n`);
    for (const w of worst) {
      const dBefore = await deep.evalFen(w.row.fenBefore);
      let deepLoss: number | null = null;
      if (w.fenAfter && dBefore.status !== 'unavailable' && dBefore.pv?.[0]) {
        const c = new Chess(w.fenAfter);
        const dAfter = c.isCheckmate() ? null : c.isGameOver() ? { cp: 0, depth: 0, pv: [] } : await deep.evalFen(w.fenAfter);
        deepLoss = dAfter === null ? 0 : Math.max(0, computeCpLoss(dBefore, dAfter));
      }
      const r = probe.get(w.row.fenBefore);
      const rustDiffers = r?.uci && r.uci !== w.row.cvsMove;
      console.log(`### ply ${w.row.ply}: ${w.row.cvsSan} (cpLoss d${cfg.bulkDepth}: ${w.cpLoss.toFixed(2)})`);
      console.log(`  FEN: ${w.row.fenBefore}`);
      console.log(`  SF d${cfg.deepDepth}: eval ${dBefore.mate !== undefined ? 'M' + dBefore.mate : dBefore.cp}  best ${dBefore.pv?.[0] ?? '?'}  pv ${(dBefore.pv ?? []).slice(0, 6).join(' ')}`);
      console.log(`  deep cpLoss: ${deepLoss === null ? 'n/a' : deepLoss.toFixed(2)}`);
      console.log(`  CVS self-eval: ${w.row.cvsScore}cp (delusion gap vs SF: ${dBefore.cp !== undefined ? (w.row.cvsScore - (w.row.sideToMove === 'b' ? -dBefore.cp : dBefore.cp)).toFixed(0) + 'cp' : 'mate-range'})`);
      console.log(`  Rust d${cfg.rustDepth} re-search: ${r?.uci ?? '?'} (${r?.scoreCp}cp)${rustDiffers ? ' ← DIFFERS from played move (search_horizon evidence)' : ' — same move (value_miseval evidence)'}`);
      console.log('');
    }
  } finally {
    sf.dispose();
  }
}

main().catch((e) => {
  console.error('forensic:loss failed:', e);
  process.exit(1);
});
