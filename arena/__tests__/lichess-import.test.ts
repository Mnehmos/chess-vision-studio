import { describe, it, expect } from 'vitest';
import { parseImportGame, shouldImportGame, type ImportConfig } from '../lichess/import-db';

const CFG: ImportConfig = {
  input: '-',
  out: 'arena/out/test.jsonl',
  depth: 1,
  limit: 1,
  maxPlies: 20,
  minElo: 2200,
  sampleEvery: 1,
};

const PGN = `[Event "Rated Blitz game"]
[Site "https://lichess.org/test"]
[White "StrongWhite"]
[Black "StrongBlack"]
[Result "1-0"]
[WhiteElo "2450"]
[BlackElo "2500"]
[Variant "Standard"]

1. e4 e5 2. Nf3 Nc6 1-0`;

describe('Lichess open-database importer', () => {
  it('turns a PGN game into arena PlayedPly rows', () => {
    const game = parseImportGame(PGN);
    expect(game).not.toBeNull();
    expect(game?.plies).toHaveLength(4);
    expect(game?.plies[0]).toMatchObject({
      by: 'white',
      player: 'StrongWhite',
      san: 'e4',
      uci: 'e2e4',
    });
    expect(game?.plies[1]).toMatchObject({
      by: 'black',
      player: 'StrongBlack',
      san: 'e5',
      uci: 'e7e5',
    });
  });

  it('filters for standard games above the Elo floor', () => {
    const game = parseImportGame(PGN);
    expect(game && shouldImportGame(game, CFG)).toBe(true);
    expect(game && shouldImportGame(game, { ...CFG, minElo: 2600 })).toBe(false);
    if (game) {
      expect(shouldImportGame({ ...game, headers: { ...game.headers, Variant: 'Chess960' } }, CFG)).toBe(false);
    }
  });
});
