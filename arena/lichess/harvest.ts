// Turn a finished Lichess game into OODA training signal: Stockfish reviews each
// CVS ply, disagreements are "played out" a couple plies, and every reviewed/
// played-out position is appended (source 'bot_game') to a dataset JSONL the
// trainer can fold in. Reuses the exact arena review/disagree/dataset pipeline.
import { mkdirSync, appendFileSync } from 'node:fs';
import type { TrainingPosition } from '@cvs/engine';
import { UciEngine } from '../../engine/evaluation';
import { createNodeStockfishTransport } from '../../engine/stockfish-node';
import { reviewGame } from '../review';
import { findDisagreements, playOutBest } from '../disagree';
import { reviewedToTraining, playoutToTraining } from '../dataset';
import type { SessionResult } from './session';
import type { LichessConfig } from './env';

type StockfishFactory = () => Promise<UciEngine>;
type HarvestTrainingPosition = TrainingPosition & {
  gameId: string;
  sourceKey: string;
  labelDepth: number;
};

let sharedStockfish: Promise<UciEngine> | undefined;
let activeStockfish: UciEngine | undefined;

async function createStockfish(): Promise<UciEngine> {
  return new UciEngine(await createNodeStockfishTransport());
}

/**
 * Stockfish.js 16's Node factory is single-use within a process. Keep one
 * serialized UCI client for every completed bot game instead of constructing
 * and disposing a new WASM module after each harvest.
 */
export function getHarvestStockfish(
  factory: StockfishFactory = createStockfish,
): Promise<UciEngine> {
  if (!sharedStockfish) {
    sharedStockfish = factory()
      .then((engine) => {
        activeStockfish = engine;
        return engine;
      })
      .catch((error) => {
        sharedStockfish = undefined;
        throw error;
      });
  }
  return sharedStockfish;
}

export function disposeHarvestStockfish(): void {
  activeStockfish?.dispose();
  activeStockfish = undefined;
  sharedStockfish = undefined;
}

export function withGameProvenance(
  row: TrainingPosition,
  gameId: string,
  labelDepth: number,
): HarvestTrainingPosition {
  return {
    ...row,
    gameId,
    sourceKey: `lichess:${gameId}`,
    labelDepth,
  };
}

export async function harvestGame(
  res: SessionResult,
  cfg: LichessConfig,
  log: (m: string) => void = () => {},
): Promise<number> {
  const sf = await getHarvestStockfish();
  const reviewed = await reviewGame(
    sf,
    res.record.plies,
    cfg.reviewDepth,
    (p) => p.by === res.cvsColor,
  );
  const rows: HarvestTrainingPosition[] = [];
  for (const r of reviewed) {
    const row = reviewedToTraining(r); // source defaults to 'bot_game'
    if (row) rows.push(withGameProvenance(row, res.gameId, cfg.reviewDepth));
  }
  const dis = findDisagreements(reviewed, 0.5);
  for (const d of dis) {
    const line = await playOutBest(sf, d, 2, cfg.reviewDepth);
    for (const p of line) {
      rows.push(withGameProvenance(playoutToTraining(p), res.gameId, cfg.reviewDepth));
    }
  }
  if (rows.length) {
    mkdirSync(cfg.outDir, { recursive: true });
    const path = `${cfg.outDir}/lichess-dataset.jsonl`;
    appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    log(
      `harvested ${rows.length} rows from ${res.gameId} (${dis.length} disagreements) -> ${path}`,
    );
  }
  return rows.length;
}
