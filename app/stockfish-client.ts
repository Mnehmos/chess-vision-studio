// Native-Stockfish client. The reference oracle now runs as a pooled native
// subprocess on the dev server (see stockfishProxy in vite.config.ts) instead
// of an in-browser WASM worker. makeNativeStockfishEngine adapts the HTTP
// endpoint to the UciEngine.evaluate() surface analyzeMoveLive consumes, so the
// whole classification pipeline runs on native Stockfish when a binary is
// configured — same moves at a given depth, just far faster wall-clock.
import { uciPvToSan, type UciEngine } from '../engine/evaluation';

export interface StockfishHealth {
  ok: boolean;
  available: boolean;
  exe?: string;
  depth?: number;
  error?: string;
}

export interface StockfishResult {
  fen: string;
  bestmove: string;
  scoreCp: number;
  mate: number | null;
  pv: string[]; // UCI
  depth: number;
}

export async function getStockfishHealth(): Promise<StockfishHealth> {
  const response = await fetch('/api/stockfish/health');
  if (!response.ok) throw new Error(`Stockfish health failed (${response.status})`);
  return (await response.json()) as StockfishHealth;
}

export async function analyzeWithStockfish(fen: string, depth?: number, forcedMove?: string): Promise<StockfishResult> {
  const response = await fetch('/api/stockfish/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth, forcedMove }),
  });
  const body = (await response.json()) as StockfishResult | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error || `Stockfish analyze failed (${response.status})`);
  return body as StockfishResult;
}

// A UciEngine-shaped adapter over the native subprocess. analyzeMoveLive only
// uses .evaluate(); evaluateMultiPV/dispose are provided for interface parity.
// Score is side-to-move POV (UCI convention), matching Eval.cp.
export function makeNativeStockfishEngine(defaultDepth?: number): UciEngine {
  const evaluate = async (req: { fen: string; depth?: number; timeoutMs?: number; multipv?: number }) => {
    const depth = req.depth ?? defaultDepth ?? 12;
    try {
      const r = await analyzeWithStockfish(req.fen, depth);
      const pv = uciPvToSan(req.fen, r.pv ?? []);
      return r.mate != null
        ? { mate: r.mate, depth: r.depth, pv }
        : { cp: r.scoreCp, depth: r.depth, pv };
    } catch {
      return { depth, pv: [] as string[], status: 'unavailable' as const, reason: 'engine_error' as const };
    }
  };
  return {
    evaluate,
    evaluateMultiPV: async (req: { fen: string; depth?: number }) => [await evaluate(req)],
    dispose: () => {},
  } as unknown as UciEngine;
}
