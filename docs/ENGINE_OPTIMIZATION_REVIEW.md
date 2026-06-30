# Engine Optimization Review

Last review: 2026-06-29.

Goal: keep the authoritative engine fast, avoid accidental self-slowdown, and
make specialist/multi-threaded work measurable rather than conflicting.

## Current Verdict

The architecture is mostly sound: UCI access is serialized per engine process,
parallelism is achieved with process/worker pools, the native engine has Lazy
SMP plus specialist helper lanes, and telemetry exposes TT, pruning, branching,
and foreign-lane hint usage.

The important fixes from this review were:

- `CVS_RUST_THREADS` and `CVS_RUST_CVS_HELPERS` are now wired through the app
  Vite bridge and arena Rust backend.
- The app's Rust process pool now scales down when each process owns multiple
  search threads, avoiding process fan-out times thread-count oversubscription.
- Lichess live-play helper/thread/smarttime settings now use
  `CVS_LICHESS_RUST_*` knobs so analysis UI experiments do not leak into live
  games.
- Native specialist lanes now use Channel-A isolation: foreign-lane TT entries
  may provide move hints, but their scores/bounds do not prune a different
  lane's tree.

## Runtime Budget Model

There are four separate concurrency layers. Treat them as a product, not as
independent speed knobs.

| Layer | Control | Default | Rule |
|---|---:|---:|---|
| Browser Stockfish workers | `app/engine-pool.ts` `defaultPoolSize()` | up to 4 | Only used when native Stockfish/CVS bridge is unavailable. |
| Native CVS HTTP request fan-out | `App.tsx` dataset path | 12 request streams | Feeds the Vite process pool; it is not engine thread count. |
| Native CVS process pool | `arena/dev-server/cvs-engine-proxy.ts` | 2-8, scaled by threads | Parallelizes independent FENs; scaled down by `CVS_RUST_THREADS`. |
| Native CVS search threads | `CVS_RUST_THREADS`, `CVS_RUST_CVS_HELPERS` | 1, 0 | Use for one-position strength experiments; keep at 1 for bulk app analysis unless testing SMP. |

Practical rule: for app/dataset throughput, prefer many single-threaded engine
processes. For one-position play-strength experiments, prefer one process with
controlled `--threads`/`--cvs-helpers` and compare against the same total thread
budget.

## Specialist SMP Contract

The native engine implements Lazy SMP through `search_smp`: helpers clone the
position, share the lock-free TT, stop when the main search completes, and return
the main thread's completed result. Specialist helpers use the first helper lanes
as `KingSafety`, `See`, and `Tactics`.

Authority rules:

- The main thread remains authoritative for the returned move.
- Foreign-lane TT moves are allowed as ordering hints.
- Foreign-lane TT scores and bounds are not allowed to cut off another lane.
- Timed search returns the last completed iterative-deepening result; partial
  root state is diagnostic only.
- Lichess live-play helper mode is explicit: set `CVS_LICHESS_RUST_THREADS`,
  `CVS_LICHESS_RUST_CVS_HELPERS`, `CVS_LICHESS_RUST_SMARTTIME`, and optionally
  `CVS_LICHESS_RUST_HELPER_NNUE`.

Telemetry to inspect:

| Metric | Meaning |
|---|---|
| `foreignHints` / `telemetry.foreignHints` | Main search consumed a move hint written by a foreign lane. |
| `foreignCutoffs` / `telemetry.foreignCutoffs` | A foreign-hinted move caused a searched beta cutoff. This is ordering influence, not a foreign bound cutoff. |
| `ttHitPct`, `ttCutoffPct`, `firstMoveCutoffPct` | Whether TT/order quality is improving or just adding cache churn. |
| `searchedEffectiveBranching`, `qNodePct`, pruning attempt/skip rates | Whether a feature buys depth without raising tactical misses. |

## Review Findings

### Fixed: app bridge did not expose native SMP

The Rust engine already accepted `--threads` and `--cvs-helpers`, but the app
bridge and arena backend did not map env vars to those flags. Multi-threaded
specialist mode was therefore available through direct native scripts, but not
through the normal Vite bridge. This is now wired through
`CVS_RUST_THREADS` and `CVS_RUST_CVS_HELPERS`.

### Fixed: process fan-out could multiply with search threads

The Vite bridge kept a 2-8 Rust process pool regardless of per-process search
threads. If `--threads 4` were enabled there, the app could feed many multi-thread
processes at once. The pool size now scales down by engine thread count.

### Fixed: foreign TT scores could cross lane boundaries

Before this review, a Fast main search could consume a specialist-lane TT entry's
score/bound for cutoffs. That contradicts the safe Channel-A design. Root search,
singular-extension probes, and qsearch now ignore foreign-lane bounds while still
keeping the move hint for ordering.

### Remaining Risk: no new same-budget strength gate has been run

The fixes above are architectural safety and config correctness. They are not an
ELO claim. Any promotion of `CVS_RUST_THREADS > 1`, `CVS_RUST_CVS_HELPERS > 0`,
helper NNUE, or foreign-bound Channel B needs a same-budget benchmark report in
the native engine repo.

## Verification Commands

App/config checks:

```bash
npx vitest run arena/dev-server/cvs-engine-proxy.test.ts arena/__tests__/engine-backend.test.ts arena/lichess/__tests__/lichess.test.ts
npm run build
```

Native engine checks:

```bash
cd ../chess-vision-studio-rust-engine
cargo test --test smp --test specialist_lanes --test search_options
cargo test
```

Manual identity check:

```bash
../chess-vision-studio-rust-engine/target/release/analyze.exe --serve --depth 6 --threads 4 --cvs-helpers 3
{"cmd":"identity"}
```

Expected identity result: `options.threads` is `4`, `options.cvsHelpers` is `3`,
and helper mode should be considered experimental unless a benchmark report says
otherwise.
