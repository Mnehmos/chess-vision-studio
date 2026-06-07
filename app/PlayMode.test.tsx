// @vitest-environment jsdom
// Play mode enforces legality via chess.js: legal moves apply, illegal moves are
// no-ops, and the game-over state is detected. Click-to-move is exercised here;
// drag-and-drop funnels through the same tryMove() path.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PlayMode } from './PlayMode';

afterEach(cleanup);

describe('PlayMode — legal chess', () => {
  it('starts at the initial position with White to move', () => {
    const { container } = render(<PlayMode />);
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64);
    expect(container.querySelector('[data-square="e2"]')!.getAttribute('data-piece')).toBe('wP');
    expect(container.querySelector('[data-testid="play-status"]')!.textContent).toBe('White to move');
  });

  it('applies a legal click-to-move (e2 → e4) and flips the side to move', () => {
    const { container } = render(<PlayMode />);
    const piece = (sq: string) => container.querySelector(`[data-square="${sq}"]`)!.getAttribute('data-piece');
    const click = (sq: string) => fireEvent.click(container.querySelector(`[data-square="${sq}"]`)!);

    click('e2'); // select
    click('e4'); // legal destination

    expect(piece('e2')).toBe('');
    expect(piece('e4')).toBe('wP');
    expect(container.querySelector('[data-testid="play-status"]')!.textContent).toBe('Black to move');
  });

  it('rejects an illegal move (e2 → e5) — no piece moves, side to move unchanged', () => {
    const { container } = render(<PlayMode />);
    const piece = (sq: string) => container.querySelector(`[data-square="${sq}"]`)!.getAttribute('data-piece');
    const click = (sq: string) => fireEvent.click(container.querySelector(`[data-square="${sq}"]`)!);

    click('e2');
    click('e5'); // a pawn cannot reach e5 from e2 — illegal

    expect(piece('e2')).toBe('wP');
    expect(piece('e5')).toBe('');
    expect(container.querySelector('[data-testid="play-status"]')!.textContent).toBe('White to move');
  });

  it('shows the annotation toggle legend and draws arrows when a piece is selected', () => {
    const { container, getByText } = render(<PlayMode />);
    // the same controls as the analysis board
    expect(getByText('follow move')).toBeTruthy();
    expect(getByText('threat line')).toBeTruthy();
    expect(getByText('all threats')).toBeTruthy();
    expect(getByText('cascade')).toBeTruthy();
    // selecting the e2 pawn surfaces its defender arrows (Qd1/Ke1/Bf1 → e2)
    fireEvent.click(container.querySelector('[data-square="e2"]')!);
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(0);
  });

  it('annotates whose turn it is — White plate active at start, Black after 1.e4', () => {
    const { container } = render(<PlayMode />);
    const plate = (c: string) => container.querySelector(`[data-testid="turn-${c}"]`)!.textContent!;
    expect(plate('w')).toContain('to move');
    expect(plate('b')).not.toContain('to move');
    const click = (sq: string) => fireEvent.click(container.querySelector(`[data-square="${sq}"]`)!);
    click('e2');
    click('e4');
    expect(plate('b')).toContain('to move');
    expect(plate('w')).not.toContain('to move');
  });

  it('inspects ANY square on demand — including the opponent’s pieces', () => {
    const { container } = render(<PlayMode />);
    // White to move, yet we can still inspect a Black piece (e7 pawn).
    fireEvent.click(container.querySelector('[data-square="e7"]')!);
    expect(container.textContent).toContain('black pawn'); // Facts card populated
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(0); // its arrows drawn
    // Inspection never moves anything — e7 still holds the Black pawn, White still on move.
    expect(container.querySelector('[data-square="e7"]')!.getAttribute('data-piece')).toBe('bP');
    expect(container.querySelector('[data-testid="play-status"]')!.textContent).toBe('White to move');
  });

  it('inspects an EMPTY square — surfaces who can move there / controls it, with arrows', () => {
    const { container } = render(<PlayMode />);
    fireEvent.click(container.querySelector('[data-square="a3"]')!); // empty at the start
    expect(container.textContent).toContain('empty square');
    expect(container.textContent).toContain('Can move here');
    expect(container.textContent).toContain('Pawn a2'); // a2 can advance to a3
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(0); // mover/controller lines
    // Inspection never moves anything.
    expect(container.querySelector('[data-square="a3"]')!.getAttribute('data-piece')).toBe('');
    expect(container.querySelector('[data-testid="play-status"]')!.textContent).toBe('White to move');
  });

  it('detects checkmate (fool’s mate: 1.f3 e5 2.g4 Qh4#)', () => {
    const { container } = render(<PlayMode />);
    const click = (sq: string) => fireEvent.click(container.querySelector(`[data-square="${sq}"]`)!);
    const moves: [string, string][] = [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ];
    for (const [from, to] of moves) {
      click(from);
      click(to);
    }
    expect(container.querySelector('[data-square="h4"]')!.getAttribute('data-piece')).toBe('bQ');
    const status = container.querySelector('[data-testid="play-status"]')!.textContent!;
    expect(status).toContain('Checkmate');
    expect(status).toContain('Black wins');
  });
});
