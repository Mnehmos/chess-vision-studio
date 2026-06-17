import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from '../review-config';

export type TrainingPhase = 'idle' | 'importing' | 'training' | 'done' | 'error' | 'stopped';

export interface TrainingStartConfig {
  mode?: 'import-train' | 'train-only';
  input?: string;
  datasetOut?: string;
  weightsOut?: string;
  reportOut?: string;
  depth?: number;
  limit?: number;
  maxPlies?: number;
  minElo?: number;
  sampleEvery?: number;
  epochs?: number;
}

export interface TrainingStatus {
  phase: TrainingPhase;
  active: boolean;
  startedAt: string | null;
  endedAt: string | null;
  config: Required<TrainingStartConfig>;
  import: { seen: number; imported: number; skipped: number; rows: number; limit: number };
  train: {
    trainRows: number;
    holdoutRows: number;
    baselineTop1: number | null;
    tunedTop1: number | null;
  };
  error: string;
  logs: string[];
}

export function normalizeTrainingConfig(raw: TrainingStartConfig): Required<TrainingStartConfig> {
  const num = (v: number | undefined, fallback: number) =>
    Number.isFinite(v) && v !== undefined ? v : fallback;
  return {
    mode: raw.mode ?? 'import-train',
    input: raw.input?.trim() || 'fixtures/sample-game.pgn',
    datasetOut: raw.datasetOut?.trim() || 'arena/out/lichess-master-dataset.jsonl',
    weightsOut: raw.weightsOut?.trim() || 'arena/out/weights.json',
    reportOut: raw.reportOut?.trim() || 'arena/out/train-report.json',
    depth: num(raw.depth, DEFAULT_STOCKFISH_REVIEW_DEPTH),
    limit: num(raw.limit, 50),
    maxPlies: num(raw.maxPlies, 80),
    minElo: num(raw.minElo, 2200),
    sampleEvery: Math.max(1, num(raw.sampleEvery, 1)),
    epochs: num(raw.epochs, 120),
  };
}

export function idleStatus(
  config: Required<TrainingStartConfig> = normalizeTrainingConfig({}),
): TrainingStatus {
  return {
    phase: 'idle',
    active: false,
    startedAt: null,
    endedAt: null,
    config,
    import: { seen: 0, imported: 0, skipped: 0, rows: 0, limit: config.limit },
    train: { trainRows: 0, holdoutRows: 0, baselineTop1: null, tunedTop1: null },
    error: '',
    logs: [],
  };
}

export function parseProgress(line: string, status: TrainingStatus): void {
  const imported = /imported game\s+(\d+)\/(\d+):.*\((\d+)\s+rows\)/.exec(line);
  if (imported) {
    status.import.imported = Number(imported[1]);
    status.import.limit = Number(imported[2]);
    status.import.rows += Number(imported[3]);
  }
  const done = /done:\s+seen=(\d+),\s+imported=(\d+),\s+skipped=(\d+),\s+rows=(\d+)/.exec(line);
  if (done) {
    status.import.seen = Number(done[1]);
    status.import.imported = Number(done[2]);
    status.import.skipped = Number(done[3]);
    status.import.rows = Number(done[4]);
  }
  const trained =
    /trained\s+(\d+)\s+rows,\s+holdout\s+(\d+):\s+top-1\s+([\d.]+)%\s+->\s+([\d.]+)%/.exec(line);
  if (trained) {
    status.train.trainRows = Number(trained[1]);
    status.train.holdoutRows = Number(trained[2]);
    status.train.baselineTop1 = Number(trained[3]) / 100;
    status.train.tunedTop1 = Number(trained[4]) / 100;
  }
}

export function readTrainReport(path: string, status: TrainingStatus): void {
  if (!existsSync(path)) return;
  try {
    const report = JSON.parse(readFileSync(path, 'utf8')) as {
      trainRows?: number;
      holdoutRows?: number;
      baseline?: { top1Match?: number };
      tuned?: { top1Match?: number };
    };
    status.train.trainRows = report.trainRows ?? status.train.trainRows;
    status.train.holdoutRows = report.holdoutRows ?? status.train.holdoutRows;
    status.train.baselineTop1 = report.baseline?.top1Match ?? status.train.baselineTop1;
    status.train.tunedTop1 = report.tuned?.top1Match ?? status.train.tunedTop1;
  } catch {
    // Report is optional; stdout parsing still gives the monitor useful data.
  }
}
