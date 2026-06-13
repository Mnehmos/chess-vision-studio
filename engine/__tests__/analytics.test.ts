import { describe, it, expect } from 'vitest';
import { computeAnalytics, moveAccuracy, type AnalyzedEntry } from '../analytics';
import type { MoveAnalysis } from '../types';

const mk = (over: Partial<MoveAnalysis>): MoveAnalysis => ({
  positionBefore: '',
  positionAfter: '',
  move: '?',
  classification: 'good',
  evalBefore: { depth: 14, pv: [] },
  evalAfter: { depth: 14, pv: [] },
  cpLoss: 0,
  rankedInsights: [],
  topExplanation: '',
  ...over,
});

describe('moveAccuracy', () => {
  it('100 at zero loss, monotonically decreasing', () => {
    expect(moveAccuracy(0)).toBe(100);
    expect(moveAccuracy(1)).toBeLessThan(moveAccuracy(0.5));
    expect(moveAccuracy(5)).toBeLessThan(20);
  });
});

describe('computeAnalytics', () => {
  const entries: AnalyzedEntry[] = [
    { ply: 1, color: 'w', analysis: mk({ classification: 'best', cpLoss: 0, move: '1. e4' }) },
    { ply: 2, color: 'b', analysis: mk({ classification: 'blunder', cpLoss: 4, move: '1... ??' }) },
    {
      ply: 3,
      color: 'w',
      analysis: mk({ classification: 'inaccuracy', cpLoss: 1, move: '2. Nf3' }),
    },
    {
      ply: 4,
      color: 'b',
      analysis: mk({
        classification: 'mistake',
        cpLoss: 2,
        move: '2... ?',
        rankedInsights: [
          {
            id: 'x',
            kind: 'changed_relation',
            type: 'now_see_losing',
            side: 'black',
            squares: ['e5'],
            arrows: [],
            source: 'played_move',
            materialSwing: 1,
            kingSafetyDelta: 0,
            inPV: false,
            saliency: 0.4,
            templateId: 'now_see_losing',
            evidence: [],
          },
        ],
      }),
    },
  ];

  const a = computeAnalytics(entries);

  it('tallies per-side classifications and move counts', () => {
    expect(a.white.moves).toBe(2);
    expect(a.black.moves).toBe(2);
    expect(a.white.byClass.best).toBe(1);
    expect(a.black.byClass.blunder).toBe(1);
  });
  it('computes avg cpLoss and accuracy per side', () => {
    expect(a.white.avgCpLoss).toBeCloseTo(0.5, 5); // (0 + 1) / 2
    expect(a.black.avgCpLoss).toBeCloseTo(3, 5); // (4 + 2) / 2
    expect(a.white.accuracy).toBeGreaterThan(a.black.accuracy); // White played better
  });
  it('ranks the worst moves and counts headline categories', () => {
    expect(a.worstMoves[0].cpLoss).toBe(4); // the blunder is worst
    expect(a.headlineCounts['now_see_losing']).toBe(1);
  });

  it('does not treat mate sentinels as pawn-valued average loss', () => {
    const withMate: AnalyzedEntry[] = [
      { ply: 1, color: 'w', analysis: mk({ cpLoss: 1, move: '1. e4' }) },
      {
        ply: 3,
        color: 'w',
        analysis: mk({
          classification: 'blunder',
          cpLoss: 87,
          move: '2. f3',
          evalBefore: { mate: 13, depth: 18, pv: [] },
          evalAfter: { mate: -1, depth: 18, pv: [] },
        }),
      },
    ];

    expect(computeAnalytics(withMate).white.avgCpLoss).toBe(1);
  });
});
