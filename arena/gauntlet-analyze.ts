// Gauntlet analyze — aggregates a scored run into:
//   summary.json        per-opponent W/D/L, score%, Elo estimate, move quality
//   elo_ladder.md       the ladder table
//   failures.jsonl      every high-cpLoss/mate/illegal move with context + tags
//   rsi_candidates.jsonl high-signal rows for Fable/Opus failure diagnosis
//
// Provisional failure tags (automatic, heuristic — marked provisional so the
// RSI loop treats them as hypotheses, not ground truth):
//   search_horizon          deeper Rust search picks a different move that improves
//   value_miseval           deeper Rust search picks the SAME move (eval's fault)
//   quiet_refutation_missed SF refutation line starts with a quiet (non-capture) reply
//   hanging_piece_missed    mover left material hanging after the move
//   king_safety_missed      king-zone pressure swung hard against the mover
//   passed_pawn_missed      passer dynamics swung against the mover (endgame-ish)
//   tactical_motif_missed   SF best was a forcing capture/check the engine skipped
//   opening_structure       failure inside the first 12 plies
//   endgame_conversion      (game-level) winning position not converted
//   mate_missed / unknown
//
//   npm run gauntlet:analyze -- --run arena/gauntlet/runs/<id> [--probe-depth +2]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { extractRung2Features } from '@cvs/engine';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import { computeCpLoss } from '../engine/classify';
import { median } from './quality';
import { SfCachePool } from './sf-cache';

interface GameRow {
  gameId: string;
  opponentEloLabel: number;
  opponentSettings: unknown;
  cvsColor: 'white' | 'black';
  openingId: string;
  result: string;
  cvsResult: 'win' | 'draw' | 'loss';
  plies: number;
  termination: string;
}

interface ScoredMove {
  gameId: string;
  ply: number;
  fenBefore: string;
  fenAfter?: string;
  sideToMove: string;
  cvsMove: string;
  cvsSan: string | null;
  cvsScore: number;
  cvsPV: string[];
  cvsDepth: number;
  timeMs: number;
  stockfishBest?: string;
  stockfishEvalBefore?: number | string;
  stockfishEvalAfter?: number | string;
  cpLoss: number | null;
  classification: string;
}

function parseArgs(argv: string[]): { run: string; probeExtra: number } {
  let run = '';
  let probeExtra = 2;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') run = argv[++i] ?? '';
    else if (argv[i] === '--probe-depth') probeExtra = Number((argv[++i] ?? '2').replace('+', '')) || 2;
  }
  if (!run) throw new Error('--run <dir> required');
  return { run, probeExtra };
}

function jsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** Deeper-probe: re-search failure FENs with the Rust engine at depth+N. */
function rustProbe(fens: string[], depth: number): Map<string, { uci: string | null; scoreCp: number }> {
  const tmp = 'arena/out/rsi-probe-fens.txt';
  writeFileSync(tmp, fens.join('\n') + '\n', 'utf8');
  const out = execFileSync('../chess-vision-studio-rust-engine/target/release/analyze.exe', [
    '--fens', tmp, '--depth', String(depth),
    '--base', 'arena/out/value-weights-mixed.json',
    '--rung2', 'arena/out/rung2-weights-mixed.json',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const map = new Map<string, { uci: string | null; scoreCp: number }>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    map.set(o.fen, { uci: o.uci ?? null, scoreCp: o.scoreCp ?? 0 });
  }
  return map;
}

async function main(): Promise<void> {
  const { run, probeExtra } = parseArgs(process.argv.slice(2));
  const games = jsonl<GameRow>(`${run}/games.jsonl`);
  const moves = jsonl<ScoredMove>(`${run}/scored_moves.jsonl`);
  const config = JSON.parse(readFileSync(`${run}/run_config.json`, 'utf8'));
  const cvsDepth: number = config.cvsDepth ?? 5;

  // ---- per-opponent aggregates ----
  const ladder: Record<string, unknown>[] = [];
  for (const elo of [...new Set(games.map((g) => g.opponentEloLabel))].sort((a, b) => a - b)) {
    const gs = games.filter((g) => g.opponentEloLabel === elo);
    const wins = gs.filter((g) => g.cvsResult === 'win').length;
    const draws = gs.filter((g) => g.cvsResult === 'draw').length;
    const losses = gs.filter((g) => g.cvsResult === 'loss').length;
    const n = gs.length;
    let score = (wins + 0.5 * draws) / Math.max(1, n);
    // Clamp away from 0/1 so the Elo formula stays finite (±~half-game margin).
    score = Math.max(1 / (2 * n), Math.min(1 - 1 / (2 * n), score));
    const eloDiff = -400 * Math.log10(1 / score - 1);
    const ids = new Set(gs.map((g) => g.gameId));
    const ms = moves.filter((m) => ids.has(m.gameId) && m.cpLoss !== null);
    const losses_ = ms.map((m) => m.cpLoss!) as number[];
    ladder.push({
      opponent: `SF-${elo}`,
      eloLabel: elo,
      settings: gs[0]?.opponentSettings,
      games: n,
      wins,
      draws,
      losses,
      scorePct: Number((((wins + 0.5 * draws) / Math.max(1, n)) * 100).toFixed(1)),
      eloDiff: Number(eloDiff.toFixed(0)),
      estimatedCvsElo: Number((elo + eloDiff).toFixed(0)),
      avgCpLoss: Number((losses_.reduce((a, b) => a + b, 0) / Math.max(1, losses_.length)).toFixed(3)),
      medianCpLoss: Number(median(losses_).toFixed(3)),
      blunderRate: Number((ms.filter((m) => m.classification === 'blunder' || m.classification === 'mate_missed').length / Math.max(1, ms.length)).toFixed(4)),
      mateMissed: ms.filter((m) => m.classification === 'mate_missed').length,
      illegal: moves.filter((m) => ids.has(m.gameId) && m.classification === 'illegal').length,
      avgTimePerMoveMs: Number((ms.reduce((a, b) => a + b.timeMs, 0) / Math.max(1, ms.length)).toFixed(1)),
    });
  }

  // ---- failures + RSI tagging ----
  const failures = moves.filter(
    (m) => m.classification === 'illegal' || m.classification === 'mate_missed' || (m.cpLoss !== null && m.cpLoss >= 1.0),
  );
  // Deeper probe on every failure FEN (batch, fast — Rust).
  const probe = failures.length
    ? rustProbe(failures.map((f) => f.fenBefore), cvsDepth + probeExtra)
    : new Map<string, { uci: string | null; scoreCp: number }>();

  // Score the deeper-probe alternatives through the shared SF cache.
  const transport = await createNodeStockfishTransport();
  const sfEngine = new UciEngine(transport);
  const pool = new SfCachePool([sfEngine], 10, 'arena/out/sf-eval-cache.jsonl');
  const gameById = new Map(games.map((g) => [g.gameId, g]));
  const tagged: Record<string, unknown>[] = [];
  try {
    for (const f of failures) {
      const tags: string[] = [];
      const deeper = probe.get(f.fenBefore);
      let deeperImproves = false;
      if (f.classification === 'illegal') tags.push('illegal');
      if (f.classification === 'mate_missed') tags.push('mate_missed');
      if (deeper?.uci && deeper.uci !== f.cvsMove && f.cpLoss !== null) {
        // Does the deeper move actually improve, per the SF oracle?
        try {
          const before = await pool.evalFen(f.fenBefore);
          const c = new Chess(f.fenBefore);
          const m = c.move({ from: deeper.uci.slice(0, 2), to: deeper.uci.slice(2, 4), promotion: deeper.uci.slice(4) || undefined });
          if (m && before.status !== 'unavailable') {
            const after = await pool.evalFen(c.fen());
            const deeperLoss = Math.max(0, computeCpLoss(before, after));
            deeperImproves = deeperLoss <= f.cpLoss - 0.5;
          }
        } catch {
          /* skip */
        }
      }
      if (deeperImproves) {
        tags.push('search_horizon');
        // Quiet refutation: SF's reply to the CVS move is a non-capture.
        const reply = (await pool.evalFen(f.fenAfter ?? f.fenBefore)).pv?.[0] ?? '';
        if (reply && !reply.includes('x')) tags.push('quiet_refutation_missed');
      } else if (f.cpLoss !== null && f.cpLoss >= 1.0 && f.classification !== 'illegal') {
        tags.push('value_miseval');
      }
      // Feature-level heuristics (provisional).
      try {
        if (f.fenAfter) {
          const featB = extractRung2Features(new Chess(f.fenBefore));
          const featA = extractRung2Features(new Chess(f.fenAfter));
          const moverSign = f.sideToMove === 'w' ? 1 : -1;
          // hangingPiece is White-POV (+ = Black hangs more): mover hanging = -sign·feat.
          if (-moverSign * featA.hangingPiece > 0.5) tags.push('hanging_piece_missed');
          const pressureSwing = -moverSign * (featA.kingZonePressure - featB.kingZonePressure);
          if (pressureSwing >= 2) tags.push('king_safety_missed');
          const passerSwing = -moverSign * (featA.passedPawnEg - featB.passedPawnEg);
          if (passerSwing >= 2) tags.push('passed_pawn_missed');
        }
      } catch {
        /* feature tags best-effort */
      }
      if (f.stockfishBest && (f.stockfishBest.includes('x') || f.stockfishBest.includes('+')) && f.cpLoss !== null && f.cpLoss >= 2) {
        tags.push('tactical_motif_missed');
      }
      if (f.ply <= 12) tags.push('opening_structure');
      if (tags.length === 0) tags.push('unknown');

      const g = gameById.get(f.gameId);
      tagged.push({
        ...f,
        opponent: g?.opponentEloLabel,
        cvsColor: g?.cvsColor,
        gameResult: g?.cvsResult,
        deeperProbe: deeper ? { depth: cvsDepth + probeExtra, uci: deeper.uci, improves: deeperImproves } : null,
        provisionalTags: tags,
        primaryTag: tags[0],
      });
    }
  } finally {
    sfEngine.dispose();
  }

  // Game-level endgame_conversion: CVS was winning (≥ +2 from its POV) but didn't win.
  for (const g of games.filter((x) => x.cvsResult !== 'win')) {
    const ms = moves.filter((m) => m.gameId === g.gameId && typeof m.stockfishEvalBefore === 'number');
    const winning = ms.some((m) => {
      const stmCp = m.stockfishEvalBefore as number; // stm POV = CVS POV on CVS moves
      return stmCp >= 200;
    });
    if (winning) {
      const worst = ms.filter((m) => m.cpLoss !== null).sort((a, b) => b.cpLoss! - a.cpLoss!).slice(0, 2);
      for (const m of worst) {
        tagged.push({
          ...m,
          opponent: g.opponentEloLabel,
          cvsColor: g.cvsColor,
          gameResult: g.cvsResult,
          deeperProbe: null,
          provisionalTags: ['endgame_conversion'],
          primaryTag: 'endgame_conversion',
        });
      }
    }
  }

  // RSI candidates: the high-signal subset.
  const rsi = tagged.filter((t) => {
    const m = t as unknown as ScoredMove & { primaryTag: string };
    return (
      (m.cpLoss !== null && m.cpLoss >= 1.0) ||
      m.classification === 'mate_missed' ||
      m.classification === 'illegal' ||
      m.primaryTag === 'endgame_conversion' ||
      m.primaryTag === 'search_horizon'
    );
  });

  // ---- outputs ----
  const summary = {
    run,
    config,
    totals: {
      games: games.length,
      wins: games.filter((g) => g.cvsResult === 'win').length,
      draws: games.filter((g) => g.cvsResult === 'draw').length,
      losses: games.filter((g) => g.cvsResult === 'loss').length,
      cvsMoves: moves.length,
      failures: failures.length,
      rsiCandidates: rsi.length,
    },
    ladder,
    classificationCounts: Object.fromEntries(
      [...new Set(moves.map((m) => m.classification))].map((c) => [c, moves.filter((m) => m.classification === c).length]),
    ),
    tagCounts: Object.fromEntries(
      [...new Set(tagged.flatMap((t) => (t.provisionalTags as string[])))].map((tag) => [
        tag,
        tagged.filter((t) => (t.provisionalTags as string[]).includes(tag)).length,
      ]),
    ),
  };
  writeFileSync(`${run}/summary.json`, JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(`${run}/failures.jsonl`, tagged.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8');
  writeFileSync(`${run}/rsi_candidates.jsonl`, rsi.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8');

  const ladderMd = [
    `# CVS Gauntlet — Elo ladder`,
    ``,
    `Run: ${run} · engine ${config.engine} @ ${config.engineCommit} · depth ${cvsDepth}`,
    ``,
    `| Opponent | Mechanism | Games | W | D | L | Score | Elo diff | Est. CVS Elo | Avg cpLoss | Median | Blunder % | Mate missed | Illegal | Avg ms/move |`,
    `|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`,
    ...ladder.map((r: Record<string, unknown>) => {
      const s = r.settings as { mechanism?: string; uciElo?: number; skillLevel?: number } | undefined;
      const mech = s?.mechanism === 'UCI_Elo' ? `UCI_Elo ${s.uciElo}` : `Skill ${s?.skillLevel}`;
      return `| ${r.opponent} | ${mech} | ${r.games} | ${r.wins} | ${r.draws} | ${r.losses} | ${r.scorePct}% | ${r.eloDiff} | **${r.estimatedCvsElo}** | ${r.avgCpLoss} | ${r.medianCpLoss} | ${((r.blunderRate as number) * 100).toFixed(1)}% | ${r.mateMissed} | ${r.illegal} | ${r.avgTimePerMoveMs} |`;
    }),
    ``,
    `Elo labels below 1320 use Skill Level (approximate community mapping) — they are nominal, not SF-calibrated.`,
  ].join('\n');
  writeFileSync(`${run}/elo_ladder.md`, ladderMd, 'utf8');

  console.log(ladderMd);
  console.log(`\nfailures: ${failures.length} · rsi candidates: ${rsi.length}`);
  console.log(`tag counts: ${JSON.stringify(summary.tagCounts)}`);
  console.log(`\nwrote: ${run}/summary.json, elo_ladder.md, failures.jsonl, rsi_candidates.jsonl`);
}

main().catch((e) => {
  console.error('gauntlet:analyze failed:', e);
  process.exit(1);
});
