// Lichess MovePicker backed by the Rust engine (the active backend). Clock
// budgets map straight onto the serve protocol's `go <ms>` command; no budget
// (correspondence etc.) falls back to a fixed per-move time. The legacy TS
// cvsPicker remains available via CVS_ENGINE_BACKEND=ts.
import { RustBackend } from '../engine-backend/rust-backend';
import type { MovePicker } from './session';

export function rustPicker(opts: { fallbackMs?: number; backend?: RustBackend } = {}): MovePicker & { dispose(): void } {
  const fallbackMs = opts.fallbackMs ?? 500;
  const backend = opts.backend ?? new RustBackend();
  return {
    name: `cvs-rust@${fallbackMs}ms`,
    async pick(fen, budgetMs, context) {
      const budget = budgetMs && Number.isFinite(budgetMs) ? Math.max(100, Math.min(budgetMs, 10_000)) : fallbackMs;
      try {
        const r = await backend.bestMoveTimed(fen, budget, context);
        return r.uci;
      } catch {
        return null; // session treats null as engine failure and resigns safely
      }
    },
    dispose() {
      backend.dispose();
    },
  };
}
