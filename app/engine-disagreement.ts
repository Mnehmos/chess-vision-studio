/**
 * Engine-disagreement view-model (plan §6 PR-03). Pure logic that turns two
 * root-position engine results (Stockfish + CVS, computed at the SAME budget) into
 * a card model: agreement, White-normalized eval difference, and per-engine
 * pending/unavailable states. It fails closed when a result's identity does not
 * match the requested root (a late response after undo/game-switch cannot render).
 *
 * This answers a DIFFERENT question from move review (which grades the played
 * move). Keeping them separate is the whole point of the PR.
 */
import {
  type AnalysisIdentityV2,
  type NormalizedEngineScore,
  type SearchBudget,
  sameAnalysisIdentity,
} from '../engine/analysis-frame';

export type EngineId = 'stockfish' | 'cvs';

export interface EngineRootResult {
  engine: EngineId;
  identity: AnalysisIdentityV2;
  bestMoveUci: string | null;
  score: NormalizedEngineScore;
  pvUci: string[];
  depth?: number;
  timeMs?: number;
  nodes?: number;
}

/** One engine's slot in the disagreement card. */
export type EngineSlot =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'unavailable'; reason: string }
  | { status: 'computed'; result: EngineRootResult };

export interface EngineComparison {
  bestMovesAgree: boolean;
  /** Both engines returned a White cp number (not mate-vs-cp, not terminal). */
  comparable: boolean;
  /** stockfish.whiteCp − cvs.whiteCp, or null when not comparable. */
  whiteCpDiff: number | null;
}

export interface EngineDisagreementView {
  rootFen: string;
  budget: SearchBudget;
  stockfish: EngineSlot;
  cvs: EngineSlot;
  /** Non-null only when BOTH engines are computed for the matching root. */
  comparison: EngineComparison | null;
  overall: 'ready' | 'pending' | 'unavailable' | 'idle';
}

/** A computed result whose identity ≠ the requested root fails closed. */
function gate(slot: EngineSlot, root: AnalysisIdentityV2): EngineSlot {
  if (slot.status === 'computed' && !sameAnalysisIdentity(root, slot.result.identity)) {
    return { status: 'unavailable', reason: 'identity mismatch' };
  }
  return slot;
}

export function buildEngineDisagreement(input: {
  rootIdentity: AnalysisIdentityV2;
  budget: SearchBudget;
  stockfish: EngineSlot;
  cvs: EngineSlot;
}): EngineDisagreementView {
  const stockfish = gate(input.stockfish, input.rootIdentity);
  const cvs = gate(input.cvs, input.rootIdentity);

  let comparison: EngineComparison | null = null;
  if (stockfish.status === 'computed' && cvs.status === 'computed') {
    const sf = stockfish.result;
    const cv = cvs.result;
    const comparable = sf.score.whiteCp !== null && cv.score.whiteCp !== null;
    comparison = {
      bestMovesAgree: sf.bestMoveUci !== null && sf.bestMoveUci === cv.bestMoveUci,
      comparable,
      whiteCpDiff: comparable ? (sf.score.whiteCp as number) - (cv.score.whiteCp as number) : null,
    };
  }

  const overall: EngineDisagreementView['overall'] =
    stockfish.status === 'computed' && cvs.status === 'computed'
      ? 'ready'
      : stockfish.status === 'pending' || cvs.status === 'pending'
        ? 'pending'
        : stockfish.status === 'unavailable' || cvs.status === 'unavailable'
          ? 'unavailable'
          : 'idle';

  return {
    rootFen: input.rootIdentity.fenBefore,
    budget: input.budget,
    stockfish,
    cvs,
    comparison,
    overall,
  };
}

/** Short human label for a budget, for the card's "equal budget" provenance line. */
export function budgetLabel(budget: SearchBudget): string {
  if (budget.kind === 'movetime') return `${budget.milliseconds}ms`;
  if (budget.kind === 'depth') return `depth ${budget.depth}`;
  return `${budget.nodes} nodes`;
}
