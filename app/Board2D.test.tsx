// @vitest-environment jsdom
// M7 UI render test — proves the React board actually RENDERS the tested LedMap
// (the headless led.ts already proves the colors are correct).
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Board2D } from './Board2D';
import { computeLedMap } from '../engine/led';

const G4_FEN = 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15';

afterEach(cleanup);

describe('Board2D', () => {
  it('renders all 64 squares with the active mode overlay', () => {
    const ledMap = computeLedMap('hanging', { fen: G4_FEN });
    const { container } = render(
      <Board2D fen={G4_FEN} ledMap={ledMap} onSelect={() => {}} />,
    );
    const cells = container.querySelectorAll('[data-square]');
    expect(cells).toHaveLength(64);
  });

  it('paints the loose g4 knight red in Hanging mode (UI reflects the engine)', () => {
    const ledMap = computeLedMap('hanging', { fen: G4_FEN });
    const { container } = render(
      <Board2D fen={G4_FEN} ledMap={ledMap} onSelect={() => {}} />,
    );
    const g4 = container.querySelector('[data-square="g4"]')!;
    expect(g4.getAttribute('data-led')).toBe('red');
    expect(g4.getAttribute('data-piece')).toBe('bN'); // the black knight is rendered there
  });

  it('places the white queen glyph on d1 and the king on g8', () => {
    const ledMap = computeLedMap('hanging', { fen: G4_FEN });
    const { container } = render(
      <Board2D fen={G4_FEN} ledMap={ledMap} onSelect={() => {}} />,
    );
    expect(container.querySelector('[data-square="d1"]')!.getAttribute('data-piece')).toBe('wQ');
    expect(container.querySelector('[data-square="g8"]')!.getAttribute('data-piece')).toBe('bK');
  });

  it('renders annotation arrows as an SVG overlay (defender/attacker/threat)', () => {
    const ledMap = computeLedMap('hanging', { fen: G4_FEN });
    const { container } = render(
      <Board2D
        fen={G4_FEN}
        ledMap={ledMap}
        onSelect={() => {}}
        arrows={[
          { from: 'd1', to: 'g4', color: '#c53030' }, // wQ attacks g4
          { from: 'e3', to: 'd4', color: '#2f855a' }, // a defender
          { from: 'd1', to: 'g4', color: '#2b6cb0', label: '1' }, // numbered threat
        ]}
      />,
    );
    const lines = container.querySelectorAll('svg line');
    expect(lines.length).toBe(3);
    // the numbered threat arrow renders its sequence label
    expect(container.querySelector('svg text')?.textContent).toBe('1');
  });
});
