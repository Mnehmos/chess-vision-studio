// A weakness-harness Player backed by the REAL CVS (the Rust engine), so self-play
// pits actual CVS configs against each other. String boundary: FEN in, UCI out.
import { Chess } from 'chess.js';
import type { RustBackend } from '../engine-backend/rust-backend';
import { applyUci, type Player } from '../players';

/** Clock-budgeted Rust-CVS player. `backend` carries the config (--threads/--cvs-helpers/etc). */
export function rustPlayer(backend: RustBackend, opts: { name: string; budgetMs?: number }): Player {
  const budget = opts.budgetMs ?? 1000;
  return {
    name: opts.name,
    async pick(fen) {
      if (new Chess(fen).isGameOver()) return null;
      try {
        const r = await backend.bestMoveTimed(fen, budget);
        if (!r.uci) return null;
        const applied = applyUci(fen, r.uci);
        return applied ? { san: applied.san, uci: r.uci } : null;
      } catch {
        return null; // a dead/timed-out worker ends the game cleanly rather than throwing
      }
    },
  };
}
