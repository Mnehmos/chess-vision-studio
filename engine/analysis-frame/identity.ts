/**
 * AnalysisIdentityV2 — the exact state an analysis artifact was computed for
 * (plan §3.1, §4.2). Piece-placement-only FEN comparison is NOT sufficient:
 * positions that share placement but differ in side-to-move, castling rights,
 * en-passant, clocks, repetition history, the reviewed move, the counterfactual
 * branch, or the source engine are DIFFERENT identities and must fail closed.
 *
 * `historyHash` is a deterministic pure hash (no browser crypto) so tests and
 * server-side tools agree. It is an identity guard, not a security feature.
 */

export const ANALYSIS_FRAME_SCHEMA_VERSION = 2 as const;
export const ANALYSIS_FRAME_BUILDER_VERSION = 1 as const;

export type EngineSource = 'stockfish' | 'cvs';
export type BranchSource = 'user' | 'game' | 'stockfish' | 'cvs';

export type AnalysisBranch =
  | { role: 'root'; source: 'game' }
  | { role: 'played'; source: 'user' | 'game' }
  | { role: 'best'; source: EngineSource }
  | { role: 'refutation'; source: EngineSource }
  | { role: 'candidate'; source: 'user' | EngineSource; id: string };

export interface AnalysisIdentityV2 {
  schemaVersion: typeof ANALYSIS_FRAME_SCHEMA_VERSION;
  gameKey: string;
  ply: number;

  initialFen: string;
  historyUci: string[];
  historyHash: string;

  fenBefore: string;
  playedMoveUci?: string;
  fenAfter?: string;

  branch: AnalysisBranch;
}

/**
 * Deterministic FNV-1a (32-bit) hash of the UCI history, rendered as 8 hex
 * digits. Pure and stable across environments. The leading length guards against
 * a prefix colliding with a longer line that hashes to the same accumulator.
 */
export function buildHistoryHash(historyUci: readonly string[]): string {
  const input = `${historyUci.length}:${historyUci.join('/')}`;
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= FNV prime (16777619), kept in 32-bit space.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sameBranch(a: AnalysisBranch, b: AnalysisBranch): boolean {
  if (a.role !== b.role || a.source !== b.source) return false;
  if (a.role === 'candidate' && b.role === 'candidate') return a.id === b.id;
  return true;
}

/**
 * Exact identity equality. Two artifacts may render under the same frame ONLY
 * when this returns true. Compares every distinguishing field; `fenBefore`/
 * `fenAfter` are full FENs (so placement, side-to-move, castling, en-passant and
 * clocks all participate), and `historyHash` distinguishes same-FEN positions
 * reached by different repetition histories.
 */
export function sameAnalysisIdentity(a: AnalysisIdentityV2, b: AnalysisIdentityV2): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.gameKey === b.gameKey &&
    a.ply === b.ply &&
    a.initialFen === b.initialFen &&
    a.historyHash === b.historyHash &&
    a.fenBefore === b.fenBefore &&
    (a.playedMoveUci ?? null) === (b.playedMoveUci ?? null) &&
    (a.fenAfter ?? null) === (b.fenAfter ?? null) &&
    sameBranch(a.branch, b.branch)
  );
}

/**
 * A human-readable explanation of WHY two identities differ, or null when they
 * match. For the debug-mode stale-artifact diagnostic (plan §6 PR-01 work item 8).
 */
export function describeIdentityMismatch(
  frame: AnalysisIdentityV2,
  artifact: AnalysisIdentityV2,
): string | null {
  if (sameAnalysisIdentity(frame, artifact)) return null;
  const diffs: string[] = [];
  if (frame.gameKey !== artifact.gameKey) diffs.push('gameKey');
  if (frame.ply !== artifact.ply) diffs.push(`ply(${artifact.ply}→${frame.ply})`);
  if (frame.initialFen !== artifact.initialFen) diffs.push('initialFen');
  if (frame.historyHash !== artifact.historyHash) diffs.push('history');
  if (frame.fenBefore !== artifact.fenBefore) diffs.push('fenBefore');
  if ((frame.playedMoveUci ?? null) !== (artifact.playedMoveUci ?? null)) diffs.push('playedMove');
  if ((frame.fenAfter ?? null) !== (artifact.fenAfter ?? null)) diffs.push('fenAfter');
  if (!sameBranch(frame.branch, artifact.branch)) diffs.push('branch');
  return `stale artifact: differs in ${diffs.join(', ')}`;
}
