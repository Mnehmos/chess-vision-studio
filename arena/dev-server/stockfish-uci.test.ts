import { describe, expect, it } from 'vitest';
import { parseStockfishBestMove, parseStockfishInfoLine } from './stockfish-uci';

describe('Stockfish UCI parsing helpers', () => {
  it('parses centipawn info lines with depth and PV', () => {
    expect(
      parseStockfishInfoLine('info depth 17 seldepth 20 score cp -34 nodes 1000 pv e2e4 e7e5 g1f3'),
    ).toEqual({
      depth: 17,
      scoreCp: -34,
      mate: null,
      pv: ['e2e4', 'e7e5', 'g1f3'],
    });
  });

  it('parses mate info lines', () => {
    expect(parseStockfishInfoLine('info depth 9 score mate -2 pv h7h8q h1h8')).toEqual({
      depth: 9,
      scoreCp: 0,
      mate: -2,
      pv: ['h7h8q', 'h1h8'],
    });
  });

  it('ignores non-search-info lines', () => {
    expect(parseStockfishInfoLine('readyok')).toBeNull();
    expect(parseStockfishInfoLine('info depth 3 nodes 100')).toBeNull();
  });

  it('parses bestmove lines', () => {
    expect(parseStockfishBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
    expect(parseStockfishBestMove('info string hello')).toBeNull();
  });
});
