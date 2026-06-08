// Review layer — Stockfish is the teacher/oracle. For each ply we score the
// played move against Stockfish's best at the same position. This is the
// LIGHTWEIGHT review (two evals/ply); it skips the full saliency/explanation
// pipeline because the OODA loop only needs the label (SF best) + cpLoss.
import { computeCpLoss, classify } from '../engine/classify';
import type { UciEngine } from '../engine/evaluation';
import type { PlayedPly } from './match';

export interface ReviewedPly {
  ply: number;
  by: 'white' | 'black';
  player: string;
  fenBefore: string;
  playedSan: string;
  playedUci: string;
  sfBestSan: string | null; // Stockfish's best at fenBefore (pv[0], SAN)
  cpLoss: number; // PAWNS the played move lost vs SF best (>= 0)
  classification: string;
  evalBeforeCp: number | null; // SF eval before, side-to-move POV, in pawns
}

export async function reviewPly(engine: UciEngine, ply: PlayedPly, depth: number): Promise<ReviewedPly> {
  const [evalBefore, evalAfter] = [
    await engine.evaluate({ fen: ply.fenBefore, depth }),
    await engine.evaluate({ fen: ply.fenAfter, depth }),
  ];
  const cpLoss =
    evalBefore.status === 'unavailable' || evalAfter.status === 'unavailable'
      ? 0
      : computeCpLoss(evalBefore, evalAfter);
  return {
    ply: ply.ply,
    by: ply.by,
    player: ply.player,
    fenBefore: ply.fenBefore,
    playedSan: ply.san,
    playedUci: ply.uci,
    sfBestSan: evalBefore.pv?.[0] ?? null,
    cpLoss,
    classification: classify(cpLoss),
    evalBeforeCp: evalBefore.cp !== undefined ? evalBefore.cp / 100 : null,
  };
}

/** Review the plies (optionally filtered to one side — the engine being trained). */
export async function reviewGame(
  engine: UciEngine,
  plies: PlayedPly[],
  depth: number,
  filter?: (p: PlayedPly) => boolean,
): Promise<ReviewedPly[]> {
  const out: ReviewedPly[] = [];
  for (const p of plies) {
    if (filter && !filter(p)) continue;
    out.push(await reviewPly(engine, p, depth));
  }
  return out;
}
