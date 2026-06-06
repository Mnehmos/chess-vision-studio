// [5b] Move-creating (s)pin/skewer TACTICS — the MOVE that BRINGS a winning
// skewer / relative-pin / absolute-pin alignment into existence, as opposed to
// `findPinsAndSkewers` which only reports STATIC alignments already on the board.
//
// The discipline is identical to the rest of the motif layer (Invariant 7):
// PROPOSE by geometry, then VALIDATE by the forcing-search OUTCOME. A motif is
// constructed ONLY when the search proves the moving side nets material.
//
// Why this is hard / why it is NOT just "find a pin then grab it":
//   The dataset's "absolute pin winsMinor" cases (e.g. Bxd7+ Kxd7) are TRAPS.
//   A bishop already pins the knight to the king; capturing it just trades B for
//   N — and once the pinned piece is gone the pin is gone, so the king recaptures
//   for an EVEN exchange. Geometry alone ("there is a pin, take the pinned man")
//   would wrongly call that a winning tactic. The search refutes it: after
//   Bxd7+, the opponent to move recovers the bishop (Kxd7), so the moving side's
//   net is ~0, not +3. Only a real material WIN (an exchange, ~2 pawns or more)
//   is emitted.
//
// Algorithm (per candidate move = every check + every capture):
//   1. Play it → afterFen (opponent to move).
//   2. Run findPinsAndSkewers on afterFen for the moving side. Keep only winning
//      skewer / relative-pin / absolute-pin alignments that did NOT exist in the
//      position BEFORE the move (the move CREATED them).
//   3. VALIDATE with tacticalOutcome(afterFen): the opponent is to move there, so
//      its `gain` is from the OPPONENT's POV. The moving side's net over the whole
//      sequence is  (material my move just captured)  −  (opponent's best gain).
//      Require net >= EXCHANGE (~2 pawns). This negates the opponent-to-move gain
//      exactly as the spec requires and rejects every even-trade trap.
//   4. Construct the Motif (validatedBy 'engine_pv', line = [creating SAN, …PV]).
import { Chess } from 'chess.js';
import { parseFen, pieceAt, type BoardPiece } from './board';
import { PIECE_VALUE } from './see';
import { tacticalOutcome } from './tacticsearch';
import { findPinsAndSkewers } from './motif';
import type { Motif, MotifType, PieceId } from './types';

const other = (c: 'w' | 'b') => (c === 'w' ? 'b' : 'w');
const sideName = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black');

/** Minimum net material (in pawns) to call it a winning tactic — an exchange. */
const EXCHANGE = 2;

let moveTacticCounter = 0;
function nextId(): string {
  moveTacticCounter += 1;
  return `tacticmove-${moveTacticCounter}`;
}

/** Mirror of motif.ts `pieceIdOf` (kept local — we only create new files). */
function pieceIdOf(p: BoardPiece): PieceId {
  return p.color + p.type.toUpperCase() + p.square;
}

/**
 * Replica of motif.ts `baseMotif` (Invariant 7 shape). Re-implemented locally so
 * this module owns its construction and modifies no existing file.
 */
function baseMotif(partial: Partial<Motif> & Pick<Motif, 'type' | 'byPiece'>): Motif {
  return {
    id: nextId(),
    kind: 'motif',
    type: partial.type,
    tier: partial.tier ?? 1,
    byPiece: partial.byPiece,
    line: partial.line ?? [],
    consequence: partial.consequence ?? { materialSwing: 0 },
    proposedBy: partial.proposedBy ?? 'geometry',
    validatedBy: partial.validatedBy ?? 'engine_pv',
    side: partial.side ?? 'white',
    squares: partial.squares ?? [],
    arrows: partial.arrows ?? [],
    source: partial.source ?? 'available',
    materialSwing: partial.materialSwing ?? 0,
    kingSafetyDelta: partial.kingSafetyDelta ?? 0,
    inPV: partial.inPV ?? true,
    saliency: 0,
    templateId: partial.templateId ?? partial.type,
    evidence: partial.evidence ?? [],
  };
}

type SpinType = Extract<MotifType, 'skewer' | 'pin_absolute' | 'pin_relative'>;

/** A stable key for an alignment so we can diff before/after sets. */
function alignmentKey(m: Motif): string {
  return `${m.type}|${m.squares.join(',')}`;
}

/** The material the moving side's own move physically captured (in pawns). */
function capturedValueOf(beforeFen: string, to: string): number {
  const victim = pieceAt(parseFen(beforeFen), to);
  return victim ? PIECE_VALUE[victim.type] : 0;
}

interface VerboseMove {
  san: string;
  from: string;
  to: string;
  flags: string;
}

