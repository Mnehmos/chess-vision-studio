# Lichess Puzzle Benchmark

A **perfect-information backtest** for the perception engine. Every Lichess
puzzle ships its solution line *and* curated theme tags (`fork`, `pin`, `skewer`,
`backRankMate`, `hangingPiece`, `discoveredAttack`, …), so we can score the
engine objectively:

1. **Detection** — did we surface the solution's key move as a *validated* tactic?
2. **Labelling** — does our motif type match the puzzle's theme?

Themes outside Tier-1 (deep mates, Tier-2 motifs like deflection/sacrifice) are
reported as **honest misses**, never silently dropped — see `COVERED_THEMES`.

## Run the seed (CI smoke test)

```bash
npm run benchmark
```

Five validated Tier-1 tactics + one real out-of-scope Lichess puzzle. Asserts
100% detection/labelling on the covered set and that the out-of-scope puzzle is
an honest miss.

## Run the full Lichess database

1. Download + decompress the puzzle DB (~5M puzzles):

   ```bash
   curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
   zstd -d lichess_db_puzzle.csv.zst
   ```

2. Score a slice (prints a per-theme report; floors detection on covered themes):

   ```bash
   PUZZLE_CSV=lichess_db_puzzle.csv PUZZLE_LIMIT=5000 npm run benchmark
   ```

The CSV adapter follows the official format (`PuzzleId,FEN,Moves,Rating,…,Themes,…`):
the FEN is the position *before* the opponent's setup move, so the solver
position is `apply(Moves[0])` and the solution is `Moves[1..]`.

## What "covered" means today (Tier-1)

| Lichess theme | Engine detector |
|---|---|
| `fork` | `findForks` (enumeration-validated, handles poisoned defenders) |
| `mateIn1` / `mate` | `findMatesIn1` (chess.js `isCheckmate`) |
| `backRankMate` | `findMatesIn1` + back-rank signature |
| `hangingPiece` | SEE on the key capture |
| `pin` / `skewer` / `discoveredAttack` | detected as board state (Tactics mode), not yet as move-solvers |

Deeper mates (`mateIn2+`) and Tier-2 motifs (`deflection`, `sacrifice`,
`attraction`, `interference`, `zwischenzug`) are **expected misses** until the
engine-PV / Tier-2 work (M8). The report makes that explicit.
