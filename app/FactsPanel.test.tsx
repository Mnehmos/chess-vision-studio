// @vitest-environment jsdom
// The Facts card must never render an analysis computed for a different position than
// the one on screen (the state-contamination guard: positionAfter must equal fen).
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FactsPanel } from './FactsPanel';
import type { MoveAnalysis } from '../engine/types';

afterEach(cleanup);

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const mk = (positionAfter: string): MoveAnalysis => ({
  positionBefore: START,
  positionAfter,
  move: '1. Qxb5',
  classification: 'blunder',
  evalBefore: { depth: 14, pv: [] },
  evalAfter: { depth: 14, pv: [] },
  cpLoss: 3,
  rankedInsights: [],
  topExplanation: 'Qxb5 hangs the queen.',
});

describe('FactsPanel — staleness guard (analysis must match the displayed FEN)', () => {
  it('renders an analysis computed for the current position', () => {
    const { container } = render(<FactsPanel fen={START} analysis={mk(START)} move="1. Qxb5" />);
    expect(container.textContent).toContain('blunder');
    expect(container.textContent).toContain('hangs the queen');
  });

  it('hides an analysis computed for a DIFFERENT position', () => {
    const otherFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const { container } = render(<FactsPanel fen={START} analysis={mk(otherFen)} move="1. Qxb5" />);
    expect(container.textContent).not.toContain('blunder');
    expect(container.textContent).not.toContain('hangs the queen');
  });
});