/**
 * Detect skewer / pin TACTICS — the move that CREATES a winning skewer or pin —
 * for the side to move in `fen`. Emits a Motif only when the forcing search
 * confirms a real material win (>= an exchange). Returns [] when nothing wins.
 */
export function findPinSkewerTactics(fen: string): Motif[] {
  const board = parseFen(fen);
  const mover = board.turn;
  const victim = other(mover); // the side our (s)pins are aimed at

  // Alignments that already exist BEFORE we move — those are STATIC, not created.
  const before = new Set(
    findPinsAndSkewers(fen, victim).motifs.map(alignmentKey),
  );

  const chess = new Chess(fen);
  const all = chess.moves({ verbose: true }) as VerboseMove[];

  // Candidate forcing moves: every check + every capture (de-duplicated).
  const candidates = all.filter(
    (m) =>
      m.san.includes('+') ||
      m.san.includes('#') ||
      m.flags.includes('c') ||
      m.flags.includes('e'),
  );

  const out: Motif[] = [];
  const seenMoves = new Set<string>();

  for (const cand of candidates) {
    if (seenMoves.has(cand.san)) continue;
    seenMoves.add(cand.san);

    const test = new Chess(fen);
    const played = test.move({ from: cand.from, to: cand.to, promotion: 'q' });
    if (!played) continue;
    const afterFen = test.fen();

    // PROPOSE: a winning (s)pin alignment that is NEW after this move.
    const afterAligns = findPinsAndSkewers(afterFen, victim).motifs.filter(
      (m): m is Motif & { type: SpinType } =>
        m.type === 'skewer' || m.type === 'pin_absolute' || m.type === 'pin_relative',
    );
    const created = afterAligns.filter((m) => !before.has(alignmentKey(m)));
    if (created.length === 0) continue;

    // VALIDATE: negate the opponent-to-move gain → net for the moving side.
    const oppOut = tacticalOutcome(afterFen, 6);
    const myCapture = capturedValueOf(fen, cand.to);
    const net = myCapture - oppOut.gain;
    if (net < EXCHANGE) continue; // even trade / wins only a pawn / blocked → reject

    // CAUSALITY: the win must come FROM the created alignment, not merely from
    // the move's own capture. A queen that grabs a hanging bishop and happens to
    // line up an incidental pawn-vs-king "pin" wins +3 — but that +3 is the free
    // bishop, the pin does nothing. Require the alignment to add material BEYOND
    // the immediate capture (genuine skewers carry the whole win: myCapture = 0).
    const alignmentGain = net - myCapture;
    if (alignmentGain < EXCHANGE) continue; // pin/skewer is incidental → reject

    // Prefer the most valuable created alignment (skewer of a queen over a rook).
    const best = pickBest(created, afterFen, victim);

    const winRounded = Math.round(net * 100) / 100;
    const targetSq = best.squares[best.squares.length - 1];
    const line = [played.san, ...oppOut.line];

    out.push(
      baseMotif({
        type: best.type,
        byPiece: byPieceAfter(afterFen, cand.to) ?? best.byPiece,
        side: sideName(mover),
        squares: best.squares,
        arrows: best.arrows.length ? best.arrows : [[cand.to, targetSq]],
        line,
        consequence: { materialSwing: winRounded },
        materialSwing: winRounded,
        validatedBy: 'engine_pv',
        proposedBy: 'geometry',
        inPV: true,
        kingSafetyDelta: best.type === 'pin_absolute' || best.type === 'skewer' ? 0.3 : 0,
        evidence: [
          `${played.san} creates a ${best.type} (${best.squares.join(' → ')}); ` +
            `search nets +${winRounded} for ${sideName(mover)} (PV: ${line.join(' ')})`,
        ],
      }),
    );
  }

  return out;
}

/** Choose the created alignment whose back piece is worth the most. */
function pickBest(
  created: Motif[],
  afterFen: string,
  victimColor: 'w' | 'b',
): Motif {
  const board = parseFen(afterFen);
  let best = created[0];
  let bestVal = backValue(board, best, victimColor);
  for (const m of created) {
    const v = backValue(board, m, victimColor);
    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return best;
}

function backValue(board: ReturnType<typeof parseFen>, m: Motif, victimColor: 'w' | 'b'): number {
  const backSq = m.squares[m.squares.length - 1];
  const p = pieceAt(board, backSq);
  if (!p || p.color !== victimColor) return 0;
  return PIECE_VALUE[p.type];
}

/** The piece that just moved (it owns the (s)pin), keyed at its destination. */
function byPieceAfter(afterFen: string, to: string): PieceId | null {
  const p = pieceAt(parseFen(afterFen), to);
  return p ? pieceIdOf(p) : null;
}
