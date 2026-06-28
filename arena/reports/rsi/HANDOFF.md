# RSI ENGINE-IMPROVEMENT — FRESH-CONTEXT HANDOFF (2026-06-27)

You are continuing an autonomous, in-progress effort to strengthen the **Chess Vision Studio engine**. Read this top-to-bottom before acting. Companion records: `arena/reports/rsi/iteration-log.md` (full chronology) and the memory file `rsi-engine-improvement.md`.

## MISSION
Recursively self-improve the CVS engine (**~2350 Lichess**) to close the gap to full Stockfish (**~3600**) — lots of headroom. Three tracks: (1) **cutechess-gated search/architecture experiments**, (2) **bug fixes**, (3) **NNUE retrain**. DISCIPLINE: one variable at a time, **same-binary A/B**, promote **only** verified wins, never ship unverified, never disrupt the live Lichess bot without cause.

## HEADLINE RESULT — READY TO PROMOTE
Across 3 cutechess gauntlets (10+0.1), the confirmed win is **`--lmp` + `--smarttime` ≈ +111 Elo** (65.4% vs base, ±30). `--smarttime` alone ≈ +60 (the time-management logic was effectively dead by default). `--lmp` alone is positive but noisy (+14/+51/+74 across runs). `--improving` DRAGS the stack (exclude). Rejected by the gate (do NOT promote): `tt2`/TT-coverage (~0), `conthist` (−17 even after bug-fix), `countermove` (−6 even after bug-fix), `singular`/`seeprune`/`caphist` (flat/negative), `--iid` (~0).

### To PROMOTE lmp+smarttime to the bot (the immediate next action):
1. The bot plays via **`analyze.exe`** (NOT uci.exe). It's the OLD binary (pre-fixes) and is **file-locked while the bot runs**. To ship clean code (BUG2 + ordering fixes) rebuild it: **stop the bot** (TaskStop the bot task), then `cd F:\Github\chess-vision-studio-rust-engine && cargo build --release --bin analyze`.
2. Enable the flags in `.env` (mappings already wired in `arena/engine-backend/rust-backend.ts`): set `CVS_RUST_LMP=1` and `CVS_RUST_SMARTTIME=1`.
3. Restart the bot: `npm run lichess:bot` (background).
4. (Optional sanity) re-confirm lmp+smarttime vs base at ~600 games before promoting if you want tighter CI.

