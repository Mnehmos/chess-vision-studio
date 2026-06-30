/**
 * StabilizationPolicy — the ONE shared consumer policy for engine stabilization
 * (issue #35; consumes the Rust `StabilizationReport` from rust-engine #7).
 *
 * A downstream action that asserts objective chess truth — minting/publishing a
 * puzzle, classifying a sacrifice as sound or unsound, publishing a confident
 * teaching claim, entering a corpus export, or feeding the difficulty model — is
 * allowed ONLY when the engine's final evaluation is stable enough to support it.
 * Every consumer should import THIS policy rather than reinterpreting raw depth or
 * score independently, so "is this result trustworthy?" has exactly one answer.
 * (Rollout is incremental — see the deferred consumers in the PR; this module is
 * the single source of truth they migrate onto, not yet a universal interception.)
 *
 * Quarantined results are not discarded: a consumer may still surface the local
 * deterministic facts that remain valid regardless of search stability (legality,
 * attacks, defenders, SEE cost) — it simply may not assert that a move is
 * objectively sound, winning, refuted, or the unique solution.
 *
 * STATUS STRING CONTRACT: the Rust engine emits its status as KEBAB-CASE via the
 * hand-written `StabilizationStatus::as_str()` (rust-engine src/search/stability.rs,
 * e.g. `StableAtBudget => "stable-at-budget"`). This policy's canonical strings are
 * that kebab form, and `normalizeStatus` additionally accepts the snake_case form the
 * issue prose uses — so a delimiter mismatch can never mis-quarantine a real status.
 * NOTE (forward-wiring): rust #7 today only CONSTRUCTS 5 of the 7 statuses; the two
 * mate/verifier statuses await the #3 sacrifice-verifier, and `analyze.rs` does not
 * yet emit the field — so this gate is wired ahead of its engine producer.
 *
 * Pure, additive, no I/O.
 */

/**
 * The stabilization statuses the Rust engine reports (#7), in the engine's canonical
 * KEBAB-CASE form (`StabilizationStatus::as_str()`).
 */
export type StabilizationStatus =
  | 'exact-tablebase'
  | 'verified-forced-mate'
  | 'stable-at-budget'
  | 'unstable-trajectory'
  | 'omission-risk'
  | 'verifier-conflict'
  | 'unresolved-at-budget';

/** Confident, truth-asserting downstream actions are allowed ONLY for these (issue #35). */
export const CONFIDENT_STATUSES = [
  'exact-tablebase',
  'verified-forced-mate',
  'stable-at-budget',
] as const;

/** These are quarantined — only locally-valid deterministic facts may be shown. */
export const QUARANTINED_STATUSES = [
  'unstable-trajectory',
  'omission-risk',
  'verifier-conflict',
  'unresolved-at-budget',
] as const;

const CONFIDENT = new Set<string>(CONFIDENT_STATUSES);

/**
 * Normalize an incoming status to the engine's canonical kebab-case form. The Rust
 * engine emits kebab-case (`as_str()` -> "stable-at-budget"); the #35 issue prose
 * uses snake_case ("stable_at_budget"). Accept BOTH (plus stray case/whitespace) so
 * the gate can never mis-quarantine a real engine status on a delimiter mismatch.
 * A non-string normalizes to '' (which is never confident -> quarantined).
 */
export function normalizeStatus(status: StabilizationStatus | string | undefined | null): string {
  return typeof status === 'string' ? status.trim().toLowerCase().replace(/_/g, '-') : '';
}

/**
 * Whether a status permits confident, truth-asserting downstream actions. FAIL
 * SAFE: any unknown / undefined / null status is treated as quarantined (NOT
 * confident), so a newly-added or missing status can never silently unlock a
 * confident action — it must be added to `CONFIDENT_STATUSES` deliberately.
 */
export function isConfident(status: StabilizationStatus | string | undefined | null): boolean {
  return CONFIDENT.has(normalizeStatus(status));
}

/** The complement of `isConfident` (unknown / missing statuses are quarantined). */
export function isQuarantined(status: StabilizationStatus | string | undefined | null): boolean {
  return !isConfident(status);
}

/** Narrowing type guard for a recognized status string (accepts kebab or snake input). */
export function isStabilizationStatus(value: unknown): value is StabilizationStatus {
  const n = normalizeStatus(value as string | undefined | null);
  return CONFIDENT.has(n) || (QUARANTINED_STATUSES as readonly string[]).includes(n);
}

/** The confident actions this policy gates. Each is permitted only on a confident status. */
export interface StabilizationAllowance {
  /** Mint / publish a puzzle from this (critical) node. */
  mintPuzzle: boolean;
  /** Claim the move is objectively sound / unsound / winning / refuted / unique. */
  claimObjectiveOutcome: boolean;
  /** Publish a confident teaching card (vs a local-facts uncertainty card). */
  teachConfident: boolean;
  /** Enter a corpus export. */
  enterCorpus: boolean;
  /** Feed the difficulty model. */
  feedDifficulty: boolean;
}

export interface StabilizationDecision {
  status: StabilizationStatus | string | undefined | null;
  confident: boolean;
  allow: StabilizationAllowance;
  /** Why it was quarantined (absent when confident). */
  quarantineReason?: string;
}

const QUARANTINE_REASONS: Record<string, string> = {
  'unstable-trajectory': 'evaluation did not converge — the score was still swinging at budget',
  'omission-risk': 'search may have omitted a critical reply (high skipped-move risk)',
  'verifier-conflict': 'the required verifier disagreed with the primary search',
  'unresolved-at-budget': 'no stable verdict within the search budget',
};

/**
 * The single gate every consumer calls. Returns the allowance for each confident
 * action plus a quarantine reason. When confident, all actions are permitted; when
 * quarantined, ALL confident actions are denied (consumers may still show the
 * locally-valid deterministic facts that do not depend on the unstable evaluation —
 * that fallback is not one of the gated actions, so it is always available).
 */
export function stabilizationGate(
  status: StabilizationStatus | string | undefined | null,
): StabilizationDecision {
  const confident = isConfident(status);
  const allow: StabilizationAllowance = {
    mintPuzzle: confident,
    claimObjectiveOutcome: confident,
    teachConfident: confident,
    enterCorpus: confident,
    feedDifficulty: confident,
  };
  const decision: StabilizationDecision = { status, confident, allow };
  if (!confident) {
    decision.quarantineReason =
      QUARANTINE_REASONS[normalizeStatus(status)] ||
      `unrecognized or missing stabilization status (${status ?? 'none'}) — quarantined fail-safe`;
  }
  return decision;
}

/** Convenience: may a puzzle be minted from a node with this status? (#35) */
export function canMintPuzzle(status: StabilizationStatus | string | undefined | null): boolean {
  return isConfident(status);
}

/** Convenience: may a move be classified as objectively sound/unsound/winning/refuted? (#35) */
export function canClaimObjectiveOutcome(
  status: StabilizationStatus | string | undefined | null,
): boolean {
  return isConfident(status);
}

/** Convenience: may this node enter a corpus export / feed the difficulty model? (#35) */
export function canEnterCorpus(status: StabilizationStatus | string | undefined | null): boolean {
  return isConfident(status);
}
