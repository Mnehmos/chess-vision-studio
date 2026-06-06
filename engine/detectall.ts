// Comprehensive OFFLINE / async detector. Combines the fast Tier-1 geometric
// motifs with the heavier, budgeted detectors:
//   - gated mate proof (proof.ts) — only runs the bounded solver when a cheap
//     gate fires (start position → never)
//   - skewer/pin move-solvers (tacticmoves) and Tier-2 motifs (tier2), both
//     search-validated.
// This is NOT for the live render path (it runs bounded searches). The live app
// uses Stockfish's mate score + Tier-1 geometry; this powers the offline
// triangulation harness and the future async obligation queue.
import { Chess } from 'chess.js';
import { detectAvailableMotifs } from './motif';
import { findPinSkewerTactics } from './tacticmoves';
import { detectTier2 } from './tier2';
import { proveMate } from './proof';
import { parseFen, pieceAt } from './board';
import type { Motif } from './types';

export interface DetectAllOpts {
  mateBudgetMs?: number; // wall-clock budget for the gated mate proof
  stockfishMate?: number; // if the oracle already reported a mate, the strongest gate
}

export function detectAllMotifs(fen: string, opts: DetectAllOpts = {}): Motif[] {
  const out: Motif[] = [];

  // Tier-1 (fast, geometric) — forks, mate-in-1, pins/skewers (static).
  out.push(...detectAvailableMotifs(fen).motifs);

  // Gated deep mate (mate-in-N) — only searches when a cheap gate fires.
  const mate = proveMate(fen, {
    stockfishMate: opts.stockfishMate,
    timeBudgetMs: opts.mateBudgetMs ?? 2000,
  });
  if (mate?.status === 'proved' && mate.line && mate.line.length) {
    out.push(mateMotif(fen, mate.line, mate.mateInMoves ?? mate.line.length));
  }

  // Skewer/pin TACTICS (the move that creates a winning skewer/pin) + Tier-2.
  out.push(...findPinSkewerTactics(fen));
  out.push(...detectTier2(fen));

  return dedupe(out);
}

let mateId = 0;
function mateMotif(fen: string, line: string[], mateInMoves: number): Motif {
  const board = parseFen(fen);
  const mover = board.turn;
  // landing square of the FIRST move (the key move) for byPiece/squares
  const c = new Chess(fen);
  const first = c.move(line[0]);
  const fromPiece = first ? pieceAt(parseFen(c.fen()), first.to) : null;
  mateId += 1;
  return {
    id: `mate-proof-${mateId}`,
    kind: 'motif',
    type: 'mating_net',
    tier: 1,
    byPiece: fromPiece ? mover + fromPiece.type.toUpperCase() + first!.to : 'n/a',
    line,
    consequence: { materialSwing: 0, mateIn: mateInMoves },
    proposedBy: 'heuristic',
    validatedBy: 'engine_pv',
    side: mover === 'w' ? 'white' : 'black',
    squares: [first?.to ?? ''].filter(Boolean),
    arrows: [],
    source: 'available',
    materialSwing: 0,
    kingSafetyDelta: 1,
    inPV: false,
    saliency: 0,
    templateId: 'mating_net',
    evidence: [`forced mate in ${mateInMoves}: ${line.join(' ')}`],
  };
}

/** Drop duplicate motifs that share a type + first move (e.g. Tier-1 mate-in-1 vs the proof). */
function dedupe(motifs: Motif[]): Motif[] {
  const seen = new Set<string>();
  const out: Motif[] = [];
  for (const m of motifs) {
    const key = `${m.type}|${m.line[0] ?? ''}|${m.squares.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
