/**
 * NormalizedEngineScore — explicit score perspective (plan §3.2, §4.3). Every
 * engine score must state its raw value, its raw perspective, the root side, and
 * a White-normalized value, for both centipawns and mate. Terminal positions with
 * no numeric evaluation stay terminal (null) — they are never converted to zero.
 */
export type ScorePov = 'side_to_move' | 'white' | 'black';
export type RootSide = 'white' | 'black';

export interface NormalizedEngineScore {
  rawCp: number | null;
  rawMate: number | null;
  rawPov: ScorePov;
  rootSide: RootSide;
  whiteCp: number | null;
  whiteMate: number | null;
}

/** Side to move from a FEN's second field (pure; no chess.js). */
export function rootSideFromFen(fen: string): RootSide {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'white';
}

/**
 * Convert a raw engine score to White-normalized values (plan §4.3):
 * - rawPov 'white'         → values unchanged
 * - rawPov 'black'         → values negated
 * - rawPov 'side_to_move'  → negated when the root side is Black
 * Mate sign follows the same conversion. `null` stays `null` (terminal/unknown).
 */
export function normalizeEngineScore(input: {
  rawCp: number | null;
  rawMate: number | null;
  rawPov: ScorePov;
  rootSide: RootSide;
}): NormalizedEngineScore {
  const { rawCp, rawMate, rawPov, rootSide } = input;
  let factor = 1;
  if (rawPov === 'black') factor = -1;
  else if (rawPov === 'side_to_move' && rootSide === 'black') factor = -1;
  return {
    rawCp,
    rawMate,
    rawPov,
    rootSide,
    whiteCp: rawCp === null ? null : rawCp * factor,
    whiteMate: rawMate === null ? null : rawMate * factor,
  };
}

/**
 * Build a NormalizedEngineScore from an engine result reported in the
 * conventional side-to-move perspective (UCI). `cp`/`mate` may be null/undefined
 * for terminal or unavailable positions. The root side is derived from `fen`.
 */
export function normalizedScoreFromSideToMove(input: {
  fen: string;
  cp?: number | null;
  mate?: number | null;
}): NormalizedEngineScore {
  return normalizeEngineScore({
    rawCp: input.cp ?? null,
    rawMate: input.mate ?? null,
    rawPov: 'side_to_move',
    rootSide: rootSideFromFen(input.fen),
  });
}
