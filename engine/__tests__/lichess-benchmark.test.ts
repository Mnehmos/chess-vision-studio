// Lichess puzzle benchmark — perfect-information backtest of the Tier-1 engine.
// Default: the curated seed (CI smoke test). Full DB:
//   PUZZLE_CSV=path/to/lichess_db_puzzle.csv PUZZLE_LIMIT=2000 \
//     npx vitest run engine/__tests__/lichess-benchmark.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runBenchmark, formatReport, parsePuzzleCsv, type Puzzle } from '../benchmark/puzzles';
import { SEED_PUZZLES } from '../benchmark/seed';

const csvPath = process.env.PUZZLE_CSV;
const limit = process.env.PUZZLE_LIMIT ? parseInt(process.env.PUZZLE_LIMIT, 10) : 5000;

describe('Lichess benchmark', () => {
  if (csvPath) {
    it(`scores the real DB (${csvPath}, limit ${limit})`, () => {
      const puzzles: Puzzle[] = parsePuzzleCsv(readFileSync(csvPath, 'utf8'), limit);
      const rep = runBenchmark(puzzles);
      console.log('\n' + formatReport(rep));
      // On real data, hold a floor on the themes we claim to cover so a
      // regression in detection fails CI rather than passing silently.
      if (rep.covered > 0) {
        const rate = rep.detectedOnCovered / rep.covered;
        expect(rate).toBeGreaterThan(0.6);
      }
    }, 600000);
  } else {
    it('seed: every covered Tier-1 tactic is detected and correctly labelled', () => {
      const rep = runBenchmark(SEED_PUZZLES);
      console.log('\n' + formatReport(rep));
      expect(rep.covered).toBe(5); // the 5 validated tactics
      expect(rep.detectedOnCovered).toBe(5); // 100% detection on covered
      expect(rep.labelMatchOnCovered).toBe(5); // 100% correct labels
    });

    it('seed: a real out-of-scope puzzle (mateIn4) is an HONEST miss, not a false claim', () => {
      const rep = runBenchmark(SEED_PUZZLES);
      const daily = rep.results.find((r) => r.id === 'npYRr')!;
      expect(daily.covered).toBe(false); // outside Tier-1
      // We must NOT claim to have solved it as a Tier-1 tactic.
      expect(daily.detected).toBe(false);
    });

    it('the CSV adapter parses the official Lichess format (apply Moves[0] then solve)', () => {
      // PuzzleId,FEN,Moves,Rating,RD,Pop,Plays,Themes,GameUrl,OpeningTags
      const row =
        '00sHx,q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17,e8d7 a2e6 d7d8 f7f8,1760,80,83,72,mateIn2 short,https://x,';
      const [p] = parsePuzzleCsv(row);
      expect(p.id).toBe('00sHx');
      // FEN was Black-to-move; after the setup e8d7 it is White to move solving.
      expect(p.fen.split(' ')[1]).toBe('w');
      expect(p.solution[0]).toBe('a2e6');
      expect(p.themes).toContain('mateIn2');
    });
  }
});
