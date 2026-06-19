// @vitest-environment jsdom
// Reproduce/verify the move-history + navigation behavior end to end.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';

// The browser engine boots a Web Worker (absent in jsdom) — stub it so the app
// mounts in "pure mode" and we can exercise navigation deterministically.
vi.mock('./engine-browser', () => ({ tryCreateEngine: async () => null }));

import { App } from './App';

afterEach(cleanup);

const FEN_ONLY_PGN = `[Event "?"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]
[SetUp "1"]
[FEN "2kr3r/ppp2Nbp/4p1p1/2q2n2/2B5/1P2R3/P5PP/R2Q3K w - - 0 1"]
[Link "https://www.chess.com/analysis/game/pgn/5LBfKDrV7U/analysis"]

*`;

describe('App — move history + navigation', () => {
  it('renders the full game move history (grouped notation)', () => {
    const { container, getAllByText } = render(<App />);
    const legend = container.querySelector('.cvs-workspace')?.firstElementChild as HTMLElement | null;
    expect(legend?.classList.contains('annotation-command-list')).toBe(true);
    expect(container.querySelector('.cvs-gif-capture--analysis')).toBeTruthy();
    expect(container.querySelector('.cvs-gif-capture--play')).toBeNull();
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
  it('loads a From Position PGN with only a FEN and no moves', () => {
    const { container, getByText, queryByText } = render(<App />);
    fireEvent.click(getByText(/Import PGN/));
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea!, { target: { value: FEN_ONLY_PGN } });
    fireEvent.click(getByText('Load games'));

    const dataPiece = (sq: string) =>
      container.querySelector(`[data-square="${sq}"]`)?.getAttribute('data-piece');
    expect(dataPiece('c8')).toBe('bK');
    expect(dataPiece('f7')).toBe('wN');
    expect(dataPiece('h1')).toBe('wK');

    fireEvent.click(container.querySelector('[data-square="f7"]')!);
    fireEvent.click(container.querySelector('[data-square="d8"]')!);
    expect(dataPiece('f7')).toBe('');
    expect(dataPiece('d8')).toBe('wN');
    expect(getByText('Nxd8')).toBeTruthy();
    expect(container.textContent).toContain('branch after start');

    fireEvent.click(getByText('Back to source line'));
    expect(dataPiece('c8')).toBe('bK');
    expect(dataPiece('f7')).toBe('wN');
    expect(queryByText('Back to source line')).toBeNull();
  });
});
