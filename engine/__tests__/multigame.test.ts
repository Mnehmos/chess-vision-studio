import { describe, it, expect } from 'vitest';
import { gamesFromPgn, splitPgnGames } from '../position';

const TWO_GAMES = `[Event "Game 1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[Date "2026.01.01"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0

[Event "Game 2"]
[White "Carol"]
[Black "Dave"]
[Result "0-1"]

1. d4 d5 2. c4 e6 1-0`;

const SETUP_FEN = '2kr3r/ppp2Nbp/4p1p1/2q2n2/2B5/1P2R3/P5PP/R2Q3K w - - 0 1';

const FEN_ONLY = `[Event "?"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]
[SetUp "1"]
[FEN "${SETUP_FEN}"]
[Link "https://www.chess.com/analysis/game/pgn/5LBfKDrV7U/analysis"]

*`;

const FEN_WITH_MOVE = `[Event "?"]
[SetUp "1"]
[FEN "${SETUP_FEN}"]

1. Nxd8 *`;

describe('multi-game PGN', () => {
  it('splits a full export into individual games', () => {
    expect(splitPgnGames(TWO_GAMES)).toHaveLength(2);
  });

  it('parses every game with headers, plies, and a label', () => {
    const games = gamesFromPgn(TWO_GAMES);
    expect(games).toHaveLength(2);
    expect(games[0].headers.White).toBe('Alice');
    expect(games[0].plies.at(-1)?.san).toBe('Qxf7#');
    expect(games[0].label).toContain('Alice vs Bob');
    expect(games[1].headers.White).toBe('Carol');
    expect(games[1].plies).toHaveLength(4); // d4 d5 c4 e6
  });

  it('a single-game PGN yields one game', () => {
    const one = gamesFromPgn('[Event "x"]\n[White "W"]\n[Black "B"]\n\n1. e4 e5 *');
    expect(one).toHaveLength(1);
    expect(one[0].plies).toHaveLength(2);
  });

  it('keeps a From Position PGN that has a FEN but no moves', () => {
    const games = gamesFromPgn(FEN_ONLY);
    expect(games).toHaveLength(1);
    expect(games[0].initialFen).toBe(SETUP_FEN);
    expect(games[0].plies).toHaveLength(0);
  });

  it('replays From Position moves from the setup FEN', () => {
    const games = gamesFromPgn(FEN_WITH_MOVE);
    expect(games).toHaveLength(1);
    expect(games[0].plies[0].fenBefore).toBe(SETUP_FEN);
    expect(games[0].plies[0].san).toBe('Nxd8');
    expect(games[0].plies[0].from).toBe('f7');
    expect(games[0].plies[0].to).toBe('d8');
  });
});
