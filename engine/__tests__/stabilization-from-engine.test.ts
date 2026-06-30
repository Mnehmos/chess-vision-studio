import { describe, expect, it } from 'vitest';
import { engineStabilization, stabilizationFromEngine } from '../stabilization-from-engine';

// The exact kebab strings the rust engine emits via StabilizationStatus::as_str
// (chess-vision-studio-rust-engine src/search/stability.rs) — the cross-repo contract that #7
// slice 2 (analyze emit) and #35 (policy) must agree on, exercised end-to-end here.
const ENGINE_CONFIDENT = ['exact-tablebase', 'verified-forced-mate', 'stable-at-budget'];
const ENGINE_QUARANTINED = [
  'unstable-trajectory',
  'omission-risk',
  'verifier-conflict',
  'unresolved-at-budget',
];

describe('stabilization-from-engine adapter (#35 slice 2 / #7 slice 2 chain)', () => {
  it('maps every confident engine status to a confident decision', () => {
    for (const status of ENGINE_CONFIDENT) {
      const d = stabilizationFromEngine({ stabilization: { status } });
      expect(d.confident).toBe(true);
      expect(d.allow.mintPuzzle).toBe(true);
    }
  });

  it('maps every quarantined engine status to a quarantined decision', () => {
    for (const status of ENGINE_QUARANTINED) {
      const d = stabilizationFromEngine({ stabilization: { status } });
      expect(d.confident).toBe(false);
      expect(d.allow.mintPuzzle).toBe(false);
      expect(d.quarantineReason).toBeTruthy();
    }
  });

  it('fail-safe quarantines a result with NO stabilization block (older analyze output)', () => {
    const d = stabilizationFromEngine({});
    expect(d.confident).toBe(false);
    expect(d.quarantineReason).toMatch(/fail-safe/);
  });

  it('fail-safe quarantines a stabilization block with no status', () => {
    const d = stabilizationFromEngine({ stabilization: { scoreRangeCp: 10 } });
    expect(d.confident).toBe(false);
  });

  it('fail-safe quarantines null / undefined results', () => {
    expect(stabilizationFromEngine(null).confident).toBe(false);
    expect(stabilizationFromEngine(undefined).confident).toBe(false);
  });

  it('a confident decision permits every gated action', () => {
    const d = stabilizationFromEngine({ stabilization: { status: 'stable-at-budget' } });
    expect(d.allow).toEqual({
      mintPuzzle: true,
      claimObjectiveOutcome: true,
      teachConfident: true,
      enterCorpus: true,
      feedDifficulty: true,
    });
  });

  it('engineStabilization returns the raw block (for provenance) or null', () => {
    const block = { status: 'stable-at-budget', scoreRangeCp: 5, reasons: ['stable'] };
    expect(engineStabilization({ stabilization: block })).toEqual(block);
    expect(engineStabilization({})).toBeNull();
    expect(engineStabilization(null)).toBeNull();
  });
});
