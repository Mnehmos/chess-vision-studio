import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UciEngine } from '../../engine/evaluation';
import { disposeHarvestStockfish, getHarvestStockfish } from './harvest';

afterEach(() => {
  disposeHarvestStockfish();
});

describe('Lichess harvest Stockfish lifecycle', () => {
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
