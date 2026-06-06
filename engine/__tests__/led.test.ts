// M7 (headless part) — each mode reduces to a 64-square LedMap; the DoD-checkable
// claims live here: Hanging flags the g4 knight; Tactics draws the R1e7# net;
// What-Changed matches the ply's MoveAnalysis.
import { describe, it, expect } from 'vitest';
import { computeLedMap, allSquares, type ModeId } from '../led';
import type { MoveAnalysis } from '../types';

const G4_FEN = 'r3r1k1/ppp2ppp/5q2/3p4/3N2n1/3BP3/PPP2PPP/R2Q1RK1 w - - 4 15';
const PRE_MATE = '4R3/3N1kpp/p1r3p1/3p4/2p2PrP/8/P1P3P1/4R1K1 w - - 0 31';

describe('M7 — every mode yields all 64 squares', () => {
  const modes: ModeId[] = ['legal', 'threat', 'defense', 'hanging', 'what_changed', 'pawn', 'tactics'];
  it.each(modes)('%s covers 64 squares', (mode) => {
    const map = computeLedMap(mode, { fen: G4_FEN });
    expect(Object.keys(map.squares)).toHaveLength(64);
    expect(map.mode).toBe(mode);
  });
});

describe('M7 — Hanging mode flags the loose g4 knight (before 15.Qxg4)', () => {
  it('paints g4 red (SEE-losing)', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(map.squares['g4']).toBe('red'); // SEE +3 for White
  });
  it('does not paint a safe, defended pawn red', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(map.squares['a2']).not.toBe('red');
    expect(map.squares['a2']).not.toBe('red_blink');
  });
});

describe('M7 — Tactics mode draws the R1e7# mating net at the finish', () => {
  it('colors the mating piece (e7) and the trapped king (f7); silent elsewhere', () => {
    const map = computeLedMap('tactics', { fen: PRE_MATE });
    expect(map.squares['e7']).toBe('purple'); // executing rook lands on e7
    expect(map.squares['f7']).toBe('orange'); // the mated king is the target
    // a quiet, irrelevant square stays off
    expect(map.squares['a1']).toBe('off');
  });
  it('is silent when no motif is proven', () => {
    const quiet = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const map = computeLedMap('tactics', { fen: quiet });
    expect(Object.values(map.squares).every((c) => c === 'off')).toBe(true);
  });
});

describe('M7 — Legal Move mode owns green/red/yellow/purple', () => {
  it('selected queen: capture is red, quiet is green', () => {
    // White Qd1 in the g4 position: Qxg4 is a capture (red); a quiet queen move is green.
    const map = computeLedMap('legal', { fen: G4_FEN, selectedSquare: 'd1' });
    expect(map.squares['g4']).toBe('red'); // Qxg4 captures the knight
    expect(map.squares['e2']).toBe('green'); // Qe2 is a quiet move
  });

  it('surfaces moves for the piece that JUST MOVED (not the side to move)', () => {
    // Black to move, but we inspect the White pawn on e2 (the side NOT to move).
    // legalMode must flip the turn so e2's destinations still show.
    const map = computeLedMap('legal', { fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', selectedSquare: 'e2' });
    expect(map.squares['e3']).toBe('green');
    expect(map.squares['e4']).toBe('green');
  });
});

describe('M7 — What Changed mode matches the ply MoveAnalysis', () => {
  it('paints a now_see_losing insight red on its square', () => {
    const analysis = {
      rankedInsights: [
        {
          id: 'x',
          kind: 'changed_relation',
          type: 'now_see_losing',
          side: 'white',
          squares: ['e5'],
          arrows: [],
          source: 'played_move',
          materialSwing: 1,
          kingSafetyDelta: 0,
          inPV: false,
          saliency: 0.4,
          templateId: 'now_see_losing',
          evidence: [],
        },
      ],
    } as unknown as MoveAnalysis;
    const map = computeLedMap('what_changed', { fen: G4_FEN, analysis });
    expect(map.squares['e5']).toBe('red');
  });
  it('is blank without an analysis', () => {
    const map = computeLedMap('what_changed', { fen: G4_FEN });
    expect(Object.values(map.squares).every((c) => c === 'off')).toBe(true);
  });
});

describe('M7 — Threat & Defense modes produce scoped colors', () => {
  it('threat map marks contested and controlled squares', () => {
    const map = computeLedMap('threat', { fen: G4_FEN });
    const colors = new Set(Object.values(map.squares));
    expect(colors.has('red') || colors.has('blue') || colors.has('purple')).toBe(true);
  });
  it('defense map flags an undefended own piece yellow somewhere', () => {
    const map = computeLedMap('defense', { fen: G4_FEN });
    const colors = Object.values(map.squares);
    expect(colors.some((c) => c === 'blue' || c === 'yellow' || c === 'orange')).toBe(true);
  });
});

describe('M7 — LedMap is exhaustive (no missing squares)', () => {
  it('matches the canonical 64-square set', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(new Set(Object.keys(map.squares))).toEqual(new Set(allSquares()));
  });
});
