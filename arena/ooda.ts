// The OODA loop — a recursive self-improvement engine for the CVS engine.
//
//   Observe  — play games: CvsEngine (current weights) vs Stockfish, alternating colours.
//   Orient   — review every CVS ply with Stockfish (the oracle); flag disagreements.
//   Decide   — fold reviewed positions + "played-out" corrections into the dataset;
//              check the plateau stop condition.
//   Act      — retrain the policy on the accumulated dataset; benchmark the new weights
//              against a FIXED holdout (top-1 agreement with Stockfish). Loop.
//
// Stockfish lives here (the app); @cvs/engine is the student. The boundary is strings.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { UciEngine } from '../engine/evaluation';
import { createNodeStockfishTransport } from '../engine/stockfish-node';
import {
  CvsEngine,
  DEFAULT_POLICY_WEIGHTS,
  trainPolicy,
  benchmark,
  saveDataset,
  buildTrainingPosition,
} from '@cvs/engine';
import type { PolicyWeights, TrainingPosition } from '@cvs/engine';
import { stockfishPlayer, cvsPlayer } from './players';
import { playGame } from './match';
import { reviewGame } from './review';
import { findDisagreements, playOutBest } from './disagree';
import { reviewedToTraining, playoutToTraining } from './dataset';

export interface OodaConfig {
  rounds: number;
  gamesPerRound: number;
  maxPlies: number;
  playDepthSF: number; // Stockfish opponent search depth
  playDepthCVS: number; // CVS engine search depth
  reviewDepth: number; // Stockfish review/oracle depth
  branchPlies: number; // how far to "play out" each disagreement (0 = off)
  minCpLoss: number; // pawns: a divergence below this isn't a disagreement
  epochs: number; // policy training epochs per round
  plateauEps: number; // stop when holdout top-1 gain stays below this
  outDir: string;
}

export const DEFAULT_CONFIG: OodaConfig = {
  rounds: 3,
  gamesPerRound: 1,
  maxPlies: 30,
  playDepthSF: 6,
  playDepthCVS: 3,
  reviewDepth: 10,
  branchPlies: 2,
  minCpLoss: 0.5,
  epochs: 60,
  plateauEps: 0.001,
  outDir: 'arena/out',
};

// A fixed holdout: replay a real Ruy Lopez so every position is legal, then add a
// clean tactic. Stockfish's best at each (computed once) is the reference the
// student's top-1 is measured against — the same set every round, so the metric
// is comparable across the loop.
const HOLDOUT_LINE = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7',
  'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Na5', 'Bc2', 'c5', 'd4', 'Qc7',
];
const HOLDOUT_EXTRA = ['rnb1kbnr/ppp1pppp/8/3q4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1']; // SF best: exd5

function holdoutFens(): string[] {
  const chess = new Chess();
  const fens: string[] = [];
  for (const san of HOLDOUT_LINE) {
    fens.push(chess.fen());
    try {
      chess.move(san); // beta.8 throws on an illegal move
    } catch {
      break;
    }
  }
  return [...fens, ...HOLDOUT_EXTRA];
}

async function buildHoldout(sf: UciEngine, depth: number): Promise<TrainingPosition[]> {
  const out: TrainingPosition[] = [];
  for (const fen of holdoutFens()) {
    const e = await sf.evaluate({ fen, depth });
    const best = e.pv?.[0];
    if (!best || e.status === 'unavailable') continue;
    out.push(buildTrainingPosition(fen, best, { bestMove: best, cpLoss: 0, source: 'master_game' }));
  }
  return out;
}

export interface RoundReport {
  round: number;
  games: number;
  cvsPlies: number;
  disagreements: number;
  datasetSize: number;
  trainTop1: number; // training-set top-1 accuracy after this round's fit
  holdoutTop1: number; // top-1 agreement with Stockfish on the fixed holdout
  holdoutAvgCpLoss: number;
  gameResults: string[];
}

export interface OodaResult {
  baselineHoldoutTop1: number;
  rounds: RoundReport[];
  bestHoldoutTop1: number;
  finalWeights: PolicyWeights;
  datasetSize: number;
}

