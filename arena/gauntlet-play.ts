// Gauntlet play — Rust CVS vs an Elo-limited Stockfish ladder.
// Balanced format: each opening is played twice (CVS White once, CVS Black once).
// Outputs per run: games.pgn, games.jsonl, moves.jsonl (CVS move telemetry for
// scoring), run_config.json.
//
//   npm run gauntlet:play -- --opponents 800,1000,1200 --games-per-opponent 20 \
//     --cvs-depth 5 --openings arena/gauntlet/openings/balanced_openings.epd \
//     [--output arena/gauntlet/runs/<id>] [--movetime 80] [--max-plies 200]
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Chess } from 'chess.js';
import { RustEngine } from './gauntlet/rust-engine';
import { SfOpponent } from './gauntlet/sf-opponent';

interface Cfg {
  opponents: number[];
  gamesPerOpponent: number;
  cvsDepth: number;
  openings: string;
  output: string;
  movetimeMs: number;
  maxPlies: number;
  rustExe: string;
  baseWeights: string;
  rung2Weights: string;
  /** EXPERIMENTAL: danger-triggered depth extension. Runs marked experimental —
   * results do NOT count toward the official ladder. */
  danger: boolean;
  /** CVS wall-clock per move (ms). When set, cvsDepth becomes a cap and the
   * clock drives the search — the equal-clock format (pair with --movetime). */
  cvsMovetimeMs: number | null;
}

