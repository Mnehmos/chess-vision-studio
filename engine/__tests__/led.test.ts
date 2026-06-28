// M7 (headless part) — each mode reduces to a 64-square LedMap; the DoD-checkable
// claims live here: Hanging flags the g4 knight; Tactics draws the R1e7# net;
// What-Changed matches the ply's MoveAnalysis.
import { describe, it, expect } from 'vitest';
import { computeLedMap, allSquares, type ModeId } from '../led';
import { parseFen } from '../board';
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
  it('paints g4 blue — White wins the exchange (SEE +3 for White)', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(map.squares['g4']).toBe('blue'); // White is winning the exchange → blue
  });
  it('does not paint a safe, defended pawn red', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(map.squares['a2']).not.toBe('red');
    expect(map.squares['a2']).not.toBe('red_blink');
  });
  it('attaches a SEE / ratio badge to a flagged piece', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(map.badges?.['g4']).toBeTruthy(); // "+3" SEE swing on the losing knight
  });
  it('flags an EMPTY break-in square with the points won if the opponent contests (Qxh7# geometry)', () => {
    // N g5 + B d3 (value 3) and Q h5 hit h7; only Kg8 (capped to 9) guards it.
    // White contests with the cheaper piece (3 < 9) → White controls → blue, and
    // wins Black's cheapest committed piece (the king, capped 9) → "+9".
    const mate = 'r1bq1rk1/pppn1pp1/4p3/6NQ/3P4/3B1R2/PPP3PP/4R1K1 w - - 0 1';
    const map = computeLedMap('hanging', { fen: mate });
    expect(map.squares['h7']).toBe('blue'); // White's cheaper attacker controls it
    expect(map.badges?.['h7']).toBe('+9'); // points won if Black contests
  });
  it('badges a piece by MATERIAL points, not piece count — queen for a knight is +6, not "1v1"', () => {
    // Black Qd5 attacked once (Nf4) and defended once (Nf6): "1 vs 1" by count,
    // but White wins a queen for a knight → SEE +6, coloured blue (White wins).
    const fen = 'k7/8/5n2/3q4/5N2/8/8/K7 w - - 0 1';
    const map = computeLedMap('hanging', { fen });
    expect(map.squares['d5']).toBe('blue'); // White is winning the exchange
    expect(map.badges?.['d5']).toBe('+6'); // material points, never "1v1"
  });
  it('shows a true standoff (equal cheapest value AND count) as purple with no winner', () => {
    // Pd3 (White) and Pf5 (Black) both hit e4: pawn vs pawn, neither invests less.
    const fen = 'k7/8/8/5p2/8/3P4/8/K7 w - - 0 1';
    const map = computeLedMap('hanging', { fen });
    expect(map.squares['e4']).toBe('purple'); // contested standoff stays shown
    expect(map.badges?.['e4']).toBe('0'); // neutral eval gets an explicit 0 indicator
  });
  it('focused view = pieces only: keeps the hanging piece, drops empty-square analysis', () => {
    // g4 (black knight, occupied) is a piece signal; the board also has empty
    // contested squares in the full view. Focused keeps the piece, hides the rest.
    const full = computeLedMap('hanging', { fen: G4_FEN, seeDetail: 'full' });
    const focused = computeLedMap('hanging', { fen: G4_FEN, seeDetail: 'focused' });
    expect(focused.squares['g4']).toBe(full.squares['g4']); // occupied piece kept
    expect(focused.squares['g4']).not.toBe('off');
    // every still-lit square in focused must be occupied (no empty-square rings)
    for (const [sq, color] of Object.entries(focused.squares)) {
      if (color === 'off') continue;
      const [f, r] = [sq.charCodeAt(0) - 97, sq.charCodeAt(1) - 49];
      expect(parseFen(G4_FEN).grid[f][r]).toBeTruthy();
    }
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

describe('M7 — Threat & Defense modes show BOTH sides with per-side schemes', () => {
  it('threat map: White=blue, Black=red, contested=purple, graduated by attacker count', () => {
    const map = computeLedMap('threat', { fen: G4_FEN });
    const colors = new Set(Object.values(map.squares));
    expect(colors.has('blue')).toBe(true); // White controls
    expect(colors.has('red')).toBe(true); // Black controls
    expect(colors.has('purple')).toBe(true); // contested
    // King-zone squares are no longer singled out — control heat carries it.
    expect(colors.has('dark_blue') || colors.has('dark_red')).toBe(false);
    // Intensity is populated for every tinted square (≥1 attacker) and absent for empty ones.
    expect(map.intensity).toBeDefined();
    for (const [sq, color] of Object.entries(map.squares)) {
      if (color === 'off') expect(map.intensity![sq]).toBeUndefined();
      else expect(map.intensity![sq]).toBeGreaterThanOrEqual(1);
    }
  });
  it('defense map: White=blue/yellow, Black=green/orange', () => {
    const map = computeLedMap('defense', { fen: G4_FEN });
    expect(map.squares['d4']).toBe('blue'); // White knight, defended (e3 pawn)
    expect(map.squares['g4']).toBe('orange'); // Black knight, loose (no defender)
    expect(map.squares['f6']).toBe('green'); // Black queen, defended (g7 pawn)
  });
});

describe('M7 — LedMap is exhaustive (no missing squares)', () => {
  it('matches the canonical 64-square set', () => {
    const map = computeLedMap('hanging', { fen: G4_FEN });
    expect(new Set(Object.keys(map.squares))).toEqual(new Set(allSquares()));
  });
});
