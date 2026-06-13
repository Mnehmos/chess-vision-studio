// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyzedEntry } from '../engine/analytics';
import type { FeatureEntry, PlyFeatures } from '../engine/features';
import type { Classification, MoveAnalysis } from '../engine/types';
import { AnalyticsPanel } from './AnalyticsPanel';

const analysis = (
  move: string,
  classification: Classification,
  cpLoss: number,
  topExplanation: string,
): MoveAnalysis => ({
  positionBefore: '8/8/8/8/8/8/4K3/6k1 w - - 0 1',
  positionAfter: '8/8/8/8/8/8/4K3/6k1 w - - 0 1',
  move,
  classification,
  cpLoss,
  topExplanation,
  evalBefore: { cp: 0, depth: 14, pv: [] },
  evalAfter: { cp: 0, depth: 14, pv: [] },
  rankedInsights: [],
});

const entries: AnalyzedEntry[] = [
  { ply: 1, color: 'w', analysis: analysis('1. e4', 'best', 0, 'Controls the center.') },
  { ply: 2, color: 'b', analysis: analysis('1... e5', 'mistake', 1.4, 'Missed a forcing reply.') },
  { ply: 3, color: 'w', analysis: analysis('2. Nf3', 'excellent', 0.1, 'Develops with tempo.') },
  {
    ply: 4,
    color: 'b',
    analysis: analysis('2... f6', 'blunder', 3.2, 'Weakens the king and loses material.'),
  },
];

const feature = (
  ply: number,
  type: 'missed_forcing_move' | 'king_safety_collapse',
  label: string,
): FeatureEntry => ({
  ply,
  color: 'b',
  analysis: entries.find((entry) => entry.ply === ply)!.analysis,
  features: {
    phase: 'opening',
    patterns: [{ type, side: 'b', severity: 1, label, squares: [] }],
    motifs: { availableBefore: {}, createdAfter: {}, missedByMover: {}, refutation: {} },
  } as unknown as PlyFeatures,
});

const features = [
  feature(2, 'missed_forcing_move', 'Missed a forcing move or validated tactic'),
  feature(4, 'missed_forcing_move', 'Missed a forcing move or validated tactic'),
  feature(4, 'king_safety_collapse', 'King safety got cramped'),
];

describe('AnalyticsPanel tutor workflow', () => {
  it('focuses the side that needs more work and practices before the worst move', () => {
    const onJump = vi.fn();
    const { getByText, getAllByText } = render(
      <AnalyticsPanel entries={entries} view={4} onJump={onJump} />,
    );

    expect(getByText("Black's priority: improve decisions at turning points")).toBeTruthy();
    fireEvent.click(getAllByText('Try from here')[0]);
    expect(onJump).toHaveBeenCalledWith(3);
  });

  it('keeps the complete diagnostics available in the All data view', () => {
    const { getByText } = render(
      <AnalyticsPanel entries={entries} view={4} onJump={() => undefined} />,
    );

    fireEvent.click(getByText('All data'));
    expect(getByText('Phase loss (average pawns)')).toBeTruthy();
    expect(getByText("Black's mistakes")).toBeTruthy();
    expect(getByText('Game timeline')).toBeTruthy();
  });

  it('lists each occurrence for the selected recurring theme', () => {
    const onJump = vi.fn();
    const { getByRole, getAllByText } = render(
      <AnalyticsPanel entries={entries} features={features} view={4} onJump={onJump} />,
    );

    expect(
      getByRole('button', { name: 'Missed forcing moves 2' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(getAllByText('Missed a forcing move or validated tactic')).toHaveLength(2);
    fireEvent.click(getAllByText('1... e5')[0]);
    expect(onJump).toHaveBeenCalledWith(2);
  });
});
