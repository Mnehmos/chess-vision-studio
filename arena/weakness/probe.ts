// Weakness profiler — directed self-play to find where CVS bleeds eval vs SF-d24.
//
//   stress FEN -> CVS self-play (playGame) -> reviewGameLazy(prefilter d8 -> d24)
//   -> d24 disagreements -> annotate each miss (quiet? safe target? phase? motif)
//   -> per-category weakness report.
//
// Killer metric: cvsMissedSafeQuietRate = how often SF's best was a QUIET move to a
// SAFE square (not attacked by the opponent after the move) that CVS did not play.
// Safe-target follows the user's correction: safe = NOT controlled by the opponent.
//
// Run:  npx vite-node --script arena/weakness/probe.ts
// Env:  WEAKNESS_POS_CAP, WEAKNESS_BUDGET_MS, WEAKNESS_MAX_PLIES, WEAKNESS_REVIEW_DEPTH,
//       WEAKNESS_PREFILTER, WEAKNESS_THREADS, WEAKNESS_HELPERS, WEAKNESS_OUT_DIR,
//       WEAKNESS_TIME_BUDGET_MIN (wall-clock safety cap)
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { UciEngine } from '../../engine/evaluation';
import { createNodeStockfishTransport } from '../../engine/stockfish-node';
import { RustBackend, rustBackendExtraArgs } from '../engine-backend/rust-backend';
import { playGame } from '../match';
import { reviewGameLazy } from '../review';
import { rustPlayer } from './rust-player';
import { getStressPositions, type WeaknessTag } from './positions';

const num = (k: string, d: number) => Number(process.env[k] ?? d) || d;
const CAP = num('WEAKNESS_POS_CAP', 24);
const BUDGET_MS = num('WEAKNESS_BUDGET_MS', 1200);
const MAX_PLIES = num('WEAKNESS_MAX_PLIES', 80);
const REVIEW_DEPTH = num('WEAKNESS_REVIEW_DEPTH', 24);
const PREFILTER = num('WEAKNESS_PREFILTER', 8);
const THREADS = num('WEAKNESS_THREADS', 8);
const HELPERS = num('WEAKNESS_HELPERS', 3);
const OUT_DIR = process.env.WEAKNESS_OUT_DIR ?? 'arena/out/weakness';
const TIME_BUDGET_MS = num('WEAKNESS_TIME_BUDGET_MIN', 240) * 60_000;

