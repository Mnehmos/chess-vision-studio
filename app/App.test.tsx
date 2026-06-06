// @vitest-environment jsdom
// Reproduce/verify the move-history + navigation behavior end to end.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';

// The browser engine boots a Web Worker (absent in jsdom) — stub it so the app
// mounts in "pure mode" and we can exercise navigation deterministically.
vi.mock('./engine-browser', () => ({ tryCreateEngine: async () => null }));

import { App } from './App';

afterEach(cleanup);

describe('App — move history + navigation', () => {
  it('renders the full game move history (grouped notation)', () => {
    const { container, getAllByText } = render(<App />);
    // 61 half-moves → ≥ 31 rows in the grouped move-history table.
    const rows = container.querySelectorAll('table tr');
    expect(rows.length).toBeGreaterThanOrEqual(31);
    // specific moves from the sample game are present (strip + table → ≥2 each)
    expect(getAllByText('Bf4').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('R1e7#').length).toBeGreaterThanOrEqual(1);
  });

  it('advances the BOARD as turns progress (1.d4 moves the d-pawn d2→d4)', () => {
    const { container, getByText } = render(<App />);
    const dataPiece = (sq: string) =>
      container.querySelector(`[data-square="${sq}"]`)?.getAttribute('data-piece');

    // start position: white pawn on d2, nothing on d4
    expect(dataPiece('d2')).toBe('wP');
    expect(dataPiece('d4')).toBe('');

    // click forward one ply
    fireEvent.click(getByText('▶'));

    // after 1.d4 the board must reflect it
    expect(dataPiece('d2')).toBe('');
    expect(dataPiece('d4')).toBe('wP');
  });

  it('highlights the current move in the history as you step', () => {
    const { container, getByText } = render(<App />);
    fireEvent.click(getByText('▶')); // ply 1
    fireEvent.click(getByText('▶')); // ply 2
    // the ply indicator updates
    expect(within(container as HTMLElement).getByText(/ply 2 \//)).toBeTruthy();
  });
});
