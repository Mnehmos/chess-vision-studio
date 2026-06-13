import { describe, expect, it } from 'vitest';
import { plyRecordToUci, sanLineToUci, sanMoveToUci } from './uci-line';

describe('SAN to UCI adapters', () => {
  it('converts a move and a replayed line from the exact source FEN', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(sanMoveToUci(start, 'e4')).toBe('e2e4');
    expect(sanLineToUci(start, ['e4', 'e5', 'Nf3'])).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('stops at the first illegal SAN move instead of guessing', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(sanLineToUci(start, ['e4', 'not-a-move', 'Nf3'])).toEqual(['e2e4']);
  });

  it('preserves promotion suffixes and reports a bad PlyRecord explicitly', () => {
    const promotionFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    expect(sanMoveToUci(promotionFen, 'a8=Q+')).toBe('a7a8q');
    expect(() =>
      plyRecordToUci({
        ply: 1,
        moveNumber: 1,
        san: 'Qa9',
        color: 'w',
        from: 'a1',
        to: 'a9',
        fenBefore: promotionFen,
        fenAfter: promotionFen,
      }),
    ).toThrow(/move_conversion_failed/);
  });
});
