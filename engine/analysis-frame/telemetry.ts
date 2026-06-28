/**
 * CvsSearchTelemetryV2 — the COMPLETE CVS search telemetry contract (plan §6
 * PR-11), typing every field the engine emits in the PR-00 golden fixture
 * fixtures/cvs-engine/search-v1.json. Raw counters are preserved; derived display
 * metrics live in engine/search-telemetry.ts as pure, divide-by-zero-guarded
 * helpers. No telemetry value is a strength claim without a benchmark.
 */

export interface BranchingByPlyEntry {
  ply: number;
  nodes: number;
  childSearches: number;
  effectiveBranching: number;
}

export interface CvsSearchTelemetryV2 {
  // Search summary
  nodes: number;
  mainNodes: number;
  qNodes: number;
  qNodePct: number;
  qCaptures: number;
  qSeeSkips: number;
  quietExt: number;
  maxQDepth: number;
  timeMs: number;

  // Transposition table
  ttProbes: number;
  ttEntries: number;
  ttHits: number;
  ttMissCold: number;
  ttMissContended: number;
  ttHitPct: number;
  ttEntryPct: number;
  ttCutoffs: number;
  ttCutoffPct: number;

  // Move ordering
  cutoffs: number;
  hashMoveCutoffs: number;
  hashMoveCutoffPct: number;
  firstMoveCutoffs: number;
  firstMoveCutoffPct: number;
  killerCutoffs: number;
  historyCutoffs: number;
  cutoffMoveIndexSum: number;
  cutoffMoveIndexCount: number;
  avgCutoffMoveIndex: number;
  legalMoveNodes: number;
  legalMoveSum: number;
  avgLegalMoves: number;
  searchedMoves: number;
  prunedMoves: number;
  searchedEffectiveBranching: number;

  // Pruning / reductions
  nullAttempts: number;
  nullCutoffs: number;
  nullCutoffPct: number;
  rfpAttempts: number;
  rfpCutoffs: number;
  rfpCutoffPct: number;
  futilityAttempts: number;
  futilitySkips: number;
  futilitySkipPct: number;
  lmpAttempts: number;
  lmpSkips: number;
  lmpSkipPct: number;
  seePruneAttempts: number;
  seePruneSkips: number;
  seePruneSkipPct: number;
  deltaAttempts: number;
  deltaSkips: number;
  deltaSkipPct: number;
  lmrReductions: number;
  lmrResearches: number;
  lmrResearchPct: number;
  pvsResearches: number;
  aspirationResearches: number;
  dangerExtensionPlies: number;

  // Specialist lanes (SMP foreign-lane hints/cutoffs, per worker)
  foreignHints: number[];
  foreignCutoffs: number[];

  // Per-ply branching (only non-empty plies; ascending)
  branchingByPly: BranchingByPlyEntry[];
}

/** Every field name in the V2 telemetry contract — the drift tripwire. */
export const CVS_TELEMETRY_NUMBER_FIELDS: (keyof CvsSearchTelemetryV2)[] = [
  'nodes', 'mainNodes', 'qNodes', 'qNodePct', 'qCaptures', 'qSeeSkips', 'quietExt',
  'maxQDepth', 'timeMs', 'ttProbes', 'ttEntries', 'ttHits', 'ttMissCold',
  'ttMissContended', 'ttHitPct', 'ttEntryPct', 'ttCutoffs', 'ttCutoffPct', 'cutoffs',
  'hashMoveCutoffs', 'hashMoveCutoffPct', 'firstMoveCutoffs', 'firstMoveCutoffPct',
  'killerCutoffs', 'historyCutoffs', 'cutoffMoveIndexSum', 'cutoffMoveIndexCount',
  'avgCutoffMoveIndex', 'legalMoveNodes', 'legalMoveSum', 'avgLegalMoves',
  'searchedMoves', 'prunedMoves', 'searchedEffectiveBranching', 'nullAttempts',
  'nullCutoffs', 'nullCutoffPct', 'rfpAttempts', 'rfpCutoffs', 'rfpCutoffPct',
  'futilityAttempts', 'futilitySkips', 'futilitySkipPct', 'lmpAttempts', 'lmpSkips',
  'lmpSkipPct', 'seePruneAttempts', 'seePruneSkips', 'seePruneSkipPct',
  'deltaAttempts', 'deltaSkips', 'deltaSkipPct', 'lmrReductions', 'lmrResearches',
  'lmrResearchPct', 'pvsResearches', 'aspirationResearches', 'dangerExtensionPlies',
];

export function isCvsSearchTelemetryV2(value: unknown): value is CvsSearchTelemetryV2 {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  if (!Array.isArray(t.branchingByPly)) return false;
  if (!Array.isArray(t.foreignHints) || !Array.isArray(t.foreignCutoffs)) return false;
  return CVS_TELEMETRY_NUMBER_FIELDS.every((k) => typeof t[k] === 'number');
}
