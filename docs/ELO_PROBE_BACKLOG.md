# ELO Probe Backlog

Last standardized: 2026-06-29.

This file is for direct strength probes only. A probe becomes a feature only
after it beats the current champion under the same budget and records the
binary, commit, weights, flags, threads, suite/openings, time control, and result
label.

## Gate Standard

1. One variable per run.
2. Compare against the same total CPU budget.
3. Use fixed-depth parity for speed-only changes and same-time games/positions
   for strength changes.
4. Track average cp loss, p90/p95 cp loss, blunder >=100cp, blunder >=200cp,
   mate-scale misses, depth reached, NPS, qnode share, TT hit/cut rate, and
   first-move cutoff rate.
5. Use Stockfish labels as an oracle for analysis gates, then cutechess/SPRT or
   a fixed-N game gate before live promotion.
6. Any helper/specialist feature must prove it beats plain raw depth with the
   same threads and clock. Otherwise it stays analysis-only.

## Probe Queue

| Priority | Probe | Reference | Hypothesis | Gate |
|---|---|---|---|---|
| P0 | Channel-A specialist SMP: `--threads N --cvs-helpers K`, foreign TT moves only | Lazy SMP and TT move ordering: https://www.chessprogramming.org/Lazy_SMP, https://www.chessprogramming.org/Transposition_Table | Helpers improve root ordering on danger/SEE/tactics positions without contaminating scores. | Same threads/time vs `--cvs-helpers 0`; must improve danger-suite cp loss and not raise bl100/bl200. |
| P0 | Internal iterative deepening (`--iid`) for cold TT nodes | Stockfish search source and CPW IID/TT practice: https://github.com/official-stockfish/Stockfish/blob/master/src/search.cpp | Missing TT moves are hurting first-move cutoff rate; reduced IID can seed ordering at deep nodes. | Telemetry first: lower avg cutoff index, higher first-move cutoff, controlled node overhead; then cp-loss/game gate. |
| P0 | History stack A/B: countermove, continuation history, capture history, malus/gravity, history-informed LMR | History heuristic: https://www.chessprogramming.org/History_Heuristic; open engines such as Stockfish/Ethereal/Berserk | Quiet and capture ordering should reduce searched branching and buy depth without extra eval cost. | Independent flag ladder, then paired combinations only after each flag is non-regressing alone. |
| P1 | Log LMR and history-shaped reductions | LMR: https://www.chessprogramming.org/Late_Move_Reductions; Stockfish search source | Current reductions are conservative; better depth/move-index shaping should reduce late quiet cost. | Fixed-depth tactical parity first, then same-time cp-loss; reject on mate-scale or danger regressions. |
| P1 | TT2/replacement and table sizing/alignment | TT replacement and lockless hashing: https://www.chessprogramming.org/Transposition_Table | More useful TT retention can improve hash move quality and reduce cold misses. | No move/score parity drift for speed-only replacement; telemetry must show better hit/cut rates or lower search time. |
| P1 | Singular extensions, narrowly gated | Singular extensions: https://www.chessprogramming.org/Singular_Extensions; Stockfish source | Deep TT-backed singular moves may catch forcing tactics without broad extension cost. | Tactical/mate suite first; then same-time cp-loss. Must not increase searched branching enough to lose depth. |
| P1 | Selectivity stack: SEE pruning, delta pruning, LMP | SEE and quiescence references: https://www.chessprogramming.org/Static_Exchange_Evaluation, https://www.chessprogramming.org/Quiescence_Search | Prune provably bad captures/quiet tails to buy depth. | Hard-negative tactical suite before game tests. Any bl200 increase rejects the flag. |
| P2 | Null-move tuning by phase/material | Null move pruning: https://www.chessprogramming.org/Null_Move_Pruning | Existing null move is guarded; phase-aware R and zugzwang filters may buy depth safely. | Endgame/zugzwang suite plus full game gate; reject on conversion/repetition regressions. |
| P2 | Root ranker/helper NNUE as ordering only | Stockfish NNUE architecture and open-engine move ordering practice: https://github.com/official-stockfish/Stockfish | A learned quiet-root ordering bonus can find human defensive moves without taxing every node. | Root-order telemetry, then same-time cp-loss. No live play until it beats raw depth. |
| P2 | Ponder cache and opponent-clock specialist dives | Existing project `bench-ponder-cache.py`; Lazy SMP same-budget rule | Use opponent time for expensive candidate diversity, then verify on own clock. | Hit-rate, cached-used, verify-reject, cp-gain-hit/miss, and same-budget game gate. |
| P2 | Syzygy/book promotion discipline | Tablebase/book usage is standard engine practice, but external resources change claim scope. | Avoid needless endgame/opening blunders without changing midgame search. | Claims must say resources enabled. Tablebase/book wins are runtime configuration, not search ELO. |

## Probe Report Template

```text
Probe:
Date:
Repo/commit:
Binary:
Weights:
Flags:
Threads/hash/time control:
Opponent/oracle:
Suite/openings:
Result:
Telemetry:
Decision: PROMOTE | REJECT | ACCEPTED WITH NOTE | HOLD | ANALYSIS MODE ONLY
```

## Reference Links

- Stockfish source: https://github.com/official-stockfish/Stockfish
- Stockfish search implementation: https://github.com/official-stockfish/Stockfish/blob/master/src/search.cpp
- Chess Programming Wiki, Lazy SMP: https://www.chessprogramming.org/Lazy_SMP
- Chess Programming Wiki, Transposition Table: https://www.chessprogramming.org/Transposition_Table
- Chess Programming Wiki, History Heuristic: https://www.chessprogramming.org/History_Heuristic
- Chess Programming Wiki, Late Move Reductions: https://www.chessprogramming.org/Late_Move_Reductions
- Chess Programming Wiki, Null Move Pruning: https://www.chessprogramming.org/Null_Move_Pruning
- Chess Programming Wiki, Singular Extensions: https://www.chessprogramming.org/Singular_Extensions
- Chess Programming Wiki, Static Exchange Evaluation: https://www.chessprogramming.org/Static_Exchange_Evaluation
- Chess Programming Wiki, Quiescence Search: https://www.chessprogramming.org/Quiescence_Search
- Ethereal engine repository: https://github.com/AndyGrant/Ethereal
- Berserk engine repository: https://github.com/jhonnold/berserk
- cutechess CLI: https://github.com/cutechess/cutechess
- Stockfish Fishtest: https://github.com/official-stockfish/fishtest
