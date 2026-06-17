import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { idleStatus, normalizeTrainingConfig, parseProgress, readTrainReport } from './training-state';

describe('training supervisor state helpers', () => {
  it('normalizes default and caller-provided training config', () => {
    expect(normalizeTrainingConfig({})).toMatchObject({
      mode: 'import-train',
      input: 'fixtures/sample-game.pgn',
      datasetOut: 'arena/out/lichess-master-dataset.jsonl',
      weightsOut: 'arena/out/weights.json',
      reportOut: 'arena/out/train-report.json',
      depth: 10,
      limit: 50,
      maxPlies: 80,
      minElo: 2200,
      sampleEvery: 1,
      epochs: 120,
    });

    expect(
      normalizeTrainingConfig({
        mode: 'train-only',
        input: '  games.pgn  ',
        depth: Number.NaN,
        limit: 7,
        sampleEvery: 0,
      }),
    ).toMatchObject({
      mode: 'train-only',
      input: 'games.pgn',
      depth: 10,
      limit: 7,
      sampleEvery: 1,
    });
  });

  it('creates idle status from normalized config', () => {
    const cfg = normalizeTrainingConfig({ limit: 12 });
    expect(idleStatus(cfg)).toMatchObject({
      phase: 'idle',
      active: false,
      config: cfg,
      import: { seen: 0, imported: 0, skipped: 0, rows: 0, limit: 12 },
      train: { trainRows: 0, holdoutRows: 0, baselineTop1: null, tunedTop1: null },
      error: '',
      logs: [],
    });
  });

  it('parses import and training progress lines into status', () => {
    const status = idleStatus();
    parseProgress('imported game 3/10: foo (14 rows)', status);
    parseProgress('done: seen=9, imported=5, skipped=4, rows=71', status);
    parseProgress('trained 64 rows, holdout 7: top-1 42.5% -> 55.0%', status);

    expect(status.import).toEqual({ seen: 9, imported: 5, skipped: 4, rows: 71, limit: 10 });
    expect(status.train).toEqual({
      trainRows: 64,
      holdoutRows: 7,
      baselineTop1: 0.425,
      tunedTop1: 0.55,
    });
  });

  it('loads optional train report metrics when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvs-training-state-'));
    try {
      const report = join(dir, 'report.json');
      writeFileSync(
        report,
        JSON.stringify({
          trainRows: 100,
          holdoutRows: 11,
          baseline: { top1Match: 0.4 },
          tuned: { top1Match: 0.6 },
        }),
      );
      const status = idleStatus();

      readTrainReport(report, status);

      expect(status.train).toEqual({
        trainRows: 100,
        holdoutRows: 11,
        baselineTop1: 0.4,
        tunedTop1: 0.6,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
