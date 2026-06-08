// Disagreement detection + "play it out". A disagreement is a ply the CVS engine
// chose that (a) differs from Stockfish's best AND (b) actually cost something
// (cpLoss >= threshold) — a genuine teaching moment, not just a different equal move.
// "Play it out from that position" = run Stockfish's BEST line forward a few plies
// (the correction) and harvest those positions as extra, clean training signal.
import { Chess } from 'chess.js';
import { uciToMove } from './players';
import type { UciEngine } from '../engine/evaluation';
import type { ReviewedPly } from './review';

export interface Disagreement {
  ply: number;
  fenBefore: string;
  cvsMove: string; // SAN the CVS engine played
  sfBest: string; // SAN Stockfish preferred
  cpLoss: number; // pawns lost
  classification: string;
}

function sanEq(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/[+#!?]/g, '').trim();
  return n(a) === n(b);
}

/** CVS-side plies where the engine diverged from Stockfish AND it cost >= minCpLoss pawns. */
export function findDisagreements(reviewed: ReviewedPly[], minCpLoss = 0.5): Disagreement[] {
  const out: Disagreement[] = [];
  for (const r of reviewed) {
    if (!r.sfBestSan) continue;
    if (sanEq(r.playedSan, r.sfBestSan)) continue; // agreed with Stockfish
    if (r.cpLoss < minCpLoss) continue; // a different but not-worse move — fine
    out.push({
      ply: r.ply,
      fenBefore: r.fenBefore,
      cvsMove: r.playedSan,
      sfBest: r.sfBestSan,
      cpLoss: r.cpLoss,
      classification: r.classification,
    });
  }
  return out;
}

export interface PlayoutPosition {
  fen: string;
  bestSan: string;
  bestUci: string;
}

/**
 * From the disagreement position, play Stockfish's best move and continue
 * Stockfish-vs-Stockfish for `plies` half-moves. Each visited position is paired
 * with the move Stockfish chose there (its own best → a clean label). This is the
 * "correct continuation" the engine should have understood; folding it into the
 * dataset teaches the policy the line it missed.
 */
export async function playOutBest(
  engine: UciEngine,
  d: Disagreement,
  plies: number,
  depth: number,
): Promise<PlayoutPosition[]> {
  const chess = new Chess(d.fenBefore);
  const out: PlayoutPosition[] = [];
  for (let i = 0; i < plies && !chess.isGameOver(); i++) {
    const fen = chess.fen();
    const uci = await engine.bestMove(fen, depth);
    if (!uci || uci === '(none)' || uci === '0000') break;
    let m;
    try {
      m = chess.move(uciToMove(uci)); // beta.8 throws on an illegal move
    } catch {
      break;
    }
    if (!m) break;
    out.push({ fen, bestSan: m.san, bestUci: uci });
  }
  return out;
}
