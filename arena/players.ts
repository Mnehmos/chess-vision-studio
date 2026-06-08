// Arena players — a Player is just (fen) → a chosen move. The cross-repo boundary
// is STRING-ONLY (FEN in, UCI out): the app's chess.js (beta.8) and @cvs/engine's
// chess.js (1.4.0) never exchange objects, so version skew can't bite. SAN is
// derived locally (with the app's chess.js) for logging only.
import { Chess } from 'chess.js';
import type { UciEngine } from '../engine/evaluation';
import type { CvsEngine } from '@cvs/engine';

export interface PickedMove {
  san: string;
  uci: string;
}

export interface Player {
  readonly name: string;
  /** Choose a move from `fen`. Returns null only at a terminal position / no move. */
  pick(fen: string): Promise<PickedMove | null>;
}

/** Parse a UCI move (e2e4 / e7e8q) into a chess.js move descriptor. */
export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  };
}

/** Apply a UCI move to a FEN; returns the SAN + resulting FEN, or null if illegal.
 *  (chess.js beta.8 THROWS on an illegal move rather than returning null.) */
export function applyUci(fen: string, uci: string): { san: string; fenAfter: string } | null {
  const chess = new Chess(fen);
  try {
    const m = chess.move(uciToMove(uci));
    return m ? { san: m.san, fenAfter: chess.fen() } : null;
  } catch {
    return null;
  }
}

/** Stockfish opponent: UciEngine.bestMove → UCI; SAN derived via the app's chess.js. */
export function stockfishPlayer(engine: UciEngine, depth: number): Player {
  return {
    name: `stockfish@${depth}`,
    async pick(fen) {
      if (new Chess(fen).isGameOver()) return null;
      const uci = await engine.bestMove(fen, depth);
      if (!uci || uci === '(none)' || uci === '0000') return null;
      const applied = applyUci(fen, uci);
      return applied ? { san: applied.san, uci } : null;
    },
  };
}

/** The CVS engine: search-backed best move. Returns {san, uci}; we re-derive both
 *  from UCI so the move is guaranteed legal on the app's board. */
export function cvsPlayer(engine: CvsEngine, opts: { depth?: number; maxTimeMs?: number } = {}): Player {
  const depth = opts.depth ?? 3;
  return {
    name: `cvs@${depth}`,
    async pick(fen) {
      const best = engine.bestMove(fen, { depth, maxTimeMs: opts.maxTimeMs });
      if (!best) return null;
      const applied = applyUci(fen, best.uci);
      return applied ? { san: applied.san, uci: best.uci } : null;
    },
  };
}

/** A deterministic scripted player (for tests): plays the given UCI moves in order. */
export function scriptedPlayer(name: string, ucis: string[]): Player {
  let i = 0;
  return {
    name,
    async pick(fen) {
      const uci = ucis[i++];
      if (!uci) return null;
      const applied = applyUci(fen, uci);
      return applied ? { san: applied.san, uci } : null;
    },
  };
}
