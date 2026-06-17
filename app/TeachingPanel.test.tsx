// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TeachingNode } from '../engine/teaching/node';
import { TeachingPanel } from './TeachingPanel';

const NODE: TeachingNode = {
  schemaVersion: 1,
  id: 'fork:e2e4:g5f3',
  rootPositionKey: 'startpos',
  subjectMove: 'e2e4',
  kind: 'tactic',
  conceptCode: 'knight_multi_attack',
  claimStatus: 'confirmed',
  confidence: 1.0,
  title: 'Knight Fork',
  summary: 'e4 allowed a knight fork.',
  why: 'Knight to f3 attacks the king on g1 and the rook on e1.',
  involvedSquares: ['e1', 'f3', 'g1'],
  boardPayload: {
    arrows: [{ from: 'f3', to: 'e1', color: 'red' }, { from: 'f3', to: 'g1', color: 'red' }],
    squares: [{ square: 'e1' }, { square: 'f3' }, { square: 'g1' }]
  },
  verification: {
    required: true,
    status: 'confirmed',
    expectedMove: 'g5f3',
  },
  provenance: {
    factIds: [],
    detectorIds: [],
    pipelineVersion: '1',
  }
};

describe('TeachingPanel', () => {
  it('renders the committed event card with its proof badge and status', () => {
    const { getByText, getByTestId } = render(
      <TeachingPanel nodes={[NODE]} busy={false} error="" focusedId={null} onShow={() => {}} />,
    );
    expect(getByTestId('teaching-node-card')).toBeTruthy();
    expect(getByText('Knight Fork')).toBeTruthy();
    expect(getByText('e4 allowed a knight fork.')).toBeTruthy();
    expect(getByText('Confirmed')).toBeTruthy();
    expect(getByText(/Knight to f3 attacks/)).toBeTruthy();
  });

  it('fires onShow with the node when Show on board is clicked', () => {
    const onShow = vi.fn();
    const { getByText } = render(
      <TeachingPanel nodes={[NODE]} busy={false} error="" focusedId={null} onShow={onShow} />,
    );
    fireEvent.click(getByText('Show on board'));
    expect(onShow).toHaveBeenCalledWith(NODE);
  });

  it('shows a quiet message when no topic was committed', () => {
    const { getByText } = render(
      <TeachingPanel nodes={[]} busy={false} error="" focusedId={null} onShow={() => {}} />,
    );
    expect(getByText(/No teaching topic/)).toBeTruthy();
  });
});
