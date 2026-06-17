import { DEFAULT_STOCKFISH_REVIEW_DEPTH } from '../arena/review-config';

export type TrainingPhase = 'idle' | 'importing' | 'training' | 'done' | 'error' | 'stopped';

export interface TrainingConfig {
  mode: 'import-train' | 'train-only';
  input: string;
  datasetOut: string;
  weightsOut: string;
  reportOut: string;
  depth: number;
  limit: number;
  maxPlies: number;
  minElo: number;
  sampleEvery: number;
  epochs: number;
}

export interface TrainingStatus {
  phase: TrainingPhase;
  active: boolean;
  startedAt: string | null;
  endedAt: string | null;
  config: TrainingConfig;
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

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  mode: 'import-train',
  input: 'fixtures/sample-game.pgn',
  datasetOut: 'arena/out/lichess-master-dataset.jsonl',
  weightsOut: 'arena/out/weights.json',
  reportOut: 'arena/out/train-report.json',
  depth: DEFAULT_STOCKFISH_REVIEW_DEPTH,
  limit: 50,
  maxPlies: 80,
  minElo: 2200,
  sampleEvery: 1,
  epochs: 120,
};

export const IDLE_TRAINING_STATUS: TrainingStatus = {
  phase: 'idle',
  active: false,
  startedAt: null,
  endedAt: null,
  config: DEFAULT_TRAINING_CONFIG,
  import: { seen: 0, imported: 0, skipped: 0, rows: 0, limit: DEFAULT_TRAINING_CONFIG.limit },
  train: { trainRows: 0, holdoutRows: 0, baselineTop1: null, tunedTop1: null },
  error: '',
  logs: [],
};

export async function fetchTrainingStatus(): Promise<TrainingStatus | null> {
  const response = await fetch('/api/training/status');
  if (!response.ok) return null;
  return (await response.json()) as TrainingStatus;
}

export async function startTraining(config: TrainingConfig): Promise<TrainingStatus> {
  const response = await fetch('/api/training/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return readTrainingStatusResponse(response, 'start failed');
}

export async function stopTraining(): Promise<TrainingStatus> {
  const response = await fetch('/api/training/stop', { method: 'POST' });
  return readTrainingStatusResponse(response, 'stop failed');
}

export function openTrainingEvents(
  onStatus: (status: TrainingStatus) => void,
  onError: () => void,
): EventSource {
  const events = new EventSource('/api/training/events');
  events.onmessage = (ev) => onStatus(JSON.parse(ev.data) as TrainingStatus);
  events.onerror = onError;
  return events;
}

async function readTrainingStatusResponse(
  response: Response,
  fallback: string,
): Promise<TrainingStatus> {
  const body = (await response.json().catch(() => ({}))) as TrainingStatus | { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as TrainingStatus;
}
