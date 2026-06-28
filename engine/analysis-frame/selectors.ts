/**
 * Pure selectors over AnalysisFrameV2 (plan §6 PR-15). Downstream consumers read
 * analysis-derived state through THESE — never by digging through raw engine/fact
 * responses — so one canonical frame reconstructs every analysis-derived visual for
 * a ply. Every selector fails closed: a non-computed artifact yields null/empty, so
 * a stale or pending slot can never render.
 *
 * This module is engine-pure (no app imports); it composes the contracts from
 * PR-01..14 (identity/facts match, canonical teaching, hazard view, fact adapters).
 */
import type { ArtifactState } from './artifact';
import type { AnalysisFrameV2, EngineSearchResultV2, MoveReviewV2 } from './frame';
import { matchPositionFacts } from './match';
import type { AnalysisIdentityV2 } from './identity';
import type { PositionFacts, SquareFact } from '../teaching/types';
import type { TeachingNode } from '../teaching/node';
import { selectPrimaryTeachingNode } from '../teaching/canonical';
import {
  hangingPieceView,
  occupiedPieceDefenseView,
  occupiedPieceThreatView,
  pawnStructureView,
  squareFactFor,
  type LensView,
} from '../facts-adapters';
import { hazardDeltaView, type HazardDeltaView } from '../hazard-view';

function value<T>(state: ArtifactState<T>): T | null {
  return state.status === 'computed' ? state.value : null;
}

/** The PositionFacts for the displayed (identity) position, or null. */
export function selectCurrentPositionFacts(frame: AnalysisFrameV2): PositionFacts | null {
  const facts = value(frame.facts);
  if (!facts) return null;
  const fen = frame.identity.fenAfter ?? frame.identity.fenBefore;
  return matchPositionFacts(facts.rawV1, fen)?.position ?? facts.before;
}

/** Stockfish's review of the played move (move grading), or null. */
export function selectPlayedMoveReview(frame: AnalysisFrameV2): MoveReviewV2 | null {
  return value(frame.stockfishReview);
}

export interface EngineDisagreementSelection {
  stockfish: EngineSearchResultV2 | null;
  cvs: EngineSearchResultV2 | null;
  /** true/false when both engines are computed; null when one is missing. */
  bestMovesAgree: boolean | null;
}

/** Root engine disagreement (Stockfish vs CVS), fail-closed per engine. */
export function selectEngineDisagreement(frame: AnalysisFrameV2): EngineDisagreementSelection {
  const stockfish = value(frame.stockfishRoot);
  const cvs = value(frame.cvsRoot);
  const bestMovesAgree =
    stockfish && cvs ? stockfish.bestMoveUci !== null && stockfish.bestMoveUci === cvs.bestMoveUci : null;
  return { stockfish, cvs, bestMovesAgree };
}

/** The single committed primary teaching claim (deterministic), or null. */
export function selectPrimaryTeaching(frame: AnalysisFrameV2): TeachingNode | null {
  const teaching = value(frame.teaching);
  return teaching ? selectPrimaryTeachingNode(teaching.nodes) : null;
}

/** Created/removed/worsened hazard + structure deltas for the played move, or null. */
export function selectHazardDelta(frame: AnalysisFrameV2): HazardDeltaView | null {
  const facts = value(frame.facts);
  return facts ? hazardDeltaView(facts.rawV1.played) : null;
}

/** Rust square-control fact for a square on the displayed position, or undefined. */
export function selectSquareFact(frame: AnalysisFrameV2, square: string): SquareFact | undefined {
  const facts = selectCurrentPositionFacts(frame);
  return facts ? squareFactFor(facts, square) : undefined;
}

export type LensMode = 'threat' | 'defense' | 'hanging' | 'pawnStructure';

/** A provenance-tagged lens view for the displayed position, or null. */
export function selectLensView(frame: AnalysisFrameV2, mode: LensMode): LensView<unknown> | null {
  const facts = selectCurrentPositionFacts(frame);
  if (!facts) return null;
  switch (mode) {
    case 'threat':
      return occupiedPieceThreatView(facts);
    case 'defense':
      return occupiedPieceDefenseView(facts);
    case 'hanging':
      return hangingPieceView(facts);
    case 'pawnStructure':
      return pawnStructureView(facts);
    default:
      return null;
  }
}

export interface NarrationPlanSelection {
  identity: AnalysisIdentityV2;
  facts: PositionFacts | null;
  primaryTeaching: TeachingNode | null;
  disagreement: EngineDisagreementSelection;
  hazardDelta: HazardDeltaView | null;
}

/** The complete frame-derived narration input — the single source for the LLM layer. */
export function selectNarrationPlan(frame: AnalysisFrameV2): NarrationPlanSelection {
  return {
    identity: frame.identity,
    facts: selectCurrentPositionFacts(frame),
    primaryTeaching: selectPrimaryTeaching(frame),
    disagreement: selectEngineDisagreement(frame),
    hazardDelta: selectHazardDelta(frame),
  };
}
