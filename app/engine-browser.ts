// Browser transport for Stockfish via a classic Web Worker. The single-threaded
// nmrugg build auto-wires worker messaging; we pass the .wasm URL through the
// worker URL hash so locateFile resolves it (Vite fingerprints both assets).
// NOTE: browser-only — Node/Vitest uses createNodeStockfishTransport instead.
import sfUrl from 'stockfish/src/stockfish-nnue-16-single.js?url';
import wasmUrl from 'stockfish/src/stockfish-nnue-16-single.wasm?url';
import { UciEngine, type EngineTransport } from '../engine/evaluation';

export function createBrowserStockfishTransport(): EngineTransport {
  const worker = new Worker(`${sfUrl}#${encodeURIComponent(wasmUrl)}`);
  const handlers: ((line: string) => void)[] = [];
  worker.onmessage = (e: MessageEvent) => {
    const line = typeof e.data === 'string' ? e.data : String(e.data);
    for (const h of handlers) h(line);
  };
  return {
    send: (command: string) => worker.postMessage(command),
    onLine: (handler) => handlers.push(handler),
    dispose: () => worker.terminate(),
  };
}

/** Best-effort engine boot. Resolves null if Stockfish fails to load so the app
 *  can still run all the pure (engine-free) modes. */
export async function tryCreateEngine(): Promise<UciEngine | null> {
  try {
    const engine = new UciEngine(createBrowserStockfishTransport());
    // Force the handshake to complete (UciEngine sends uci/isready in ctor).
    await engine.evaluate({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      depth: 1,
    });
    return engine;
  } catch (err) {
    console.warn('Stockfish failed to load; running pure modes only.', err);
    return null;
  }
}
