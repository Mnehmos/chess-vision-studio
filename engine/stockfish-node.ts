// Node/test transport for Stockfish (single-threaded WASM build).
// Implements the EngineTransport seam so UciEngine never knows the environment.
// NOTE: imported only in Node/Vitest — the browser uses a Web Worker transport.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { EngineTransport } from './evaluation';

const require = createRequire(import.meta.url);

interface SfEngine {
  addMessageListener(cb: (line: unknown) => void): void;
  onCustomMessage(cmd: string): void;
  terminate?(): void;
}

/**
 * Boot the single-threaded Stockfish 16 build. In that build the real input
 * path is `onCustomMessage` (plain `postMessage` targets PThreads that do not
 * exist single-threaded), and output arrives via `addMessageListener`.
 */
export async function createNodeStockfishTransport(): Promise<EngineTransport> {
  const entry = require.resolve('stockfish/src/stockfish-nnue-16-single.js');
  const wasm = join(dirname(entry), 'stockfish-nnue-16-single.wasm');
  // The module exports a factory-of-a-factory (see package internals).
  const outer = require(entry) as () => (opts: {
    locateFile: (f: string) => string;
  }) => Promise<SfEngine>;
  const engine = await outer()({
    locateFile: (f: string) => (f.endsWith('.wasm') ? wasm : f),
  });

  const handlers: ((line: string) => void)[] = [];
  engine.addMessageListener((line) => {
    const s = String(line);
    for (const h of handlers) h(s);
  });

  return {
    send(command: string) {
      engine.onCustomMessage(command);
    },
    onLine(handler: (line: string) => void) {
      handlers.push(handler);
    },
    dispose() {
      try {
        engine.onCustomMessage('quit');
        engine.terminate?.();
      } catch {
        /* ignore */
      }
    },
  };
}