function parseArgs(argv: string[]): Cfg {
  const cfg: Cfg = {
    opponents: [800, 1000, 1200],
    gamesPerOpponent: 20,
    cvsDepth: 5,
    openings: 'arena/gauntlet/openings/balanced_openings.epd',
    output: '',
    movetimeMs: 80,
    maxPlies: 200,
    rustExe: '../chess-vision-studio-rust-engine/target/release/analyze.exe',
    baseWeights: 'arena/out/value-weights-mixed.json',
    rung2Weights: 'arena/out/rung2-weights-mixed.json',
    danger: false,
    cvsMovetimeMs: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    if (a === '--opponents') cfg.opponents = next().split(',').map((s) => Number(s.trim())).filter(Boolean);
    else if (a === '--games-per-opponent') cfg.gamesPerOpponent = Number(next()) || cfg.gamesPerOpponent;
    else if (a === '--cvs-depth') cfg.cvsDepth = Number(next()) || cfg.cvsDepth;
    else if (a === '--openings') cfg.openings = next();
    else if (a === '--output') cfg.output = next();
    else if (a === '--movetime') cfg.movetimeMs = Number(next()) || cfg.movetimeMs;
    else if (a === '--max-plies') cfg.maxPlies = Number(next()) || cfg.maxPlies;
    else if (a === '--danger') cfg.danger = true;
    else if (a === '--cvs-movetime') cfg.cvsMovetimeMs = Number(next()) || null;
  }
  if (!cfg.output) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    cfg.output = `arena/gauntlet/runs/${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  return cfg;
}

interface Opening {
  fen: string;
  id: string;
}

function loadOpenings(path: string): Opening[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [fen, id] = l.split(';').map((s) => s.trim());
      return { fen: fen!, id: id ?? 'unknown' };
    });
}

function applyUci(chess: Chess, uci: string): { san: string } | null {
  try {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    return m ? { san: m.san } : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  mkdirSync(cfg.output, { recursive: true });
  const openings = loadOpenings(cfg.openings);
  // Equal-clock mode: the wall clock drives the search; depth becomes a cap.
  const rustDepth = cfg.cvsMovetimeMs ? Math.max(cfg.cvsDepth, 30) : cfg.cvsDepth;
  const extraArgs: string[] = [];
  if (cfg.danger) extraArgs.push('--danger');
  if (cfg.cvsMovetimeMs) extraArgs.push('--movetime', String(cfg.cvsMovetimeMs));
  const rust = new RustEngine(cfg.rustExe, rustDepth, cfg.baseWeights, cfg.rung2Weights, extraArgs);
  const idCore = cfg.cvsMovetimeMs ? `${cfg.cvsMovetimeMs}ms` : `d${cfg.cvsDepth}`;
  const engineLabel = cfg.danger ? `CVS-Rust-${idCore}+danger` : `CVS-Rust-${idCore}`;
  if (cfg.danger) console.log('⚠ EXPERIMENTAL run (--danger): results do NOT count toward the official ladder');
  if (cfg.cvsMovetimeMs) console.log(`equal-clock mode: CVS ${cfg.cvsMovetimeMs}ms/move (depth cap ${rustDepth}), SF movetime ${cfg.movetimeMs}ms`);

  let engineCommit = 'unknown';
  try {
    engineCommit = execSync('git rev-parse --short HEAD', { cwd: '../chess-vision-studio-rust-engine', encoding: 'utf8' }).trim();
  } catch {
    /* best effort */
  }

  const gamesPath = `${cfg.output}/games.jsonl`;
  const movesPath = `${cfg.output}/moves.jsonl`;
  const pgnPath = `${cfg.output}/games.pgn`;
  writeFileSync(gamesPath, '', 'utf8');
  writeFileSync(movesPath, '', 'utf8');
  writeFileSync(pgnPath, '', 'utf8');

  const startedAt = new Date().toISOString();
  const allSettings: Record<string, unknown> = {};
  // ONE Stockfish process serves the whole ladder (the WASM build is single-
  // instance per process); strength is reconfigured between opponents.
  const sf = await SfOpponent.create(cfg.opponents[0], cfg.movetimeMs);

  for (const elo of cfg.opponents) {
    await sf.setStrength(elo, cfg.movetimeMs);
    allSettings[String(elo)] = sf.settings;
    console.log(`opponent SF-${elo}: ${JSON.stringify(sf.settings)}`);
    let w = 0;
    let d = 0;
    let l = 0;
    try {
      for (let g = 0; g < cfg.gamesPerOpponent; g++) {
        const opening = openings[Math.floor(g / 2) % openings.length]!;
        const cvsWhite = g % 2 === 0;
        const gameId = `sf${elo}-g${String(g).padStart(2, '0')}`;
        const chess = new Chess(opening.fen);
        let termination = '';
        let plies = 0;

        while (!chess.isGameOver() && plies < cfg.maxPlies) {
          const fenBefore = chess.fen();
          const stm = chess.turn();
          const cvsToMove = (stm === 'w') === cvsWhite;
          if (cvsToMove) {
            const pick = await rust.analyze(fenBefore);
            if (!pick.uci) {
              termination = 'engine_null';
              break;
            }
            const applied = applyUci(chess, pick.uci);
            if (!applied) {
              termination = 'illegal_cvs';
              appendFileSync(movesPath, JSON.stringify({
                gameId, ply: plies, fenBefore, sideToMove: stm,
                cvsMove: pick.uci, cvsSan: null, cvsScore: pick.scoreCp, cvsPV: pick.pv,
                cvsDepth: pick.depth, nodes: pick.nodes, qNodes: pick.qNodes,
                ttHits: pick.ttHits, timeMs: pick.timeMs, illegal: true,
              }) + '\n', 'utf8');
              break;
            }
            appendFileSync(movesPath, JSON.stringify({
              gameId, ply: plies, fenBefore, sideToMove: stm,
              cvsMove: pick.uci, cvsSan: applied.san, cvsScore: pick.scoreCp, cvsPV: pick.pv,
              cvsDepth: pick.depth, nodes: pick.nodes, qNodes: pick.qNodes,
              ttHits: pick.ttHits, timeMs: pick.timeMs, illegal: false,
            }) + '\n', 'utf8');
          } else {
            const mv = await sf.bestMove(fenBefore);
            if (!mv || !applyUci(chess, mv)) {
              termination = 'engine_null';
              break;
            }
          }
          plies++;
        }

        let result: string;
        if (termination === 'illegal_cvs' || (termination === 'engine_null' && ((chess.turn() === 'w') === cvsWhite))) {
          result = cvsWhite ? '0-1' : '1-0'; // CVS forfeits
        } else if (chess.isCheckmate()) {
          result = chess.turn() === 'w' ? '0-1' : '1-0';
          termination = 'checkmate';
        } else if (chess.isGameOver()) {
          result = '1/2-1/2';
          termination = termination || (chess.isStalemate() ? 'stalemate' : 'draw_rule');
        } else if (!termination) {
          result = '1/2-1/2';
          termination = 'maxply_adjudicated_draw';
        } else {
          result = '1/2-1/2';
        }
        const cvsResult = result === '1/2-1/2' ? 'draw' : (result === '1-0') === cvsWhite ? 'win' : 'loss';
        if (cvsResult === 'win') w++;
        else if (cvsResult === 'draw') d++;
        else l++;

        chess.header('Event', cfg.danger ? 'CVS Gauntlet (EXPERIMENTAL danger)' : 'CVS Gauntlet');
        chess.header('White', cvsWhite ? engineLabel : `SF-${elo}`);
        chess.header('Black', cvsWhite ? `SF-${elo}` : engineLabel);
        chess.header('Result', result);
        chess.header('Opening', opening.id);
        chess.header('Round', String(g + 1));
        appendFileSync(pgnPath, chess.pgn() + '\n\n', 'utf8');
        appendFileSync(gamesPath, JSON.stringify({
          gameId,
          opponent: `SF-${elo}`,
          opponentEloLabel: elo,
          opponentSettings: sf.settings,
          cvsColor: cvsWhite ? 'white' : 'black',
          openingId: opening.id,
          openingFen: opening.fen,
          result,
          cvsResult,
          plies,
          termination,
          finalFen: chess.fen(),
        }) + '\n', 'utf8');
        console.log(`  ${gameId} ${opening.id} cvs=${cvsWhite ? 'W' : 'B'} → ${result} (${termination}, ${plies} plies) [${w}W/${d}D/${l}L]`);
      }
    } catch (e) {
      sf.dispose();
      rust.dispose();
      throw e;
    }
    console.log(`SF-${elo} done: ${w}W ${d}D ${l}L (score ${(((w + 0.5 * d) / cfg.gamesPerOpponent) * 100).toFixed(1)}%)`);
  }
  sf.dispose();
  rust.dispose();

  writeFileSync(`${cfg.output}/run_config.json`, JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    engine: cfg.danger ? 'CVS-Rust (cvs-bitboard-core) EXPERIMENTAL +danger' : 'CVS-Rust (cvs-bitboard-core)',
    engineCommit,
    experimental: cfg.danger,
    dangerExtension: cfg.danger,
    cvsDepth: cfg.cvsDepth,
    cvsMovetimeMs: cfg.cvsMovetimeMs, // equal-clock mode when set (depth becomes a cap)
    cvsDepthCap: cfg.cvsMovetimeMs ? Math.max(cfg.cvsDepth, 30) : cfg.cvsDepth,
    weights: { base: cfg.baseWeights, rung2: cfg.rung2Weights },
    opponents: cfg.opponents,
    opponentSettings: allSettings,
    gamesPerOpponent: cfg.gamesPerOpponent,
    openings: cfg.openings,
    movetimeMs: cfg.movetimeMs,
    maxPlies: cfg.maxPlies,
  }, null, 2), 'utf8');
  console.log(`\nrun dir: ${cfg.output}`);
}

main().catch((e) => {
  console.error('gauntlet:play failed:', e);
  process.exit(1);
});
