// @vitest-environment jsdom
// Play mode enforces legality via chess.js: legal moves apply, illegal moves are
// no-ops, and the game-over state is detected. Click-to-move is exercised here;
// drag-and-drop funnels through the same tryMove() path.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import allowedForkFixture from '../fixtures/teaching-facts/v1/allowed-fork.json';
import type { UciEngine } from '../engine/evaluation';
import type { TeachingFactBundleV1 } from '../engine/teaching/types';
import { PlayMode } from './PlayMode';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('exposes a dev debug overlay (artifact identity + eval status) behind a toggle', () => {
    const { container, getByText } = render(<PlayMode />);
    expect(container.querySelector('[data-testid="debug-overlay"]')).toBeNull();
    fireEvent.click(getByText('debug'));
    const panel = container.querySelector('[data-testid="debug-overlay"]');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('positionAfter===fen');
    expect(panel!.textContent).toContain('analysis.positionId');
  });

  it('compiles Rust facts into deterministic teaching cards after a live move', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          fen: '',
          uci: null,
          scoreCp: 0,
          mate: null,
          pv: [],
          depth: 1,
          nodes: 0,
          qNodes: 0,
          ttHits: 0,
          timeMs: 0,
        }),
      })),
    );
    const engine = {
      evaluate: vi.fn(async ({ fen }: { fen: string }) =>
        fen.includes(' b ')
          ? { cp: 200, depth: 14, pv: ['e5'] }
          : { cp: 0, depth: 14, pv: ['e4'] },
      ),
      dispose: vi.fn(),
    } as unknown as UciEngine;
    const loadTeachingFacts = vi.fn(async () =>
      structuredClone(allowedForkFixture as unknown as TeachingFactBundleV1),
    );
    const { container } = render(
      <PlayMode
        engine={engine}
        engineReady
        cvsHealth={{ ok: true, available: true }}
        loadTeachingFacts={loadTeachingFacts}
      />,
    );

    fireEvent.click(container.querySelector('[data-square="e2"]')!);
    fireEvent.click(container.querySelector('[data-square="e4"]')!);

    await waitFor(() => expect(loadTeachingFacts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('[data-testid="teaching-card"]')).toBeTruthy());
    expect(container.textContent).toContain('Allowed Fork');
  });

  it('vs an engine opponent, builds a running dialogue — your move persists when the coach replies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ fen: '', uci: null, scoreCp: 0, mate: null, pv: [], depth: 1, nodes: 0, qNodes: 0, ttHits: 0, timeMs: 0 }),
      })),
    );
    const engine = {
      evaluate: vi.fn(async ({ fen }: { fen: string }) =>
        fen.includes(' b ') ? { cp: 200, depth: 14, pv: ['e5'] } : { cp: 0, depth: 14, pv: ['e4'] },
      ),
      bestMove: vi.fn(async () => 'e7e5'), // the coach's reply
      dispose: vi.fn(),
    } as unknown as UciEngine;
    const loadTeachingFacts = vi.fn(async () =>
      structuredClone(allowedForkFixture as unknown as TeachingFactBundleV1),
    );
    const { container } = render(
      <PlayMode engine={engine} engineReady cvsHealth={{ ok: true, available: true }} loadTeachingFacts={loadTeachingFacts} />,
    );

    fireEvent.click(container.querySelector('[data-testid="opponent-stockfish"]')!); // engine opponent on; you stay White
    fireEvent.click(container.querySelector('[data-square="e2"]')!);
    fireEvent.click(container.querySelector('[data-square="e4"]')!);

    // Dialogue appears with your move and its native teaching headline.
    await waitFor(() => expect(container.querySelector('[data-testid="teaching-log"]')).toBeTruthy());
    await waitFor(() => expect(container.textContent).toContain('allowed a knight fork'));

    // The coach replies — now TWO turns, and YOUR move's teaching is still on screen.
    await waitFor(() => expect(container.querySelectorAll('[data-testid="coach-turn"]').length).toBe(2), {
      timeout: 3000,
    });
    expect(engine.bestMove).toHaveBeenCalled();
    expect(container.textContent).toContain('You');
    expect(container.textContent).toContain('Stockfish');
    expect(container.textContent).toContain('allowed a knight fork'); // persisted, not overwritten
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
