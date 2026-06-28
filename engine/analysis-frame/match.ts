/**
 * Facts-to-board matching for AnalysisFrameV2 (plan §6 PR-01, work item 3-4).
 *
 * Replaces the legacy piece-placement-only match (`fen.split(' ')[0]`) used in
 * Analyze mode. A `TeachingFactBundleV1` carries four positions — the pre-move
 * `before`, the `played` branch, and optional `best`/`refutation` branches — each
 * with a full FEN. We match the displayed board to one of them by its
 * **legal-position key**: placement + side-to-move + castling + en-passant.
 *
 * Why those four FEN fields and not the whole FEN string: the static facts in a
 * bundle (attackers, defenders, SEE, pawn structure, hazards) depend only on the
 * legal position, not on the halfmove/fullmove clocks. Including the clocks risks
 * a false miss if the app and engine derive counters differently across the wire,
 * which would regress the existing happy path. Clock- and repetition-sensitive
 * identity lives in AnalysisIdentityV2 (full FEN + historyHash), which guards the
 * frame as a whole; this helper only selects which branch's PositionFacts to show.
 */
import type { PositionFacts, TeachingFactBundleV1 } from '../teaching/types';

export type FactsBranchRole = 'before' | 'played' | 'best' | 'refutation';

export interface MatchedFacts {
  role: FactsBranchRole;
  position: PositionFacts;
}

/** placement + side-to-move + castling + en-passant (the first four FEN fields). */
export function legalPositionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

/**
 * Find the branch in `facts` whose position matches `fen`, or null when none
 * does (fail closed — a stale or legally-different bundle yields no facts rather
 * than the wrong facts). The played branch is preferred, then the pre-move
 * position, then the counterfactual branches.
 */
export function matchPositionFacts(
  facts: TeachingFactBundleV1,
  fen: string,
): MatchedFacts | null {
  const key = legalPositionKey(fen);
  if (legalPositionKey(facts.played.fenAfter) === key) {
    return { role: 'played', position: facts.played.position };
  }
  if (legalPositionKey(facts.fenBefore) === key) {
    return { role: 'before', position: facts.before };
  }
  if (facts.best && legalPositionKey(facts.best.fenAfter) === key) {
    return { role: 'best', position: facts.best.position };
  }
  if (facts.refutation && legalPositionKey(facts.refutation.fenAfter) === key) {
    return { role: 'refutation', position: facts.refutation.position };
  }
  return null;
}
