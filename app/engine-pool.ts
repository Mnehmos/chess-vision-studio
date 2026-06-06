// Engine pool — a fixed set of independent single-threaded Stockfish workers.
// One UciEngine serializes its own searches (overlapping `go` corrupts UCI), so
// real parallel throughput over INDEPENDENT positions needs N engines fanned out.
// NOTE: browser-only — each engine boots a Web Worker via createBrowserStockfishTransport.
import { UciEngine } from '../engine/evaluation';
import { createBrowserStockfishTransport } from './engine-browser';

const WARMUP_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface EnginePool {
  size: number;
  run<T>(
    tasks: T[],
    fn: (engine: UciEngine, task: T) => Promise<void>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
  dispose(): void;
}

/** Sensible worker count: leave one core for the UI, cap at `max` (default 4), >=1. */
export function defaultPoolSize(max?: number): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(cores - 1, max ?? 4));
}

/** Boot up to `size` warmed engines concurrently; pool.size = how many survived. */
export async function createEnginePool(size: number): Promise<EnginePool> {
  const booted = await Promise.allSettled(
    Array.from({ length: size }, async () => {
      const engine = new UciEngine(createBrowserStockfishTransport());
      // Force the UCI handshake + first search so a lane never pays boot cost mid-run.
      await engine.evaluate({ fen: WARMUP_FEN, depth: 1 });
      return engine;
    }),
  );

  const engines: UciEngine[] = [];
  for (const r of booted) {
    if (r.status === 'fulfilled') engines.push(r.value);
  }

  return {
    size: engines.length,
    async run(tasks, fn, onProgress) {
      const total = tasks.length;
      if (engines.length === 0 || total === 0) return;
      // Shared cursor + done counter — single-threaded JS makes the ++ atomic.
      let cursor = 0;
      let done = 0;
      const lane = async (engine: UciEngine): Promise<void> => {
        for (;;) {
          const i = cursor++;
          if (i >= total) return;
          try {
            await fn(engine, tasks[i]);
          } catch {
            // Swallow: one bad ply must not stall the run; the caller's fn owns its errors.
          }
          done++;
          onProgress?.(done, total);
        }
      };
      await Promise.all(engines.map((engine) => lane(engine)));
    },
    dispose() {
      for (const engine of engines) engine.dispose();
    },
  };
}
