import { describe, it, expect } from 'vitest';
import { gamesFromPgn } from '../position';
import { computeDataset, detectHero } from '../dataset';

// Hero plays 3 games: White win, Black loss, White draw.
const PGN = `[Event "1"]
[White "Hero"]
[Black "Opp1"]
[Result "1-0"]
[Date "2026.01.01"]
[Opening "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "2"]
[White "Opp2"]
[Black "Hero"]
[Result "1-0"]
[Date "2026.01.05"]
[Opening "Sicilian Defense"]

1. e4 c5 *

[Event "3"]
[White "Hero"]
[Black "Opp3"]
[Result "1/2-1/2"]
[Date "2026.01.03"]
[Opening "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *`;

describe('dataset aggregation', () => {
  const games = gamesFromPgn(PGN);
  const ds = computeDataset(games);

  it('detects the recurring player as hero', () => {
    expect(detectHero(games)).toBe('Hero');
    expect(ds.hero).toBe('Hero');
  });

  it('builds the hero record across colors', () => {
    // White win + Black loss + White draw -> 1 win, 1 draw, 1 loss
    expect(ds.heroRecord.wins).toBe(1);
    expect(ds.heroRecord.draws).toBe(1);
    expect(ds.heroRecord.losses).toBe(1);
    expect(ds.heroRecord.scorePct).toBeCloseTo(50, 5); // 1.5 / 3
    expect(ds.asWhite.games).toBe(2);
    expect(ds.asBlack.losses).toBe(1);
  });

  it('groups openings from the hero perspective', () => {
    const italian = ds.openings.find((o) => o.name.includes('Italian'));
    expect(italian?.games).toBe(2); // games 1 and 3
    expect(italian?.wins).toBe(1);
    expect(italian?.draws).toBe(1);
  });

  it('orders the timeline by date and cumulates score', () => {
    // chronological: 01-01 (win, +1) -> 01-03 (draw, +0.5) -> 01-05 (loss, +0)
    expect(ds.timeline.map((t) => t.cumulative)).toEqual([1, 1.5, 1.5]);
  });

  it('counts overall results too', () => {
    expect(ds.byResult.whiteWins).toBe(2); // games 1 and 2 are 1-0
    expect(ds.byResult.draws).toBe(1);
  });
});
