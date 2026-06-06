import { describe, it, expect } from 'vitest';
import { controlShare, type ThreatFeatureSummary } from '../features';

const threat = (over: Partial<ThreatFeatureSummary>): ThreatFeatureSummary => ({
  whiteControl: 0,
  blackControl: 0,
  contested: 0,
  centerWhite: 0,
  centerBlack: 0,
  whiteKingPressure: 0,
  blackKingPressure: 0,
  checksAvailable: { w: 0, b: 0 },
  initiative: { w: 0, b: 0 },
  ...over,
});

describe('controlShare — board-territory analytics from the threat map', () => {
  it('splits squares into exclusive / contested / neutral over the 64-square board', () => {
    // White attacks 20 squares (4 shared), Black 16 (4 shared) → 16 W-only, 12 B-only.
    const c = controlShare(threat({ whiteControl: 20, blackControl: 16, contested: 4 }));
    expect(c.whitePct).toBe(31); // 20/64
    expect(c.blackPct).toBe(25); // 16/64
    expect(c.contestedPct).toBe(6); // 4/64
    expect(c.exclusiveWhitePct).toBe(25); // 16/64
    expect(c.exclusiveBlackPct).toBe(19); // 12/64
    // the four disjoint buckets shown in the bar/legend sum to EXACTLY 100
    const sum = c.exclusiveWhitePct + c.contestedPct + c.exclusiveBlackPct + c.neutralPct;
    expect(sum).toBe(100);
    // reach (whitePct/blackPct) overlaps on contested, so it must NOT be added in
    expect(c.whitePct).toBe(c.exclusiveWhitePct + c.contestedPct);
  });

  it('passes through center control and never goes negative', () => {
    const c = controlShare(threat({ whiteControl: 2, blackControl: 2, contested: 5, centerWhite: 3, centerBlack: 1 }));
    expect(c.centerWhite).toBe(3);
    expect(c.centerBlack).toBe(1);
    expect(c.exclusiveWhitePct).toBeGreaterThanOrEqual(0); // contested > control is clamped
  });
});
