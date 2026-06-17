import { describe, expect, it } from 'vitest';
import { isHumanTurn, moveHistoryRows, playStatus, sideToMove } from './play-mode-state';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const FOOLS_MATE = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const STALEMATE = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
const INSUFFICIENT = '8/8/8/8/8/8/8/K6k w - - 0 1';

describe('play mode state helpers', () => {
  it('derives active game status from FEN', () => {
    expect(playStatus(START_FEN)).toEqual({
      text: 'White to move',
      over: false,
      tone: 'var(--text)',
    });
  });

  it('derives terminal game status from FEN', () => {
    expect(playStatus(FOOLS_MATE)).toEqual({
      text: 'Checkmate \u2014 Black wins',
      over: true,
      tone: 'var(--bad)',
    });
    expect(playStatus(STALEMATE)).toMatchObject({ text: 'Stalemate \u2014 draw', over: true });
    expect(playStatus(INSUFFICIENT)).toMatchObject({ text: 'Draw \u2014 insufficient material', over: true });
  });

  it('derives side ownership for hot-seat and engine games', () => {
    expect(sideToMove(START_FEN)).toBe('w');
    expect(isHumanTurn(AFTER_E4, 'none', 'w')).toBe(true);
    expect(isHumanTurn(AFTER_E4, 'stockfish', 'w')).toBe(false);
    expect(isHumanTurn(AFTER_E4, 'cvs', 'b')).toBe(true);
  });

  it('groups SAN history into move-number rows', () => {
    expect(moveHistoryRows([{ san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }])).toEqual([
      { n: 1, white: 'e4', black: 'e5' },
      { n: 2, white: 'Nf3', black: undefined },
    ]);
  });
});
