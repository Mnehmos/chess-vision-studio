import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPENING_BOOK, nextBookLine, bookMove } from '../book';
import { uciToMove } from '../../players';

describe('opening book', () => {
  it('every line is fully legal from the start position', () => {
    for (const line of OPENING_BOOK) {
      const chess = new Chess();
      for (const uci of line.moves) {
        const moved = chess.move(uciToMove(uci));
        expect(moved, `${line.name}: illegal move ${uci}`).toBeTruthy();
      }
      expect(line.moves.length, line.name).toBeGreaterThanOrEqual(6); // a real opening, not a stub
    }
  });

  it('bookMove follows the line while on-book, and stops once it diverges or ends', () => {
    const line = ['e2e4', 'e7e5', 'g1f3'];
    expect(bookMove(line, [])).toBe('e2e4');
    expect(bookMove(line, ['e2e4'])).toBe('e7e5');
    expect(bookMove(line, ['e2e4', 'e7e5'])).toBe('g1f3');
    expect(bookMove(line, ['e2e4', 'e7e5', 'g1f3'])).toBeNull(); // exhausted
    expect(bookMove(line, ['e2e4', 'c7c5'])).toBeNull(); // opponent left book
    expect(bookMove(line, ['d2d4'])).toBeNull(); // diverged at move 1
  });

  it('nextBookLine rotates round-robin (start-offset agnostic)', () => {
    const book = [
      { name: 'A', moves: ['e2e4'] },
      { name: 'B', moves: ['d2d4'] },
      { name: 'C', moves: ['c2c4'] },
    ];
    const seen = [nextBookLine(book), nextBookLine(book), nextBookLine(book), nextBookLine(book)].map((l) => l.name);
    expect(new Set(seen.slice(0, 3)).size).toBe(3); // three consecutive picks cover all three
    expect(seen[3]).toBe(seen[0]); // and the fourth wraps back to the first
  });
});