const norm = (s: string) => s.replace(/[+#!?]/g, '').trim();

interface Miss {
  position: string;
  tag: WeaknessTag;
  phase: 'opening' | 'middlegame' | 'endgame';
  ply: number;
  fenBefore: string;
  playedSan: string;
  sfBestSan: string;
  cpLoss: number;
  classification: string;
  sfBestQuiet: boolean;
  sfBestSafeTarget: boolean;
  missedSafeQuiet: boolean; // the killer: SF best was a safe quiet move CVS skipped
}

function phaseOf(fen: string): 'opening' | 'middlegame' | 'endgame' {
  const pieces = (fen.split(' ')[0].match(/[a-zA-Z]/g) ?? []).length;
  if (pieces > 26) return 'opening';
  if (pieces >= 14) return 'middlegame';
  return 'endgame';
}

/** Local geometry: is SF's best a quiet move, and is its target square safe
 *  (the opponent can't capture there after the move)? */
function annotateBest(fenBefore: string, sfBestSan: string): { quiet: boolean; safeTarget: boolean } {
  try {
    const chess = new Chess(fenBefore);
    const legal = chess.moves({ verbose: true }) as Array<{
      san: string; from: string; to: string; promotion?: string; captured?: string;
    }>;
    const mv = legal.find((m) => norm(m.san) === norm(sfBestSan));
    if (!mv) return { quiet: false, safeTarget: false };
    const quiet = !mv.captured && !mv.promotion;
    const after = new Chess(fenBefore);
    after.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    // opponent now to move: can any of their legal moves land on mv.to (capture us)?
    const oppMoves = after.moves({ verbose: true }) as Array<{ to: string }>;
    const safeTarget = !oppMoves.some((m) => m.to === mv.to);
    return { quiet, safeTarget };
  } catch {
    return { quiet: false, safeTarget: false };
  }
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((1000 * n) / d) / 10;
}
function p90(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(100 * s[Math.min(s.length - 1, Math.floor(0.9 * s.length))]!) / 100;
}
function avg(xs: number[]): number {
  return xs.length ? Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 100 : 0;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const missesPath = `${OUT_DIR}/misses.jsonl`;
  writeFileSync(missesPath, '', 'utf8'); // fresh run

  const positions = getStressPositions().slice(0, CAP);
  console.log(`weakness probe: ${positions.length} stress positions | budget ${BUDGET_MS}ms/move | review d${REVIEW_DEPTH} (prefilter d${PREFILTER}) | CVS ${THREADS}t+${HELPERS}spec`);

  const sf = new UciEngine(await createNodeStockfishTransport());
  const cvsArgs = rustBackendExtraArgs({
    ...process.env,
    CVS_RUST_THREADS: String(THREADS),
    CVS_RUST_CVS_HELPERS: String(HELPERS),
    CVS_RUST_SMARTTIME: '0', // fixed per-move budget for bounded, fair self-play
  });
  console.log(`CVS args: ${cvsArgs.join(' ')}`);
  const backend = new RustBackend({ extraArgs: cvsArgs });
  const cvs = rustPlayer(backend, { name: `cvs-${THREADS}t+${HELPERS}spec`, budgetMs: BUDGET_MS });

  const misses: Miss[] = [];
  const gameLog: Array<{ position: string; tag: string; result: string; plies: number; deepReviewed: number; misses: number }> = [];
  const start = Date.now();

  for (const [i, pos] of positions.entries()) {
    if (Date.now() - start > TIME_BUDGET_MS) {
      console.log(`wall-clock budget reached after ${i} positions — stopping early`);
      break;
    }
    try {
      const game = await playGame(cvs, cvs, { startFen: pos.fen, maxPlies: MAX_PLIES });
      const { reviewed, deepReviewed } = await reviewGameLazy(
        sf,
        game.plies,
        { prefilterDepth: PREFILTER, reviewDepth: REVIEW_DEPTH, minCpLoss: 0.5, candidateRatio: 0.5 },
      );
      let posMisses = 0;
      for (const r of reviewed) {
        // a confirmed (deep) disagreement: CVS played a different move and lost >= 0.5 pawn
        if (!r.available || !r.sfBestSan || r.oracleDepth !== REVIEW_DEPTH) continue;
        if (norm(r.playedSan) === norm(r.sfBestSan) || r.cpLoss < 0.5) continue;
        const { quiet, safeTarget } = annotateBest(r.fenBefore, r.sfBestSan);
        const miss: Miss = {
          position: pos.name,
          tag: pos.tag,
          phase: phaseOf(r.fenBefore),
          ply: r.ply,
          fenBefore: r.fenBefore,
          playedSan: r.playedSan,
          sfBestSan: r.sfBestSan,
          cpLoss: Math.round(100 * r.cpLoss) / 100,
          classification: r.classification,
          sfBestQuiet: quiet,
          sfBestSafeTarget: safeTarget,
          missedSafeQuiet: quiet && safeTarget,
        };
        misses.push(miss);
        appendFileSync(missesPath, JSON.stringify(miss) + '\n', 'utf8');
        posMisses++;
      }
      gameLog.push({ position: pos.name, tag: pos.tag, result: game.result, plies: game.plies.length, deepReviewed, misses: posMisses });
      console.log(`[${i + 1}/${positions.length}] ${pos.tag} "${pos.name}": ${game.result} ${game.plies.length}p, ${deepReviewed} deep, ${posMisses} misses (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
    } catch (e) {
      console.log(`[${i + 1}/${positions.length}] ${pos.name} FAILED: ${String(e)}`);
    }
    writeReport(misses, gameLog, OUT_DIR); // incremental — survives interruption
  }

  backend.dispose();
  sf.dispose();
  writeReport(misses, gameLog, OUT_DIR);
  console.log(`DONE: ${misses.length} misses across ${gameLog.length} games -> ${OUT_DIR}/report.md`);
  setTimeout(() => process.exit(0), 500);
}

function writeReport(misses: Miss[], gameLog: unknown[], outDir: string) {
  const tags = [...new Set(misses.map((m) => m.tag))];
  const byTag = (t: string) => misses.filter((m) => m.tag === t);
  const lines: string[] = [];
  lines.push(`# CVS weakness profile (vs Stockfish d${REVIEW_DEPTH})`);
  lines.push('');
  lines.push(`Games: ${gameLog.length} | total d24 misses (cpLoss>=0.5): ${misses.length}`);
  lines.push('');
  lines.push('**Killer metric** — `cvsMissedSafeQuietRate`: of CVS misses, how often SF preferred a QUIET move to a SAFE square (CVS skipped a calm, sound improvement).');
  lines.push('');
  lines.push('| category | misses | avgCpLoss | p90 | blunders(>=2) | sfBestQuiet% | **missedSafeQuiet%** | top phase |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const t of ['TACTICS', 'KING_DEFENSE', 'QUIET_DEFENSE', 'POSITIONAL', 'ENDGAME', 'CONVERSION', 'SURVIVAL']) {
    const ms = byTag(t);
    if (!ms.length) continue;
    const cps = ms.map((m) => m.cpLoss);
    const phases = ms.reduce<Record<string, number>>((a, m) => ((a[m.phase] = (a[m.phase] ?? 0) + 1), a), {});
    const topPhase = Object.entries(phases).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
    lines.push(
      `| ${t} | ${ms.length} | ${avg(cps)} | ${p90(cps)} | ${pct(ms.filter((m) => m.cpLoss >= 2).length, ms.length)}% | ${pct(ms.filter((m) => m.sfBestQuiet).length, ms.length)}% | **${pct(ms.filter((m) => m.missedSafeQuiet).length, ms.length)}%** | ${topPhase} |`,
    );
  }
  lines.push('');
  lines.push('## Worst misses (highest cpLoss, with SF\'s preferred quiet improvement)');
  for (const m of [...misses].sort((a, b) => b.cpLoss - a.cpLoss).slice(0, 25)) {
    const flag = m.missedSafeQuiet ? ' **[missed safe quiet]**' : m.sfBestQuiet ? ' [quiet]' : '';
    lines.push(`- ${m.tag}/${m.phase} −${m.cpLoss}: played \`${m.playedSan}\`, SF best \`${m.sfBestSan}\`${flag}  \`${m.fenBefore}\``);
  }
  writeFileSync(`${outDir}/report.md`, lines.join('\n'), 'utf8');
  writeFileSync(`${outDir}/report.json`, JSON.stringify({ generatedPlies: gameLog, misses }, null, 2), 'utf8');
  void tags;
}

main().catch((e) => {
  console.error('weakness probe failed:', e);
  process.exit(1);
});
