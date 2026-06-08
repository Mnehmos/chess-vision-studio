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

export async function harvestGame(
  res: SessionResult,
  cfg: LichessConfig,
  log: (m: string) => void = () => {},
): Promise<number> {
  const transport = await createNodeStockfishTransport();
  const sf = new UciEngine(transport);
  try {
    const reviewed = await reviewGame(sf, res.record.plies, cfg.reviewDepth, (p) => p.by === res.cvsColor);
    const rows: TrainingPosition[] = [];
    for (const r of reviewed) {
      const row = reviewedToTraining(r); // source defaults to 'bot_game'
      if (row) rows.push(row);
    }
    const dis = findDisagreements(reviewed, 0.5);
    for (const d of dis) {
      const line = await playOutBest(sf, d, 2, cfg.reviewDepth);
      for (const p of line) rows.push(playoutToTraining(p));
    }
    if (rows.length) {
      mkdirSync(cfg.outDir, { recursive: true });
      const path = `${cfg.outDir}/lichess-dataset.jsonl`;
      appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      log(`harvested ${rows.length} rows from ${res.gameId} (${dis.length} disagreements) -> ${path}`);
    }
    return rows.length;
  } finally {
    sf.dispose();
  }
}
