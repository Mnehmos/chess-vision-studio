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
| Singular extensions | Missing | Defer to a dedicated search-strength branch. |
| Syzygy tablebases | Missing | Tournament-strength follow-up. |
| Polyglot book | Missing | Optional opening-resource follow-up. |

## Blue Phase Rule

Do not implement strength changes during structural refactors unless tests and
benchmarks isolate the behavior. Blue Phase should extract, document, and test
the existing search stack first.

## Follow-Up Gates

- Validate gated ordering flags independently: countermove, continuation
  history, capture history, history malus, history-informed LMR, and TT2.
- Add Channel-A/foreign TT safety tests before changing specialist-lane bound
  usage.
- Benchmark any singular extension, tablebase, book, PGO, or TT-alignment work
  in a separate branch.

