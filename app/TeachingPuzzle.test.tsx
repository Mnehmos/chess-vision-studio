// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(getByText(/stage 1\/2/)).toBeTruthy();
    expect(getByText(/Find the punishment/)).toBeTruthy();
  });
});
