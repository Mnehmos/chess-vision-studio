# CVS Gauntlet Report — run 20260609-1313 (smoke)

**Engine:** CVS-Rust (`cvs-bitboard-core` @ 5dc5fe7), depth 5, trained mixed
base+Rung-2 weights · **Result: 56W–4D–0L across 60 games (no losses).**

## Run config

- 20 games per opponent vs SF-{800, 1000, 1200}; balanced format (each opening
  played once as White, once as Black; `balanced_openings.epd`, 12 openings).
- Opponent limiter: labels < 1320 can't use UCI_Elo (SF16 floor), so **Skill
  Level** with the approximate community mapping — 800→0, 1000→2, 1200→4 —
  at `go movetime 80`. **These labels are nominal, not SF-calibrated.** Exact
  settings recorded in `run_config.json`. One SF process serves the whole ladder
  (single-instance WASM); strength reconfigured between rungs.
- Scorer: Stockfish depth 10 (shared persisted cache); 1,993 CVS moves scored.

## Elo ladder

| Opponent | Mechanism | W | D | L | Score | Elo diff | Est. CVS Elo | Avg cpLoss | Median | Blunder % | Mate missed | Illegal | Avg ms/move |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SF-800 | Skill 0 | 19 | 1 | 0 | 97.5% | +636 | **≥1436** | 0.475 | 0.04 | 0.7% | 2 | 0 | 194 |
| SF-1000 | Skill 2 | 20 | 0 | 0 | 100% | +636 | **≥1636** | 0.365 | 0.04 | 0.9% | 1 | 0 | 160 |
| SF-1200 | Skill 4 | 17 | 3 | 0 | 92.5% | +436 | **≥1636** | 0.587 | 0.04 | 2.2% | 2 | 0 | 163 |

**Elo caveat:** with zero losses the score clamps (±half-game), so these are
**lower bounds** — CVS's true ladder strength is unmeasured upward. The 4 draws
were max-ply adjudications/draw rules, not outplayed positions.

## Move quality (corrected scorer)

- 1,993 CVS moves: median cpLoss **0.04 pawns**; ~94% classified best/excellent/
  good; **illegal = 0** across the run.
- Scorer fix included in this run: a delivered checkmate is `best` (Stockfish
  cannot evaluate a mated after-position; the naive path had misclassified all
  56 mating moves as 99-pawn `mate_missed`).

## Top failures (all in already-won positions)

| Game | cpLoss | Class | What happened |
|---|---:|---|---|
| sf1000-g11 ply37 | 82.4 | mate_missed | had M4 (SF), played c2e3 — still winning, lost the *forced* line |
| sf1200-g07 ply73 | 81.9 | mate_missed + search_horizon | h8h1 with M4 available; deeper Rust probe (d7) improves → horizon |
| sf800-g05 ply29 | 81.6 | mate_missed | h4f2 instead of Nxf2+ (M4) |
| sf800-g13 ply49 | 74.5 | mate_missed + quiet_refutation | c1c2 instead of Rc2+ (M6); d7 improves |
| sf1200-g04 ply104 | 53.0 | mate_missed | e6e7 instead of e7 promo line (M8) |
| sf1200-g18 ply96 | 32.7 | blunder/endgame_conversion | +39-pawn endgame dithering (e7c5 vs g4) |

**Every failure ≥ 1 pawn occurred at SF-eval ≥ +M or ≈+39 pawns for CVS — zero
game-relevant errors in competitive positions.** The "mate_missed" class here
means *slow mate* (kept a winning eval but dropped the d10-forced line — a
depth-5 horizon effect), not a lost win: all five games were won anyway.

## RSI candidates

116 rows → `rsi_candidates.jsonl`; provisional tags:
`value_miseval 75 · search_horizon 33 · quiet_refutation_missed 28 ·
tactical_motif_missed 23 · hanging_piece_missed 20 · endgame_conversion 8 ·
mate_missed 5 · king_safety 5 · opening_structure 3 · passed_pawn 2`
(deeper-probe at d7 distinguishes search_horizon from value_miseval; tags are
hypotheses, not ground truth). Caveat: because CVS was always winning, this
batch is dominated by won-position noise — the signal for engine improvement is
limited until opponents get stronger.

## Recommended next experiments

1. **Raise the ladder**: SF-1400/1600/1800 via real `UCI_Elo` (≥1320 ⇒ calibrated)
   until CVS actually loses games — that's where the Elo estimate becomes a
   measurement and the RSI data starts containing competitive-position failures.
2. **Filter RSI extraction** to competitive positions (|SF eval| < ~3 pawns) so
   won-position mate-dithering stops dominating the candidate set.
3. **Mate-finishing**: the 5 slow-mate cases are pure depth/horizon — consider
   depth 6 operating point (R4 showed d6 ≈ 68s/95 positions ⇒ ~0.7s/move, still
   ~4× faster than the SF-d10 scorer) or a simple mate-distance preference.
4. Re-run with `tactical_openings.epd` / `endgame_starts.epd` books for sharper
   RSI variety.

## Artifacts

`games.pgn` (60 games) · `games.jsonl` · `moves.jsonl` (engine telemetry) ·
`scored_moves.jsonl` (SF oracle + classification) · `summary.json` ·
`elo_ladder.md` · `failures.jsonl` · `rsi_candidates.jsonl` · `run_config.json`