export async function runOoda(cfg: OodaConfig = DEFAULT_CONFIG, log: (m: string) => void = () => {}): Promise<OodaResult> {
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  try {
    log(`Building fixed holdout (${holdoutFens().length} positions @ depth ${cfg.reviewDepth})…`);
    const holdout = await buildHoldout(sf, cfg.reviewDepth);
    const baseline = benchmark(holdout, new CvsEngine({ weights: DEFAULT_POLICY_WEIGHTS }), { topK: 3 });
    log(`Baseline (CVS-Policy-0) holdout top-1 vs Stockfish: ${(baseline.top1Match * 100).toFixed(1)}%`);

    let weights: PolicyWeights = DEFAULT_POLICY_WEIGHTS;
    let bestWeights = weights;
    let bestTop1 = baseline.top1Match;
    let prevTop1 = baseline.top1Match;
    const dataset: TrainingPosition[] = [];
    const rounds: RoundReport[] = [];

    for (let round = 1; round <= cfg.rounds; round++) {
      const cvsEngine = new CvsEngine({ weights });
      const sfP = stockfishPlayer(sf, cfg.playDepthSF);
      const cvsP = cvsPlayer(cvsEngine, { depth: cfg.playDepthCVS });

      const reviewedRound: ReturnType<typeof reviewedToTraining>[] = [];
      let cvsPlies = 0;
      let disagreements = 0;
      const gameResults: string[] = [];

      for (let g = 1; g <= cfg.gamesPerRound; g++) {
        const cvsWhite = g % 2 === 1;
        const cvsSide = cvsWhite ? 'white' : 'black';
        log(`  Round ${round} game ${g}: CVS plays ${cvsSide} vs Stockfish@${cfg.playDepthSF}…`);
        const game = await playGame(cvsWhite ? cvsP : sfP, cvsWhite ? sfP : cvsP, { maxPlies: cfg.maxPlies });
        gameResults.push(`${game.result} (${game.termination}, ${game.plies.length} plies, CVS=${cvsSide})`);

        const reviewed = await reviewGame(sf, game.plies, cfg.reviewDepth, (p) => p.by === cvsSide);
        cvsPlies += reviewed.length;
        for (const r of reviewed) {
          const row = reviewedToTraining(r);
          if (row) reviewedRound.push(row);
        }

        const dis = findDisagreements(reviewed, cfg.minCpLoss);
        disagreements += dis.length;
        for (const d of dis) {
          log(`    disagreement @ply ${d.ply}: CVS ${d.cvsMove} vs SF ${d.sfBest} (−${d.cpLoss.toFixed(1)})`);
          if (cfg.branchPlies > 0) {
            const line = await playOutBest(sf, d, cfg.branchPlies, cfg.reviewDepth);
            for (const p of line) dataset.push(playoutToTraining(p));
          }
        }
      }

      // DECIDE: grow the dataset.
      for (const row of reviewedRound) if (row) dataset.push(row);

      // ACT: retrain on everything seen so far, benchmark on the fixed holdout.
      const trained = trainPolicy(dataset, { epochs: cfg.epochs });
      const tuned = new CvsEngine({ weights: trained.weights });
      const bench = benchmark(holdout, tuned, { topK: 3 });

      rounds.push({
        round,
        games: cfg.gamesPerRound,
        cvsPlies,
        disagreements,
        datasetSize: dataset.length,
        trainTop1: trained.history.at(-1)?.top1Accuracy ?? 0,
        holdoutTop1: bench.top1Match,
        holdoutAvgCpLoss: bench.avgCpLoss,
        gameResults,
      });
      log(
        `  Round ${round}: dataset=${dataset.length}, train top-1=${(trained.history.at(-1)?.top1Accuracy ?? 0) * 100 | 0
        }%, holdout top-1=${(bench.top1Match * 100).toFixed(1)}% (was ${(prevTop1 * 100).toFixed(1)}%)`,
      );

      weights = trained.weights; // the student plays with the latest policy next round
      if (bench.top1Match > bestTop1) {
        bestTop1 = bench.top1Match;
        bestWeights = trained.weights;
      }
      // Plateau: improvement stalled across a round.
      if (round >= 2 && bench.top1Match - prevTop1 < cfg.plateauEps) {
        log(`  Plateau (Δtop-1 ${(bench.top1Match - prevTop1).toFixed(4)} < ${cfg.plateauEps}) — stopping early.`);
        prevTop1 = bench.top1Match;
        break;
      }
      prevTop1 = bench.top1Match;
    }

    // Persist artifacts.
    mkdirSync(cfg.outDir, { recursive: true });
    saveDataset(`${cfg.outDir}/dataset.jsonl`, dataset);
    writeFileSync(`${cfg.outDir}/weights.json`, JSON.stringify(bestWeights, null, 2), 'utf8');
    writeFileSync(
      `${cfg.outDir}/report.json`,
      JSON.stringify({ baselineHoldoutTop1: baseline.top1Match, bestHoldoutTop1: bestTop1, rounds }, null, 2),
      'utf8',
    );

    return {
      baselineHoldoutTop1: baseline.top1Match,
      rounds,
      bestHoldoutTop1: bestTop1,
      finalWeights: bestWeights,
      datasetSize: dataset.length,
    };
  } finally {
    sf.dispose();
  }
}

// Run as a script (npm run arena:ooda), but never auto-run under Vitest.
if (!process.env.VITEST) {
  runOoda(DEFAULT_CONFIG, (m) => console.log(m))
    .then((res) => {
      console.log('\n=== OODA summary ===');
      console.log(`baseline holdout top-1: ${(res.baselineHoldoutTop1 * 100).toFixed(1)}%`);
      for (const r of res.rounds) {
        console.log(
          `round ${r.round}: holdout top-1 ${(r.holdoutTop1 * 100).toFixed(1)}%  | dataset ${r.datasetSize}  | disagreements ${r.disagreements}  | ${r.gameResults.join('; ')}`,
        );
      }
      console.log(`best holdout top-1: ${(res.bestHoldoutTop1 * 100).toFixed(1)}%  → arena/out/{weights,report}.json, dataset.jsonl`);
    })
    .catch((e) => {
      console.error('OODA run failed:', e);
      process.exit(1);
    });
}
