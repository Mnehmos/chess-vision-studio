import { describe, it, expect } from 'vitest';
import { gamesFromPgn } from '../position';
import { buildOpeningTree, movesFrom, normFen } from '../repertoire';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Three games sharing 1.e4; two continue ...e5, one plays ...c5. Results vary.
const PGN = `[Event "A"]
[White "Hero"]
[Black "X"]
[Result "1-0"]

1. e4 e5 2. Nf3 *

[Event "B"]
[White "Hero"]
[Black "Y"]
[Result "0-1"]

1. e4 e5 2. Bc4 *

[Event "C"]
[White "Hero"]
[Black "Z"]
[Result "1/2-1/2"]

1. e4 c5 *`;

describe('opening tree', () => {
  const games = gamesFromPgn(PGN);
  const tree = buildOpeningTree(games);

  it('normalizes FEN to placement+side+castling+ep (drops clocks)', () => {
    expect(normFen(START)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });

  it('tallies first-move choices across all games', () => {
    const opening = movesFrom(tree, START);
    expect(opening).toHaveLength(1); // all three play e4
    expect(opening[0].san).toBe('e4');
    expect(opening[0].games).toBe(3);
    expect(opening[0].whiteWins).toBe(1);
    expect(opening[0].blackWins).toBe(1);
    expect(opening[0].draws).toBe(1);
  });

  it('splits replies and sorts by frequency', () => {
    const afterE4 = movesFrom(tree, tree.byPosition.has(normFen(START)) ? games[0].plies[0].fenAfter : START);
    expect(afterE4.map((m) => m.san)).toEqual(['e5', 'c5']); // e5 (2 games) before c5 (1)
    expect(afterE4[0].games).toBe(2);
    expect(afterE4[1].games).toBe(1);
  });

  it('respects the maxPlies cap', () => {
    const shallow = buildOpeningTree(games, { maxPlies: 1 });
    expect(movesFrom(shallow, games[0].plies[0].fenAfter)).toHaveLength(0); // never recorded ply 2
  });
});
