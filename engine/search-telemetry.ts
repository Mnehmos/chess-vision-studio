/**
 * Pure derived display metrics for CVS search telemetry (plan §6 PR-11). Every
 * ratio is divide-by-zero guarded so zero counters never produce NaN/Infinity.
 * These derive from RAW counters rather than trusting the engine's pre-computed
 * percentages, so the panel is correct even if a counter is zero or a pct is
 * absent. No metric here is a strength claim.
 */
import type { CvsSearchTelemetryV2 } from './analysis-frame/telemetry';

/** num/den as a fraction in [0,∞), or 0 when den is 0 (never NaN/Infinity). */
export function safeRatio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

/** num/den * 100, divide-by-zero guarded. */
export function safePct(num: number, den: number): number {
  return den > 0 ? (num / den) * 100 : 0;
}

export interface DerivedTelemetryMetrics {
  qNodeShare: number; // quiescence nodes as a fraction of all nodes
  ttHitRate: number; // tt hits / probes
  ttCutoffRate: number; // tt cutoffs / probes
  firstMoveCutoffRate: number; // first-move cutoffs / cutoffs
  hashMoveCutoffRate: number; // hash-move cutoffs / cutoffs
  avgCutoffMoveIndex: number; // sum / count
  avgLegalMoves: number; // legal-move sum / nodes
  prunedShare: number; // pruned / (searched + pruned)
  nullCutoffRate: number; // null cutoffs / attempts
  lmrResearchRate: number; // lmr researches / reductions
  foreignCutoffTotal: number; // sum of per-worker foreign-lane cutoffs
}

/** Derive guarded display metrics from raw counters. */
export function deriveTelemetryMetrics(t: CvsSearchTelemetryV2): DerivedTelemetryMetrics {
  return {
    qNodeShare: safeRatio(t.qNodes, t.nodes),
    ttHitRate: safeRatio(t.ttHits, t.ttProbes),
    ttCutoffRate: safeRatio(t.ttCutoffs, t.ttProbes),
    firstMoveCutoffRate: safeRatio(t.firstMoveCutoffs, t.cutoffs),
    hashMoveCutoffRate: safeRatio(t.hashMoveCutoffs, t.cutoffs),
    avgCutoffMoveIndex: safeRatio(t.cutoffMoveIndexSum, t.cutoffMoveIndexCount),
    avgLegalMoves: safeRatio(t.legalMoveSum, t.legalMoveNodes),
    prunedShare: safeRatio(t.prunedMoves, t.searchedMoves + t.prunedMoves),
    nullCutoffRate: safeRatio(t.nullCutoffs, t.nullAttempts),
    lmrResearchRate: safeRatio(t.lmrResearches, t.lmrReductions),
    foreignCutoffTotal: t.foreignCutoffs.reduce((a, b) => a + b, 0),
  };
}

/** Per-ply rows that actually have activity (the engine omits empty plies). */
export function populatedBranchingPlies(t: CvsSearchTelemetryV2): CvsSearchTelemetryV2['branchingByPly'] {
  return t.branchingByPly.filter((row) => row.nodes > 0 || row.childSearches > 0);
}
