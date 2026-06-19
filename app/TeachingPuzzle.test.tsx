// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TeachingPuzzle as Puzzle } from '../engine/teaching/puzzle';
import { TeachingPuzzle } from './TeachingPuzzle';

const PUZZLE: Puzzle = {
  topicId: 'allowed_fork',
  stages: [
    {
      kind: 'punishment',
      fen: '6k1/8/8/6n1/4P3/8/8/4R1K1 b - - 0 1',
      sideToMove: 'black',
      prompt: 'White allowed a fork. Find the punishment.',
      solutionUci: 'g5f3',
      acceptableUci: ['g5f3'],
      requiredAvoidedFacts: [],
    },
    {
      kind: 'prevention',
      fen: '6k1/8/8/6n1/8/8/4P3/4R1K1 w - - 0 1',
      sideToMove: 'white',
      prompt: 'Find a move that avoids the fork.',
      solutionUci: 'g1h1',
      acceptableUci: ['g1h1'],
      requiredAvoidedFacts: [
        { factId: 'fork-g5f3', kind: 'fork', squares: ['g5', 'f3'], side: 'black' },
      ],
    },
  ],
};

describe('TeachingPuzzle', () => {
  it('renders the first stage prompt and a board', () => {
    const { getByText, getByTestId } = render(
      <TeachingPuzzle puzzle={PUZZLE} onClose={() => {}} />,
    );
    expect(getByTestId('teaching-puzzle')).toBeTruthy();
    expect(getByText(/Stage 1\/2/)).toBeTruthy();
    expect(getByText(/Black to move/)).toBeTruthy();
    expect(getByText(/Find the punishment/)).toBeTruthy();
  });

  it('supports select-then-destination move entry', async () => {
    const { container, getByText } = render(
      <TeachingPuzzle puzzle={PUZZLE} onClose={() => {}} />,
    );
    fireEvent.click(container.querySelector('[data-square="g5"]')!);
    expect(getByText(/Selected g5/)).toBeTruthy();
    fireEvent.click(container.querySelector('[data-square="f3"]')!);
    await waitFor(() => expect(getByText(/Correct/)).toBeTruthy());
  });

  it('selects the solution piece as a non-spoiling hint and closes on Escape', () => {
    const onClose = vi.fn();
    const { container, getByText } = render(
      <TeachingPuzzle puzzle={PUZZLE} onClose={onClose} />,
    );
    fireEvent.click(getByText('Hint'));
    expect(container.querySelector('[data-square="g5"]')?.getAttribute('style')).toContain(
      'box-shadow',
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
