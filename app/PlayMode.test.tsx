// @vitest-environment jsdom
// Play mode enforces legality via chess.js: legal moves apply, illegal moves are
// no-ops, and the game-over state is detected. Click-to-move is exercised here;
// drag-and-drop funnels through the same tryMove() path.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import allowedForkFixture from '../fixtures/teaching-facts/v1/allowed-fork.json';
import type { UciEngine } from '../engine/evaluation';
import type { TeachingFactBundleV1 } from '../engine/teaching/types';
import { PlayMode } from './PlayMode';
import type { ArrowAnalysisClients } from './arrow-analysis-store';

function makeArrowAnalysisClients(): ArrowAnalysisClients {
  const analyze = vi.fn(async (fen: string, depth: number, forcedMove?: string) => ({
    fen,
    bestmove: forcedMove,
    uci: forcedMove ?? null,
    scoreCp: 0,
    mate: null,
    pv: [],
    depth,
  }));
  return {
    analyzeStockfish: analyze,
    analyzeCvs: analyze,
    loadTeachingFacts: vi.fn(async () => {
      throw new Error('facts disabled in arrow interaction tests');
    }),
    logger: { error: vi.fn() },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlayMode — legal chess', () => {
  it('starts at the initial position with White to move', () => {
    const { container } = render(<PlayMode />);
    expect(container.querySelector('.cvs-gif-capture--play')).toBeTruthy();
    expect(container.querySelector('.cvs-gif-capture--analysis')).toBeNull();
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
    await waitFor(() => expect(container.querySelector('[data-testid="teaching-node-card"]')).toBeTruthy());
    expect(container.textContent).toContain('Apparent Knight Fork');
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
    await waitFor(() => expect(container.textContent).toContain('Apparent Knight Fork'));

    // The coach replies — now TWO turns, and YOUR move's teaching is still on screen.
    await waitFor(() => expect(container.querySelectorAll('[data-testid="coach-turn"]').length).toBe(2), {
      timeout: 3000,
    });
    expect(engine.bestMove).toHaveBeenCalled();
    expect(container.textContent).toContain('You');
    expect(container.textContent).toContain('Stockfish');
    expect(container.textContent).toContain('Apparent Knight Fork'); // persisted, not overwritten
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

  it('supports drawing sequential calculation arrows alternating turn colors', async () => {
    const engine = {
      evaluate: vi.fn(async () => ({ cp: 0, depth: 14, pv: [] })),
      dispose: vi.fn(),
    } as unknown as UciEngine;
    const arrowAnalysisClients = makeArrowAnalysisClients();

    const { container } = render(
      <PlayMode
        engine={engine}
        engineReady
        cvsHealth={{ ok: true, available: true }}
        arrowAnalysisClients={arrowAnalysisClients}
      />
    );

    // Mock document.elementFromPoint and pointer capture APIs for jsdom
    let mockElement: Element | null = null;
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => mockElement;

    const originalSetPointerCapture = window.Element.prototype.setPointerCapture;
    const originalReleasePointerCapture = window.Element.prototype.releasePointerCapture;
    window.Element.prototype.setPointerCapture = vi.fn();
    window.Element.prototype.releasePointerCapture = vi.fn();

    try {
      const boardContainer = container.querySelector('[data-square="e2"]')!.parentElement!;

      // Helper to dispatch native pointer event via MouseEvent fallback for JSDOM
      const dispatchPointer = (target: Element, type: string, init: any = {}) => {
        const ev = new window.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: init.button ?? 0,
          buttons: init.buttons ?? 0,
        });
        Object.defineProperty(ev, 'pointerId', { value: 1 });
        target.dispatchEvent(ev);
      };

      // 1. Draw e2 -> e4 (White arrow)
      mockElement = container.querySelector('[data-square="e2"]');
      act(() => {
        dispatchPointer(mockElement!, 'pointerdown', { button: 2, buttons: 2 });
      });
      
      mockElement = container.querySelector('[data-square="e4"]');
      act(() => {
        dispatchPointer(boardContainer, 'pointermove');
      });
      act(() => {
        dispatchPointer(boardContainer, 'pointerup');
      });

      // 2. Draw e7 -> e5 (Black arrow, legal on the board after e4)
      mockElement = container.querySelector('[data-square="e7"]');
      act(() => {
        dispatchPointer(mockElement!, 'pointerdown', { button: 2, buttons: 2 });
      });
      
      mockElement = container.querySelector('[data-square="e5"]');
      act(() => {
        dispatchPointer(boardContainer, 'pointermove');
      });
      act(() => {
        dispatchPointer(boardContainer, 'pointerup');
      });

      // Verify arrows exist and alternate colors
      await waitFor(() => {
        const lines = container.querySelectorAll('svg line');
        expect(lines.length).toBeGreaterThanOrEqual(2);
      });

      const lines = Array.from(container.querySelectorAll('svg line'));
      const lineColors = lines.map(line => line.getAttribute('stroke'));
      
      expect(lineColors).toContain('#ffffff');
      expect(lineColors).toContain('#1a1a1a');

    } finally {
      document.elementFromPoint = originalElementFromPoint;
      window.Element.prototype.setPointerCapture = originalSetPointerCapture;
      window.Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    }
  });

  it('supports sequential calculation line and spoiler mode toggling', async () => {
    const engine = {
      evaluate: vi.fn(async () => ({ cp: 0, depth: 14, pv: [] })),
      dispose: vi.fn(),
    } as unknown as UciEngine;
    const arrowAnalysisClients = makeArrowAnalysisClients();

    const { container, getByText } = render(
      <PlayMode
        engine={engine}
        engineReady
        cvsHealth={{ ok: true, available: true }}
        arrowAnalysisClients={arrowAnalysisClients}
      />
    );

    // Mock document.elementFromPoint and pointer capture APIs for jsdom
    let mockElement: Element | null = null;
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => mockElement;

    const originalSetPointerCapture = window.Element.prototype.setPointerCapture;
    const originalReleasePointerCapture = window.Element.prototype.releasePointerCapture;
    window.Element.prototype.setPointerCapture = vi.fn();
    window.Element.prototype.releasePointerCapture = vi.fn();

    try {
      const boardContainer = container.querySelector('[data-square="e2"]')!.parentElement!;

      // Helper to dispatch native pointer event via MouseEvent fallback for JSDOM
      const dispatchPointer = (target: Element, type: string, init: any = {}) => {
        const ev = new window.MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: init.button ?? 0,
          buttons: init.buttons ?? 0,
        });
        Object.defineProperty(ev, 'pointerId', { value: 1 });
        target.dispatchEvent(ev);
      };

      // 1. Draw e2 -> e4 (White arrow)
      mockElement = container.querySelector('[data-square="e2"]');
      act(() => {
        dispatchPointer(mockElement!, 'pointerdown', { button: 2, buttons: 2 });
      });
      
      mockElement = container.querySelector('[data-square="e4"]');
      act(() => {
        dispatchPointer(boardContainer, 'pointermove');
      });
      act(() => {
        dispatchPointer(boardContainer, 'pointerup');
      });

      // Verify variation card is rendered and in spoiler mode (shows "Reveal Engine Analysis")
      await waitFor(() => {
        expect(container.textContent).toContain('e4');
        expect(container.textContent).toContain('(player)');
      });
      const revealBtn = getByText('Reveal Engine Analysis');
      expect(revealBtn).toBeTruthy();
      expect(container.textContent).not.toContain('Engine Score');

      // Click "Reveal Engine Analysis"
      act(() => {
        revealBtn.click();
      });

      // Verify analysis is revealed
      await waitFor(() => {
        expect(container.textContent).toContain('Engine Score');
        expect(container.textContent).toContain('Hide Analysis');
      });

      // 2. Draw e7 -> e5 (Black arrow, legal on the board after e4)
      mockElement = container.querySelector('[data-square="e7"]');
      act(() => {
        dispatchPointer(mockElement!, 'pointerdown', { button: 2, buttons: 2 });
      });
      
      mockElement = container.querySelector('[data-square="e5"]');
      act(() => {
        dispatchPointer(boardContainer, 'pointermove');
      });
      act(() => {
        dispatchPointer(boardContainer, 'pointerup');
      });

      // Verify that e5 is appended in the same card (1. e4 e5) and spoiler mode resets
      await waitFor(() => {
        expect(container.textContent).toContain('e4');
        expect(container.textContent).toContain('e5');
        // Engine Analysis should be hidden again!
        expect(container.textContent).toContain('Reveal Engine Analysis');
        expect(container.textContent).not.toContain('Engine Score');
      });

    } finally {
      document.elementFromPoint = originalElementFromPoint;
      window.Element.prototype.setPointerCapture = originalSetPointerCapture;
      window.Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    }
  });

  it('supports hiding overlays via the hide overlays toggle', () => {
    const { container, getByText } = render(<PlayMode />);
    
    // initially, select e2 to draw selection/move overlays
    const e2 = container.querySelector('[data-square="e2"]')! as HTMLElement;
    fireEvent.click(e2);

    // expect e2 to have selection box shadow style (outline)
    expect(e2.style.boxShadow).toContain('inset 0 0 0 3px');
    
    // check that there are overlays/arrows drawn (e.g. svg line)
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(0);

    // toggle hide overlays checkbox
    const label = getByText('hide overlays');
    const toggle = label.closest('label')?.querySelector('input');
    expect(toggle).toBeTruthy();
    
    fireEvent.click(toggle!);

    // selection style should be gone
    expect(e2.style.boxShadow).toBe('');
    
    // base arrows (like defend/attack) should be hidden
    expect(container.querySelectorAll('svg line').length).toBe(0);

    // untoggle
    fireEvent.click(toggle!);
    expect(e2.style.boxShadow).toContain('inset 0 0 0 3px');
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(0);
  });
});