## ENVIRONMENT & EXACT PATHS
- App repo: `F:\Github\chess-vision-studio` (branch **master** — BRANCH before committing). Rust engine repo: `F:\Github\chess-vision-studio-rust-engine` (branch **develop**).
- Rust build: `cargo build --release --bin uci` (gate binary) / `--bin analyze` (bot binary, needs bot stopped). Binaries in `target/release/`.
- **Gate binary** uci.exe: `F:/Github/chess-vision-studio-rust-engine/target/release/uci.exe`. It reads search flags via `with_cli_flags(args)` and `--nnue <path>` for eval.
- **Live NNUE** (bot eval): `F:/Github/chess-vision-studio-rust-engine/target-cvs/matrix-raw.json` (gen8-v2, 768x256). Helper: `matrix-residual.json` (analysis only).
- **cutechess-cli**: `F:/tools/cutechess/cutechess-1.3.1-win64/cutechess-cli.exe`. NOTE: flag is `-pgnout` not `-pgn`.
- **Openings**: `F:/tools/iid-gate-openings.epd` (24 positions, combined).
- **Old uci baseline** (for BUG2 isolation): `F:/tools/uci-prefix.exe`.
- **GPU training**: use `C:/Users/mnehm/AppData/Local/Programs/Python/Python312/python.exe` (torch 2.6.0+cu124, RTX 4070). NOT `python` on PATH (that's the broken open5e venv).
- Stockfish oracle: `F:/tools/stockfish/stockfish/stockfish-windows-x86-64-avx2.exe`. Frozen baselines incl champion: `F:/tools/cvs-baselines/analyze-gen8v2-champion.exe`.
- Machine: 16 logical cores. cutechess concurrency 12 is fine when nothing else heavy runs.

## GATING METHODOLOGY (cutechess gauntlet, same-binary A/B)
`cutechess-cli -tournament gauntlet -engine name=base cmd=uci.exe arg=--nnue arg=<NNUE> -engine name=cand cmd=uci.exe arg=--nnue arg=<NNUE> arg=--FLAG ... -each proto=uci tc=10+0.1 -openings file=<epd> format=epd order=random -repeat -games 2 -rounds N -concurrency 12 -recover -ratinginterval 50 -pgnout <out>`. First engine (base) plays all others. Screen at ~100g/pairing, confirm winners at 300–500g (±30/±25 Elo). Promote only if CI clearly excludes 0. Same binary, flag on vs off → isolates the change exactly (cleaner than vs frozen champion).

## CRITICAL GOTCHAS
- **Do NOT `cargo build --bin uci` while a gauntlet is running** — cutechess spawns uci.exe per game; overwriting it mid-run corrupts the A/B. Use `cargo check` to verify compilation without touching the binary.
- **analyze.exe is locked by the running bot** — building it fails until the bot is stopped. Build `--bin uci` for gates (separate file, unaffected).
- **Bot uses NNUE**, not handcrafted value-weights. Handcrafted value/rung2 weight retraining (early in this effort) was the WRONG lever and is abandoned (those weights are archived/gens-outdated).
- Python: Python312 for torch; `python` on PATH = broken CUDA venv.
- NNUE d20 relabel was KILLED by user (it ran via `arena/sf-relabel-worker.py` python orchestrators that respawn stockfish — kill the python procs, not just stockfish). Resume only after architecture gains are banked.

## UNCOMMITTED CHANGES (nothing committed yet)
RUST repo (engine fixes — the gated work):
- `src/search/types.rs`: added `iid` flag (default off) + `--iid`/`--no-iid` toggle + telemetry `iid_searches`/`iid_found`.
- `src/search/root.rs`: IID block (gated, ~neutral, keep behind flag); **BUG2 fix** (root aspiration flag: derive Upper/Lower/Exact from window instead of always Exact).
- `src/search/ordering.rs`: **conthist scale fix** (gravity-bound ±8192) + **countermove precedence fix** (additive +4096 within quiet band, removed fixed 650k tier). Both behind their flags.
- `src/bin/analyze.rs`: surfaced iid telemetry.
APP repo (arena tooling + earlier UI work):
- `arena/engine-backend/rust-backend.ts`: env→flag maps `CVS_RUST_LMP/IMPROVING/TT2/CONTHIST/COUNTERMOVE/SINGULAR/SMARTTIME`.
- `arena/gauntlet-play.ts`: added `--base`/`--rung2` flags. `arena/train-mixed.ts`: `--base-out`/`--rung2-out`. `arena/eval-matrix.ts`: `candidate` engine entry.
- Earlier UI/eval work (separate from RSI, also uncommitted): App.tsx, AlternativeLinesPanel.tsx, AnalysisBoardPanel.tsx, PreviewTeachingCard.tsx (+test), TeachingLog.tsx, Board2D, styles/index.css, etc., and engine/ (led, see, teaching/node, types). New: `app/piece-set.ts`, `app/assets/`, `app/PreviewTeachingCard.test.ts`.

## NEXT-STEPS QUEUE (priority order)
1. **PROMOTE lmp+smarttime** to the bot (steps above) — bank the +111.
2. **Commit** the rust engine fixes (branch off develop) + arena tooling (branch off master) with measured deltas. (Only when user approves committing.)
3. **BUG1 — mate-score TT ply-adjust** (HIGH correctness, ~+10-25). search.rs `store`/`tt_probe`: thread `ply`, `+ply` on store / `-ply` on probe for `|score|>=MATE_THRESHOLD`; ~9 call sites; ADD A UNIT TEST (mate distance preserved across TT). Gate.
4. **Log-based LMR** (~+20-40). root.rs LMR is flat 0/1/2 tiers; replace with `r≈0.75+ln(d)·ln(i)/2.25` table + PV/cutnode terms. Behind a flag. Gate.
5. **Static-eval correction history** (~+10-20, medium). RFP/null/futility key off raw static eval; add a correction table.
6. **Re-tighten LMP budget** (root.rs:387 doubled `8+2·d²`) now that ordering is better; gate.
7. **NNUE retrain track** (the big lever, GPU available): selfplay.exe → relabel-fleet.py (d20, the standard) → train-nnue.py (Python312, hidden 256, lambda 0.6) → gate via cutechess vs analyze-gen8v2-champion.exe → promote to target-cvs/matrix-raw.json on a strength win. Existing data: `F:/tools/labels-sf-d12-shard-00..04.jsonl` (5.34M), `F:/tools/selfplay-gen9-20260626.jsonl` (3.69M raw self-play). relabel-fleet.py REAL CLI: `--source <glob> --out-dir <dir> --workers N --depth 20`.

## LIVE BACKGROUND JOBS (verify on resume)
- Round 3 stacking gauntlet (task `b0jpwwq8j`) — finishing (~1772/2000 when this was written); read final standings, confirm lmp+smarttime.
- Lichess bot (task `buw3kyyqz`) — playing/harvesting (seed-AI on). Vite dev server (task `bgtvggla9`) — http://localhost:5173.
- Output files under the session tasks dir; `grep "^\s+[0-9] " <file>` for cutechess standings.
