// Game-level Draw/Conversion insight (the IUBKTvjF lesson).
//
// CVS drew its first clean Lichess game two pieces up by checking forever:
// the per-move explainer praised "mobility improved" while the GAME repeated
// into 1/2-1/2. This detector adds the game-level fact the local diff cannot
// see: the position has occurred before, one side is clearly winning, and the
// engine PV starts with a progress move — so repeating again throws the win.
//
// Trigger (per the product spec):
//   - the position after the played move already occurred earlier in the game
//   - eval ≥ +2.00 for the side to move (they are winning, not escaping)
//   - the PV's top move is NOT the move that continues the repetition
import type { ChangedRelation, MoveAnalysis } from './types';

const REPETITION_EVAL_GATE_CP = 200;

/** FEN identity for repetition: piece placement, side, castling, ep. */
function repKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export interface PlyFens {
  fenBefore: string;
  fenAfter: string;
  san: string;
}

/**
 * Returns a game-level repetition/conversion insight for plies[idx], or null.
 * Pure and cheap (string keys only) — safe to run on every analyzed ply.
 * `analysis` must carry evalAfter (side-to-move POV at fenAfter) and its PV.
 */
export function repetitionConversionWarning(
  plies: PlyFens[],
  idx: number,
  analysis: Pick<MoveAnalysis, 'evalAfter'>,
): ChangedRelation | null {
  const ply = plies[idx];
  if (!ply) return null;

  // Occurrences of the post-move position earlier in the game (start position
  // counts via ply 0's fenBefore).
  const key = repKey(ply.fenAfter);
  let seen = 0;
  if (plies[0] && repKey(plies[0].fenBefore) === key) seen += 1;
  for (let i = 0; i < idx; i++) {
    if (repKey(plies[i].fenAfter) === key) seen += 1;
  }
  if (seen < 1) return null; // first occurrence — nothing to warn about

  const cp = analysis.evalAfter?.cp;
  if (typeof cp !== 'number' || cp < REPETITION_EVAL_GATE_CP) return null; // side to move not clearly winning

  // The repetition-continuing move is the one the side to move played two
  // plies ago (that is what brought this position back). If the engine PV
  // already starts with something else, that IS the progress move to name.
  const repeatingSan = plies[idx - 1]?.san;
  const pvTop = analysis.evalAfter?.pv?.[0];
  if (!pvTop || (repeatingSan && pvTop === repeatingSan)) return null;

  const mover = ply.fenAfter.split(' ')[1] === 'w' ? 'white' : 'black';
  const who = mover === 'white' ? 'White' : 'Black';
  const pawns = (cp / 100).toFixed(1);
  const sentence =
    `This position has now repeated — one more repetition is a draw, but ${who} is still winning ` +
    `(about +${pawns}). Instead of repeating, look for a progress move like ${pvTop}. ` /* eslint-disable-line */ +
    `A draw is not a success when you are winning.`;

  return {
    id: `repetition-conversion-${idx}`,
    kind: 'changed_relation',
    type: 'repetition_conversion_warning',
    side: mover,
    squares: [],
    arrows: [],
    source: 'played_move',
    materialSwing: 0,
    kingSafetyDelta: 0,
    inPV: false,
    saliency: 1, // game-deciding by definition: the next repetition ends the game
    templateId: 'repetition_conversion_warning',
    evidence: [sentence, `position repeated (${seen + 1}x)`, `eval +${pawns} for ${who}`, `PV progress move: ${pvTop}`],
  };
}
