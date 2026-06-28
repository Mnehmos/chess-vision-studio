# RSI engine-improvement iteration log

## Iteration 1 — REJECTED (2026-06-26)
- Data: relabeled 4007 harvested positions (SF multipv d10) + 638 master = big-multipv 4373 rows (6.8x).
- Candidate: train:mixed (alpha1 beta1) -> value/rung2-cand. Ranking acc dropped 34.8->32.2%; material flattened ~1.0.
- A/B eval:matrix on 250 unseen holdout (SF d18):
  - d3 avgCpLoss mixed 2.035 vs cand 1.712 (cand better); d4 mixed 1.363 vs cand 1.398 (cand WORSE).
  - top1 d3 38.8 vs 37.6; d4 43.2 vs 44.0. blunder ~tied. mate/illegal identical.
- Verdict: WASH, no consistent win at depth 4. Live weights kept. Cause: harvest dominated by already-winning positions (we sweep SF) -> low eval signal + diluted master rows.


## Iteration 2 — REJECTED (2026-06-26)
- Data: master(617) + CONTESTED harvested (|evalBefore|<=250, 2126) = big-multipv-v2 2743 rows.
- Same structural outcome: material flattened ~1.0, rank acc 34.8->32.6%. train:mixed (a1b1) does not beat existing tuned weights regardless of data filtering.

## CRITICAL REFRAME — bot eval is NNUE, not handcrafted weights
- .env: CVS_RUST_NNUE=matrix-raw.json (gen8-v2, 768x256), CVS_RUST_HELPER_NNUE=matrix-residual.json, all search extras ON.
- Iterations 1-2 (handcrafted value-weights) = WRONG LEVER for the bot. They only affect the gauntlet/dev-analysis engine (no NNUE). Both correctly REJECTED by the holdout gate. Live weights untouched.
- Real measured strength (rust-engine/benchmarks): ~2375-2535 Elo blitz. Gap to full SF (~3500) ~1000 — user is correct.

## Established NNUE RSI pipeline (rust-engine/RSI_LOOP_REPORT.md)
selfplay.exe -> relabel-fleet.py (SF d12) -> train-nnue.py (PyTorch) -> gates (eval_parity, bench-oracle-cploss.py, cutechess SPRT vs frozen champion) -> promote to target-cvs/matrix-raw.json.

## SESSION OUTCOME / BLOCKERS (2026-06-26)
- BLOCKED for actual NNUE retraining: (1) PyTorch broken — `python` = open5e venv with CUDA torch, c10_cuda.dll WinError 127; (2) no GPU; (3) no cutechess-cli for SPRT game gate.
- Existing ready-to-train corpus: f:/tools/labels-sf-d12-shard-00..04.jsonl = 5.34M SF-d12 labeled positions (the data the champion trained on).
- DONE this session (feasible/valuable): bot harvesting real games (seed-AI ON); generated FRESH self-play corpus f:/tools/selfplay-gen9-20260626.jsonl (40k games d5, champion-grade handcrafted eval) as next-gen data foundation. Added gauntlet --base/--rung2 + train-mixed --base-out/--rung2-out + eval-matrix `candidate` engine (reusable A/B harness).

## RESUME STEPS for the user (needs GPU box or working CPU PyTorch)
1. Fix torch: in a CLEAN venv `pip install torch --index-url https://download.pytorch.org/whl/cu121` (GPU) or .../cpu.
2. Relabel the fresh self-play corpus: `python arena/relabel-fleet.py f:/tools/selfplay-gen9-20260626.jsonl --output f:/tools/labels-gen9-d12.jsonl --depth 12 --workers 14`
3. Train: `python arena/train-nnue.py <labels...> --hidden 256 --epochs 12 --lambda 0.6 --out arena/out/nnue-gen9.json` (combine with existing shards for more data).
4. Gate vs champion: eval_parity; `python arena/bench-oracle-cploss.py --engine analyze.exe --net nnue-gen9.json --depth 5 --oracle-depth 24` on a FRESH non-leaked suite; then game-strength vs f:/tools/cvs-baselines/analyze-gen8v2-champion.exe. Promote (copy to target-cvs/matrix-raw.json) ONLY on a game-strength win.

