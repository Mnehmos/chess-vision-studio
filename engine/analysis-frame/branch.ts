/**
 * AttributedFactBranch — pairs a Rust MoveStateFacts payload with the exact
 * (source, role, moveUci) it was attributed to (plan §4.7, §6 PR-09 branch
 * attribution). The same UCI move searched by two different engines is two
 * DIFFERENT attributed branches: Stockfish's best and CVS's best can collide on
 * the move string yet must never be conflated. Attribution is fixed at creation;
 * a branch cannot be re-pointed at a different source after the fact (the helper
 * is pure and returns a fresh value — see attributeBranch).
 *
 * `source`/`role` are deliberately the narrowed subsets the frame's attributed
 * fact slots use: every attributed fact branch is `played`, `best`, `refutation`,
 * or `candidate` — never the `root` of the line (the root has no single owning
 * move). These are the same string literals as identity.ts's BranchSource and the
 * AnalysisBranch roles, kept as a local exact union so the frame slots type-check
 * without admitting `root`.
 */
import type { MoveStateFacts } from '../teaching/types';

/** Who produced this branch. Matches identity.ts BranchSource exactly. */
export type AttributedBranchSource = 'user' | 'game' | 'stockfish' | 'cvs';

/**
 * Which line role this attributed branch fills. A strict subset of the
 * identity.ts AnalysisBranch roles — `root` is intentionally excluded because an
 * attributed *move* branch always has an owning move, and the root does not.
 */
export type AttributedBranchRole = 'played' | 'best' | 'refutation' | 'candidate';

export interface AttributedFactBranch {
  source: AttributedBranchSource;
  role: AttributedBranchRole;
  /** The UCI move this branch represents (e.g. 'e2e4'). NOT unique across sources. */
  moveUci: string;
  /** The Rust-computed facts for the position reached by `moveUci`. */
  state: MoveStateFacts;
}

/**
 * Pure constructor for an attributed branch. Performs no mutation and reads no
 * clock — it just binds (source, role, moveUci) to a MoveStateFacts payload so
 * the attribution is captured at the call site and cannot drift. Because it is
 * pure, the only way to "change" a branch's source is to build a new one; an
 * existing AttributedFactBranch is never relabeled in place.
 */
export function attributeBranch(
  source: AttributedBranchSource,
  role: AttributedBranchRole,
  moveUci: string,
  state: MoveStateFacts,
): AttributedFactBranch {
  return { source, role, moveUci, state };
}
