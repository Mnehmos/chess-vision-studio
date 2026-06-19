# Modern Engine Feature Checklist

## Validated Status

The original checklist was validated against the current Rust engine. Several
items that were marked missing are already present in `src/search.rs`, though
some are gated or still need strength/safety validation.

| Area | CVS status | Notes |
|---|---|---|
| Principal Variation Search | Present | Implemented behind search options. |
| Aspiration windows | Present | Part of PVS/root search flow. |
| Lock-free transposition table | Present | TT alignment/cache friendliness remains a follow-up. |
| Lazy SMP | Present | `threads > 1` runs shared-TT helper search. |
| Heterogeneous CVS SMP | Present | `cvs_helpers` and specialist lanes exist. |
| NNUE | Present | Loader enforces CVS registry hash compatibility. |
| Multi-network/helper NNUE | Present | Main/helper NNUE paths exist. |
| Killer heuristic | Present | Two killer slots per ply. |
| History heuristic | Present | Main history table exists. |
| Countermove | Present, gated | `--countermove`. |
| Continuation history | Present, gated | `--conthist`. |
| Capture history | Present, gated | `--caphist`. |
| Null move pruning | Present | Default-on option. |
| LMR | Present | Default-on option. |
| Futility/RFP/LMP/SEE/delta pruning | Present, mixed defaults | Some remain off by default after Elo gates. |
| Singular extensions | Present, gated | Search option and exclusion-search path exist; promotion remains benchmark-gated. |
| Syzygy tablebases | Present, optional | Native probing is configured through the Rust search options and UCI integration. |
| Polyglot book | Present, optional | Native book loading/probing exists and remains an opt-in external resource. |

## Blue Phase Rule

Do not implement strength changes during structural refactors unless tests and
benchmarks isolate the behavior. Blue Phase should extract, document, and test
the existing search stack first.

## Follow-Up Gates

- Validate gated ordering flags independently: countermove, continuation
  history, capture history, history malus, history-informed LMR, and TT2.
- Add Channel-A/foreign TT safety tests before changing specialist-lane bound
  usage.
- Benchmark promotion or tuning of singular extensions, tablebases, books, PGO,
  and TT alignment in separate strength branches.