## Iteration 2 A/B final numbers (REJECTED, confirmed)
- d4: live(mixed) top1 43.2% cpLoss 1.363 blunder 6.8%  vs  candidate top1 42.8% cpLoss 1.403 blunder 7.2% -> candidate WORSE on all three. Live weights kept.
- Conclusion: handcrafted value-weight retraining via train:mixed cannot beat the existing tuned weights AND is the wrong lever for the NNUE bot. Eval-weight track CLOSED.

## Data foundation COMPLETE (2026-06-26/27)
- F:/tools/gen9-labeled-d12/labeled00..09.jsonl = 1,000,000 fresh self-play positions, SF d12 labeled (sfCp; res=null -> train with --lambda 1.0 OR merge with result-bearing shards).
- Ready for GPU NNUE training: merge with f:/tools/labels-sf-d12-shard-00..04.jsonl (5.34M) -> train-nnue.py --hidden 256 --epochs 12 -> gate vs analyze-gen8v2-champion.exe -> promote on win.

## ARCHITECTURE iteration: Internal Iterative Deepening (IID) — 2026-06-27
- Target: #1 audited bottleneck = move ordering (~82% cold TT probes, ~35% first-move cutoff). No IID existed.
- Change (rust engine, behind --iid flag): in negamax, when tt_move is None & depth>=7 & not excluded, search the node at depth-2 (node's own window → cheap zero-window for non-PV) to populate the TT, then re-probe to seed tt_move. Files: search/types.rs (iid flag + default false + with_cli_flags --iid/--no-iid + telemetry iid_searches/iid_found), search/root.rs (IID block before order_moves), bin/analyze.rs (telemetry surface). uci.exe applies with_cli_flags(args) so --iid toggles cleanly.
- Functional test (depth 11, midgame, NNUE): nodes 3.73M→3.50M (−6.2%), time −8.7%, SAME best move/eval. Smaller tree at fixed depth = ordering win → deeper at fixed time.
- Smoke (6 games 10+0.1): iid 4-1-1 (75%), +190 Elo noisy.
- GATE RUNNING: cutechess SPRT uci.exe --iid vs --no-iid (SAME binary+NNUE, isolates IID), 10+0.1, elo0=0 elo1=20 a=b=0.05, up to 1000 games, F:/tools/iid-gate.pgn. Same-binary A/B is cleaner than vs frozen champion (no code drift).
- PROMOTE on pass: enable IID for bot via .env CVS_RUST_IID=1 + rustBackendExtraArgs, and/or flip Default iid=true. Changes UNCOMMITTED (on master — branch before commit).

## IID GATE RESULT: REJECTED (~0 Elo) — 2026-06-27
- 532 games 10+0.1: iid 175 - base 179 - 178D = 49.6% (~-3 Elo, 95% CI ~±30). Not a >=20 Elo gain; trending slightly negative. Stopped early (clearly not passing).
- Read: classic IID ~neutral here — engine already has history-based ordering (hist_lmr/hist_malus on); IID overhead cancels the -6.2% node win at fixed time. Consistent with modern engine experience (SF dropped classic IID).
- IID code kept behind --iid flag (default OFF) — harmless, not promoted. Bot untouched.
- Caveat: gate ran alongside d20 relabel (CPU contention, symmetric) — but 49.6% over 532 games rules out a meaningful gain regardless.
- NEXT ordering levers (higher EV, per audit + the fact countermove/conthist are OFF by default): continuation history (conthist), countermove, OR the more fundamental fix = TT REPLACEMENT POLICY to actually raise cold-probe move coverage (the 82% cold root cause). User noted conthist/countermove "underperformed" before — likely gated by low TT coverage, so TT replacement may be the unlock. ASK user for direction (they have prior-attempt context).

## CODE REVIEW + GAP BACKLOG (2026-06-27) — search engine
CORRECTNESS BUGS:
- BUG1 (HIGH): mate scores NOT ply-adjusted on TT store/probe (search.rs store/tt_probe). Corrupts mate distances across TT hits → botched conversions/blunders. Fix: +ply on store, -ply on probe for |score|>=MATE_THRESHOLD; thread ply through ~9 call sites; add unit test. ~+10-25. DO FIRST (carefully).
- BUG2 (FIXED 2026-06-27): root() stored Flag::Exact even on aspiration fail-low (root.rs:95) → TT pollution. Now derives Upper/Lower/Exact from (alpha0,beta). cargo check clean. Gate after screen.
- BUG3 (low, default-off): `improving` reads stale eval_stack[p-2] (root.rs:263-278). Fix before enabling improving.

EV-RANKED BACKLOG (Elo/effort, cutechess-gated one at a time):
1. BUG2 root flag — FIXED, gate. trivial. +5-15
2. Time mgmt: default path sets soft_time_ms=None so smart-time stability/extension logic (search.rs:432-453) is DEAD. Make default populate soft/hard like --smarttime (uci.rs:263-276: soft=t/25+inc*3/4, hard=soft*4). trivial. +15-30. ← cheapest real Elo
3. BUG1 mate-TT. small. +10-25
4. Log-based LMR table r≈0.75+ln(d)·ln(i)/2.25 + PV/cutnode terms (root.rs:439-465 is flat 0/1/2 tiers). small. +20-40
5. Ordering flags: caphist looks +; conthist/countermove EMPIRICALLY NEGATIVE in screen (likely a BUG in their impl — investigate why they hurt, normally +20-40). history is reset every search (search.rs:247) — try carrying scaled history across ID iters/moves. 
6. TT: TT_BITS=21 (16MB, single-bucket default). Bump to 23-24 (64-128MB) and/or make tt2 default. trivial. +10-20
7. Static-eval correction history (none exists; RFP/null/futility all key off raw static eval). medium. +10-20
8. Re-tighten LMP budget (root.rs:387 doubled to 8+2*d^2 to compensate low first-cut) once ordering improves. +5-15
9. Small contempt (avoid accepting repetition draws vs weaker). trivial. +3-10
Full review agent id af7b8896356cef0e9.

## CONTHIST + COUNTERMOVE BUGS FOUND & FIXED (source, 2026-06-27) — cargo check clean
Root cause of their gate regression (2nd review agent abcccb81f4115ab16):
- conthist BUG: updated uncapped depth² (0..16384, unsigned, NO malus) but summed RAW with butterfly history (gravity ±8192 signed). 2x magnitude + always-positive → swamped history incl. the malus that drives first-cut. FIX (ordering.rs:100): gravity-bound to ±8192, same (150*depth).min(1500) bonus as history → now a peer in the sum.
- countermove BUG: fixed tier 650_000 ABOVE all history quiets → hard-promotes often-stale countermove above genuine high-history quiets. FIX (ordering.rs:329): removed tier; fold as +4096 additive bonus within the quiet band.
- Both behind --conthist/--countermove flags → directly re-gateable. Screen's conthist/countermove (negative) tested the OLD buggy code → OBSOLETE; must REBUILD + re-gate after screen.
- NOTE: screen results for lmp/singular/caphist/seeprune/tt2/improving use UNCHANGED code → still valid.

PLAN when screen done: (1) rebuild uci.exe (BUG2+conthist+countermove fixes baked, flags off by default). (2) gate new-base vs old-base → isolates BUG2 Elo. (3) re-gate --conthist, --countermove (fixed). (4) gate screen winners (lmp/singular/caphist). (5) gate --smarttime (time-mgmt, existing flag, +15-30 expected). (6) implement+gate BUG1 mate-TT (with unit test), log-LMR. Combine winners → promote to bot (.env CVS_RUST_* + rustBackendExtraArgs).

## STATE 2026-06-27 (Round 2 running)
- uci.exe REBUILT with BUG2 + conthist-scale-fix + countermove-precedence-fix (flags off by default). Old binary saved F:/tools/uci-prefix.exe.
- Round 2 confirm gauntlet RUNNING (task, 2100 games, 300 ea, conc 12): base(new) vs {oldbase[=BUG2 isolation], lmp, improving, tt2, conthistFIX, countermoveFIX, combo[=lmp+improving+tt2+conthist+countermove]}. pgn F:/tools/confirm-round2.pgn.
- Screen winners (100g, noisy): lmp+74, improving+42, tt2+35, conthist+31(buggy); singular/seeprune/caphist/countermove flat-to-negative.
- PROMOTION PATH PREPPED: added env→flag maps to arena/engine-backend/rust-backend.ts: CVS_RUST_LMP/IMPROVING/TT2/CONTHIST/COUNTERMOVE/SINGULAR/SMARTTIME=1. To promote: stop bot → rebuild analyze.exe (cargo build --release --bin analyze; needs bot stopped to unlock) WITH the fixes → set winners in .env → restart bot. (Bot's analyze.exe is still OLD/buggy until rebuilt.)
- NEXT after Round 2: read standings; promote combo if it beats base; then gate --smarttime (existing flag, +15-30), implement BUG1 mate-TT (+unit test) & log-LMR. NNUE d20 relabel was KILLED (user) — resume later for NNUE retrain.

## ROUND 2 RESULT (300g ea, ±32 Elo) — 2026-06-27
- lmp +51 (57.3%) CONFIRMED (CI excl 0; screen also +74). ← REAL WIN, promote.
- combo +30 (dragged by dead features). improving +13 marginal. tt2 0 (coverage = noise). 
- oldbase -5 = BUG2 fix ~+5 (keep, correctness). countermoveFIX -6, conthistFIX -17 → those heuristics don't pay here even bug-free (fixes correct but not Elo). 
- Conclusion: ship lmp; test --smarttime + improving stacking next.

## ROUND 3 STACKING RESULT (≈1772/2000g, ±30 Elo) — 2026-06-27  *** HEADLINE ***
- lmp+smarttime +111 (65.4%) ← BEST, PROMOTE THIS.
- lmp+smarttime+improving +88 (improving DRAGS). smarttime alone +60. lmp+improving +37. lmp alone +14 (noisy; +51/+74 in earlier runs).
- DECISION: promote CVS_RUST_LMP=1 + CVS_RUST_SMARTTIME=1 (exclude improving). smarttime = the "dead time-management logic" fix = the big win. See HANDOFF.md.

## STATE 2026-06-28 — PROMOTED lmp + smarttime to the bot
- Rebuilt analyze.exe (engine repo commit 75be171): BUG2 fix baked + `--lmp` flag + **smarttime PORTED to serve `go <ms>` path** (was uci.rs-only). Split: soft = ms·1.2 (≈ uci t/25), hard = ms·4.8 capped at ms·5 (≈ uci t/6, slightly safer), gated `--smarttime`. Bot passes ms ≈ clock/30 + 0.8·inc (uci's non-smart budget) so the ratios transfer. Verified: `go 300` → 325ms/d9 with flag vs 300ms/d8 without.
- Promoted in main-tree `.env`: `CVS_RUST_LMP=1` + `CVS_RUST_SMARTTIME=1`. Bot restarted, connected as ChessVisionStudioEng, analyze.exe confirmed running `--lmp --smarttime`. Backup: `target/release/analyze.exe.bak-promote` (revert = restore + `CVS_RUST_SMARTTIME=0`/restart).
- NEXT: monitor bot games for smarttime time-trouble (hard ≈ clock/6.25). If clean → BUG1 mate-TT (+unit test) / log-LMR / NNUE track. Optional: cutechess-gate the analyze.exe smarttime port at bot-like TC to confirm the bot-context gain (the +60 was uci.exe; the port replicates the ratios).
