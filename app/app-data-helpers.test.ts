import { describe, expect, it } from 'vitest';
import { gamesFromPgn } from '../engine/position';
import { gameCacheKey, safePlyUci } from './app-data-helpers';

describe('app data helpers', () => {
  it('builds a stable game cache key from identity and position boundaries', () => {
    const game = gamesFromPgn(`
[White "Alpha"]
[Black "Beta"]
[Result "1-0"]
[Date "2026.06.18"]

1. e4 e5 2. Nf3 1-0
`)[0];

    const key = gameCacheKey(game);
    expect(key).toContain('Alpha|Beta|1-0|2026.06.18|3|');
    expect(gameCacheKey(game)).toBe(key);
    expect(gameCacheKey(undefined)).toBe('no-game');
  });

  it('converts valid ply records to UCI and tolerates missing plies', () => {
    const game = gamesFromPgn('1. e4 e5 *')[0];

    expect(safePlyUci(game.plies[0])).toBe('e2e4');
    expect(safePlyUci(game.plies[1])).toBe('e7e5');
    expect(safePlyUci(undefined)).toBeUndefined();
  });
});
