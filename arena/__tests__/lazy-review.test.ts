import { describe, expect, it } from 'vitest';
import { shouldDeepReview } from '../review';
import type { ReviewedPly } from '../review';

const reviewed = (overrides: Partial<ReviewedPly> = {}): ReviewedPly => ({
  ply: 1,
  by: 'white',
  player: 'cvs@3',
  fenBefore: 'startpos',
  playedSan: 'e4',
  playedUci: 'e2e4',
  sfBestSan: 'e4',
  cpLoss: 0,
  classification: 'best',
  evalBeforeCp: 0,
  oracleDepth: 8,
  available: true,
  ...overrides,
});

describe('lazy OODA review prefilter', () => {
  it('skips full-depth review when the shallow oracle agrees', () => {
    expect(shouldDeepReview(reviewed({ playedSan: 'Qxf7+', sfBestSan: 'Qxf7' }), 0.5)).toBe(false);
  });

  it('promotes material shallow disagreements to full-depth review', () => {
    expect(
      shouldDeepReview(
        reviewed({ playedSan: 'Qh5', sfBestSan: 'Nf3', cpLoss: 0.3 }),
        0.5,
        0.5,
      ),
    ).toBe(true);
    expect(
      shouldDeepReview(
        reviewed({ playedSan: 'Qh5', sfBestSan: 'Nf3', cpLoss: 0.1 }),
        0.5,
        0.5,
      ),
    ).toBe(false);
  });

  it('promotes unavailable or unlabeled shallow evaluations', () => {
    expect(shouldDeepReview(reviewed({ available: false }), 0.5)).toBe(true);
    expect(shouldDeepReview(reviewed({ sfBestSan: null }), 0.5)).toBe(true);
  });
});
