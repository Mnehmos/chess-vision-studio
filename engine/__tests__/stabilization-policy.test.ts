import { describe, expect, it } from 'vitest';
import {
  CONFIDENT_STATUSES,
  QUARANTINED_STATUSES,
  canClaimObjectiveOutcome,
  canEnterCorpus,
  canMintPuzzle,
  isConfident,
  isQuarantined,
  isStabilizationStatus,
  normalizeStatus,
  stabilizationGate,
} from '../stabilization-policy';
import { buildGatedBestMovePuzzle, buildGatedTeachingPuzzle } from '../teaching/puzzle';
import type { TeachingFactBundleV1 } from '../teaching/types';

// The exact strings the Rust engine emits via StabilizationStatus::as_str()
// (rust-engine src/search/stability.rs). This is the contract the policy MUST match —
// a mismatch would fail-safe-quarantine 100% of real engine results.
const ENGINE_AS_STR = {
  ExactTablebase: 'exact-tablebase',
  VerifiedForcedMate: 'verified-forced-mate',
  StableAtBudget: 'stable-at-budget',
  UnstableTrajectory: 'unstable-trajectory',
  OmissionRisk: 'omission-risk',
  VerifierConflict: 'verifier-conflict',
  UnresolvedAtBudget: 'unresolved-at-budget',
} as const;

describe('stabilization-policy', () => {
  it('confident statuses permit confident actions', () => {
    for (const s of CONFIDENT_STATUSES) {
      expect(isConfident(s)).toBe(true);
      expect(isQuarantined(s)).toBe(false);
    }
  });

  it('quarantined statuses deny confident actions', () => {
    for (const s of QUARANTINED_STATUSES) {
      expect(isConfident(s)).toBe(false);
      expect(isQuarantined(s)).toBe(true);
    }
  });

  it('matches the engine kebab contract (StabilizationStatus::as_str)', () => {
    // The three confident engine outputs unlock; the four quarantined ones do not.
    expect(isConfident(ENGINE_AS_STR.ExactTablebase)).toBe(true);
    expect(isConfident(ENGINE_AS_STR.VerifiedForcedMate)).toBe(true);
    expect(isConfident(ENGINE_AS_STR.StableAtBudget)).toBe(true);
    expect(isConfident(ENGINE_AS_STR.UnstableTrajectory)).toBe(false);
    expect(isConfident(ENGINE_AS_STR.OmissionRisk)).toBe(false);
    expect(isConfident(ENGINE_AS_STR.VerifierConflict)).toBe(false);
    expect(isConfident(ENGINE_AS_STR.UnresolvedAtBudget)).toBe(false);
    // every engine string is a recognized status (none falls to the fail-safe unknown branch)
    for (const s of Object.values(ENGINE_AS_STR)) expect(isStabilizationStatus(s)).toBe(true);
  });

  it('accepts the issue-prose snake_case form via normalization', () => {
    expect(normalizeStatus('stable_at_budget')).toBe('stable-at-budget');
    expect(isConfident('stable_at_budget')).toBe(true); // snake alias of a confident status
    expect(isConfident('UNSTABLE_TRAJECTORY')).toBe(false);
    expect(isConfident(' stable-at-budget ')).toBe(true); // stray whitespace tolerated
  });

  it('fails safe on an unknown / missing status', () => {
    for (const s of ['', 'made_up', undefined, null] as Array<string | undefined | null>) {
      expect(isConfident(s)).toBe(false);
      expect(canMintPuzzle(s)).toBe(false);
      const d = stabilizationGate(s);
      expect(d.confident).toBe(false);
      expect(d.allow.mintPuzzle).toBe(false);
      expect(d.quarantineReason).toMatch(/fail-safe/);
    }
  });

  it('confident and quarantined sets are disjoint and cover all 7 statuses', () => {
    const all = [...CONFIDENT_STATUSES, ...QUARANTINED_STATUSES];
    expect(new Set(all).size).toBe(7);
    for (const s of all) expect(isStabilizationStatus(s)).toBe(true);
    expect(isStabilizationStatus('nope')).toBe(false);
    expect(isStabilizationStatus(undefined)).toBe(false);
  });

  it('gate permits every confident action when confident', () => {
    const d = stabilizationGate('stable-at-budget');
    expect(d.confident).toBe(true);
    expect(d.allow).toEqual({
      mintPuzzle: true,
      claimObjectiveOutcome: true,
      teachConfident: true,
      enterCorpus: true,
      feedDifficulty: true,
    });
    expect(d.quarantineReason).toBeUndefined();
  });

  it('gate denies every confident action when quarantined, with a reason', () => {
    const d = stabilizationGate('unstable-trajectory');
    expect(d.confident).toBe(false);
    expect(Object.values(d.allow).every((v) => v === false)).toBe(true);
    expect(d.quarantineReason).toContain('converge');
  });

  it('convenience predicates agree with isConfident', () => {
    expect(canMintPuzzle('exact-tablebase')).toBe(true);
    expect(canClaimObjectiveOutcome('verified-forced-mate')).toBe(true);
    expect(canEnterCorpus('omission-risk')).toBe(false);
  });
});

describe('puzzle minting respects the stabilization gate (#35)', () => {
  const facts = {
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    before: { sideToMove: 'white' },
    best: { move: { uci: 'e2e4' } },
  } as unknown as TeachingFactBundleV1;

  it('mints from every confident status', () => {
    for (const s of CONFIDENT_STATUSES) {
      const p = buildGatedBestMovePuzzle(facts, s);
      expect(p).not.toBeNull();
      expect(p?.topicId).toBe('best_move');
    }
  });

  it('refuses to mint from a quarantined or unknown node', () => {
    for (const s of QUARANTINED_STATUSES) {
      expect(buildGatedBestMovePuzzle(facts, s)).toBeNull();
    }
    expect(buildGatedBestMovePuzzle(facts, undefined)).toBeNull();
    // the event-based gated wrapper short-circuits before touching the event, too
    expect(
      buildGatedTeachingPuzzle({} as never, facts, 'unresolved-at-budget'),
    ).toBeNull();
  });
});
