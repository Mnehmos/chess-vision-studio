// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TeachingAnalysis, TeachingEvent } from '../engine/teaching/types';
import { TeachingPanel } from './TeachingPanel';

const EVENT: TeachingEvent = {
  id: 'allowed_fork:e2e4:e1-f3-g1',
  topicId: 'allowed_fork',
  family: 'tactics',
  action: 'allowed',
  mechanism: 'fork',
  side: 'white',
  playedMove: 'e2e4',
  actors: [{ id: 'black-knight-f3', side: 'black', pieceType: 'knight', square: 'f3' }],
  targets: [{ id: 'white-king-g1', side: 'white', pieceType: 'king', square: 'g1' }],
  squares: ['e1', 'f3', 'g1'],
  consequence: { cpLoss: 5, materialLoss: 5 },
  punishment: { move: 'g5f3', line: ['g5f3'] },
  correction: { move: 'g1h1', avoidedFacts: [], createdFacts: [] },
  proof: {
    validators: ['fork_validation'],
    evidence: [],
    attribution: 'proven_refutation',
    badge: 'engine_line',
  },
  saliency: 0.9,
  plan: {
    topic: 'Allowed Fork',
    headline: 'e4 allowed a knight fork.',
    cause: 'Knight to f3 attacks the king on g1 and the rook on e1.',
    consequence: 'White gives check, so the rook on e1 cannot be saved.',
    correction: 'Kh1 prevents the fork.',
  },
};

const ANALYSIS: TeachingAnalysis = {
  computed: true,
  schemaVersion: 1,
  events: [EVENT],
  primaryEvent: EVENT,
};

describe('TeachingPanel', () => {
  it('renders the committed event card with its proof badge and verdict', () => {
    const { getByText, getByTestId } = render(
      <TeachingPanel analysis={ANALYSIS} busy={false} error="" focusedId={null} onShow={() => {}} />,
    );
    expect(getByTestId('teaching-card')).toBeTruthy();
    expect(getByText('Allowed Fork')).toBeTruthy();
    expect(getByText('e4 allowed a knight fork.')).toBeTruthy();
    expect(getByText('Engine line')).toBeTruthy();
    expect(getByText('Allowed')).toBeTruthy();
    expect(getByText(/Knight to f3 attacks/)).toBeTruthy();
  });

  it('fires onShow with the event when Show on board is clicked', () => {
    const onShow = vi.fn();
    const { getByText } = render(
      <TeachingPanel analysis={ANALYSIS} busy={false} error="" focusedId={null} onShow={onShow} />,
    );
    fireEvent.click(getByText('Show on board'));
    expect(onShow).toHaveBeenCalledWith(EVENT);
  });

  it('shows a quiet message when no topic was committed', () => {
    const empty: TeachingAnalysis = { computed: true, schemaVersion: 1, events: [] };
    const { getByText } = render(
      <TeachingPanel analysis={empty} busy={false} error="" focusedId={null} onShow={() => {}} />,
    );
    expect(getByText(/No teaching topic/)).toBeTruthy();
  });
});
