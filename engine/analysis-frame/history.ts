/**
 * UCI history replay + validation for history-aware CVS search (plan §6 PR-04).
 *
 * Hard rule (§6 PR-04): never trust a current FEN plus a separately maintained
 * move array. Only send `initialFen` + `moves` to the engine when replaying the
 * moves from `initialFen` actually reaches the requested position — otherwise fail
 * closed and fall back to bare-FEN analysis. Comparison is on the legal-position
 * key (placement + side-to-move + castling + en-passant), which is exactly the
 * position-recurrence notion the engine needs for repetition.
 */
import { Chess } from 'chess.js';
import { legalPositionKey } from './match';

export const STARTPOS_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Resolve the wire `initialFen` ('startpos'/undefined → the standard start). */
export function resolveInitialFen(initialFen?: string): string {
  return !initialFen || initialFen === 'startpos' ? STARTPOS_FEN : initialFen;
}

function parseUci(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5).toLowerCase() : undefined,
  };
}

/**
 * Replay UCI moves from `initialFen`; return the resulting FEN, or null if any
 * move is illegal (chess.js throws on illegal moves).
 */
export function replayUciHistory(
  initialFen: string | undefined,
  movesUci: readonly string[],
): string | null {
  const chess = new Chess(resolveInitialFen(initialFen));
  for (const uci of movesUci) {
    if (uci.length < 4) return null;
    const mv = parseUci(uci);
    try {
      chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      return null;
    }
  }
  return chess.fen();
}

/**
 * True iff replaying `movesUci` from `initialFen` reaches the same legal position
 * as `expectedFen`. The identity/replay guard for PR-04.
 */
export function replayReachesFen(
  initialFen: string | undefined,
  movesUci: readonly string[],
  expectedFen: string,
): boolean {
  const reached = replayUciHistory(initialFen, movesUci);
  return reached !== null && legalPositionKey(reached) === legalPositionKey(expectedFen);
}
