import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENGINE_COMPARISON_BUDGET,
  normalizeEngineScore,
  normalizedScoreFromSideToMove,
  rootSideFromFen,
  searchBudgetToRequestFields,
} from '../index';

const FEN_W = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_B = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

describe('normalizeEngineScore — perspective conversion (plan §4.3, §6 PR-02)', () => {
  it('White to move, raw +72 → White +72', () => {
    const s = normalizeEngineScore({ rawCp: 72, rawMate: null, rawPov: 'side_to_move', rootSide: 'white' });
    expect(s.whiteCp).toBe(72);
    expect(s.whiteMate).toBeNull();
  });

  it('Black to move, raw +72 → White -72', () => {
    const s = normalizeEngineScore({ rawCp: 72, rawMate: null, rawPov: 'side_to_move', rootSide: 'black' });
    expect(s.whiteCp).toBe(-72);
  });

  it('White to move, raw mate +3 → White mate +3', () => {
    const s = normalizeEngineScore({ rawCp: null, rawMate: 3, rawPov: 'side_to_move', rootSide: 'white' });
    expect(s.whiteMate).toBe(3);
  });

  it('Black to move, raw mate +3 → White mate -3', () => {
    const s = normalizeEngineScore({ rawCp: null, rawMate: 3, rawPov: 'side_to_move', rootSide: 'black' });
    expect(s.whiteMate).toBe(-3);
  });

  it('terminal score stays terminal (null, not zero)', () => {
    const s = normalizeEngineScore({ rawCp: null, rawMate: null, rawPov: 'side_to_move', rootSide: 'white' });
    expect(s.whiteCp).toBeNull();
    expect(s.whiteMate).toBeNull();
  });

  it('explicit white/black perspectives convert correctly', () => {
    expect(normalizeEngineScore({ rawCp: 50, rawMate: null, rawPov: 'white', rootSide: 'black' }).whiteCp).toBe(50);
    expect(normalizeEngineScore({ rawCp: 50, rawMate: null, rawPov: 'black', rootSide: 'white' }).whiteCp).toBe(-50);
  });

  it('retains raw values and perspective for diagnostics', () => {
    const s = normalizeEngineScore({ rawCp: 72, rawMate: null, rawPov: 'side_to_move', rootSide: 'black' });
    expect(s.rawCp).toBe(72);
    expect(s.rawPov).toBe('side_to_move');
    expect(s.rootSide).toBe('black');
  });
});

describe('rootSideFromFen / normalizedScoreFromSideToMove', () => {
  it('reads side to move from the FEN', () => {
    expect(rootSideFromFen(FEN_W)).toBe('white');
    expect(rootSideFromFen(FEN_B)).toBe('black');
  });
  it('normalizes a side-to-move result using the FEN', () => {
    expect(normalizedScoreFromSideToMove({ fen: FEN_B, cp: 72 }).whiteCp).toBe(-72);
    expect(normalizedScoreFromSideToMove({ fen: FEN_W, cp: 72 }).whiteCp).toBe(72);
  });
});

describe('SearchBudget serialization (both clients use this)', () => {
  it('movetime budget serializes movetimeMs', () => {
    expect(searchBudgetToRequestFields({ kind: 'movetime', milliseconds: 1000 })).toEqual({
      movetimeMs: 1000,
    });
  });
  it('depth budget serializes depth', () => {
    expect(searchBudgetToRequestFields({ kind: 'depth', depth: 14 })).toEqual({ depth: 14 });
  });
  it('legacy depth fallback is still supported', () => {
    expect(searchBudgetToRequestFields(undefined, 12)).toEqual({ depth: 12 });
  });
  it('nodes budget (unsupported on the wire) falls back to depth', () => {
    expect(searchBudgetToRequestFields({ kind: 'nodes', nodes: 100000 }, 10)).toEqual({ depth: 10 });
  });
  it('DEFAULT_ENGINE_COMPARISON_BUDGET is 1000ms movetime', () => {
    expect(DEFAULT_ENGINE_COMPARISON_BUDGET).toEqual({ kind: 'movetime', milliseconds: 1000 });
  });
});
