import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrainingPosition } from '@cvs/engine';
import type { UciEngine } from '../../engine/evaluation';
import { disposeHarvestStockfish, getHarvestStockfish, withGameProvenance } from './harvest';

afterEach(() => {
  disposeHarvestStockfish();
});

describe('Lichess harvest Stockfish lifecycle', () => {
  it('attaches game and label provenance to every harvested row', () => {
    const row = {
      fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
      source: 'bot_game',
    } as TrainingPosition;

    expect(withGameProvenance(row, 'game123', 24)).toMatchObject({
      gameId: 'game123',
      sourceKey: 'lichess:game123',
      labelDepth: 24,
    });
  });

  it('reuses one UCI engine across completed games', async () => {
    const engine = { dispose: vi.fn() } as unknown as UciEngine;
    const factory = vi.fn(async () => engine);

    const first = await getHarvestStockfish(factory);
    const second = await getHarvestStockfish(factory);

    expect(first).toBe(engine);
    expect(second).toBe(engine);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disposes and resets the shared engine', async () => {
    const first = { dispose: vi.fn() } as unknown as UciEngine;
    const second = { dispose: vi.fn() } as unknown as UciEngine;
    const factory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await getHarvestStockfish(factory);
    disposeHarvestStockfish();
    const next = await getHarvestStockfish(factory);

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(next).toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
