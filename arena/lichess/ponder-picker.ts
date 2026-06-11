// Opponent-clock ponder cache for the Lichess bot — the PROMOTED bot-layer
// design from the 2026-06-11 gate (plain deeper search on predicted replies;
// the lane/arbiter variants were tested and rejected at this layer).
//
// Shape: after we pick a move, speculatively (a) rank the opponent's replies
// by a quick d4 child verification, (b) deep-search the top-K predicted child
// positions on a DEDICATED serve process while the opponent thinks, caching
// prepared moves by child FEN. On our next turn: cache hit -> spend ~1/4 of
// the budget on a quick verify; if it agrees, play the prepared move
// immediately (the other 3/4 stays on our clock). Any disagreement falls back
// to a normal full search of the remaining budget. "Cache suggests. Current
// search verifies."
//
// Measured (80 real transitions, SF-d12 child cp-loss): ~89% hit rate,
// avgCP 28.2 -> 24.9, >=200cp blunders 1.2% -> 0%. Disable: CVS_PONDER=0.
import { Chess } from 'chess.js';
import { RustBackend } from '../engine-backend/rust-backend';
import type { MovePicker } from './session';

export interface PonderOptions {
  /** Predicted replies to prepare (rank-1 gets the deepest budget). */
  topK?: number;
  /** Deep-search budget per predicted child (ms). */
  deepMs?: number;
  /** Fraction of our budget spent verifying a cache hit. */
  verifySlice?: number;
  backend?: RustBackend;
}

export function ponderPicker(
  base: MovePicker & { dispose(): void },
  opts: PonderOptions = {},
): MovePicker & { dispose(): void } {
  const topK = opts.topK ?? 3;
  const deepMs = opts.deepMs ?? 3000;
  const verifySlice = opts.verifySlice ?? 0.25;
  // Dedicated serve processes: speculation must never block a real pick.
  const ponder = opts.backend ?? new RustBackend();
  const cache = new Map<string, string>(); // child fen -> prepared uci
  let epoch = 0; // bumped per real pick; stale speculation drops out
  let stats = { picks: 0, hits: 0, fastPlays: 0 };

  async function speculate(childFen: string, myEpoch: number, budgetMs: number): Promise<void> {
    try {
      const board = new Chess(childFen);
      if (board.isGameOver()) return;
      // Rank the opponent's legal replies by quick child verification: they
      // will pick the move that leaves US worst, so sort by our score asc.
      const replies: { uci: string; ourCp: number }[] = [];
      for (const m of board.moves({ verbose: true })) {
        if (epoch !== myEpoch) return;
        const b2 = new Chess(childFen);
        b2.move(m);
        const uci = m.from + m.to + (m.promotion ?? '');
        if (b2.isGameOver()) {
          replies.push({ uci, ourCp: b2.isCheckmate() ? -100000 : 0 });
          continue;
        }
        const r = await ponder.bestMove(b2.fen(), { depth: 4 });
        if (r.uci !== null) replies.push({ uci, ourCp: r.scoreCp ?? 0 });
      }
      replies.sort((a, b) => a.ourCp - b.ourCp);
      const deep = Math.max(500, Math.min(deepMs, budgetMs));
      for (const [rank, reply] of replies.slice(0, topK).entries()) {
        if (epoch !== myEpoch) return;
        const b2 = new Chess(childFen);
        b2.move(reply.uci);
        if (b2.isGameOver()) continue;
        // Rank 1 gets the full slice; lower ranks shallower (tiered effort).
        const r = await ponder.bestMoveTimed(b2.fen(), rank === 0 ? deep : Math.max(400, deep / 3));
        if (epoch === myEpoch && r.uci) cache.set(b2.fen(), r.uci);
      }
    } catch {
      /* speculation is best-effort; never surface errors into the game */
    }
  }

  return {
    name: `${base.name}+ponder(k${topK})`,
    async pick(fen, budgetMs, context) {
      epoch += 1;
      const myEpoch = epoch;
      const budget = budgetMs && Number.isFinite(budgetMs) ? budgetMs : 1000;
      stats.picks += 1;
      let chosen: string | null = null;
      const prepared = cache.get(fen);
      cache.clear(); // single-shot: the game has moved past everything else
      if (prepared) {
        stats.hits += 1;
        const verify = await base.pick(fen, Math.max(150, budget * verifySlice), context);
        if (verify === prepared) {
          chosen = prepared; // agreement: play instantly, bank the rest
          stats.fastPlays += 1;
        } else {
          // Disagreement: distrust the cache, search the remaining budget.
          chosen = await base.pick(fen, Math.max(150, budget * (1 - verifySlice)), context);
        }
      } else {
        chosen = await base.pick(fen, budget, context);
      }
      if (chosen) {
        const after = new Chess(fen);
        try {
          after.move(chosen);
          void speculate(after.fen(), myEpoch, budget);
        } catch {
          /* illegal should be impossible; never block the move */
        }
      }
      return chosen;
    },
    dispose() {
      epoch += 1;
      // eslint-disable-next-line no-console
      console.log(`ponder stats: picks=${stats.picks} hits=${stats.hits} fastPlays=${stats.fastPlays}`);
      ponder.dispose();
      base.dispose();
    },
  };
}
