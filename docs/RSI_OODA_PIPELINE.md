# RSI And OODA Pipeline

## Current Loop

`arena/ooda.ts` implements the recursive improvement loop:

1. Observe: CVS plays games against Stockfish, alternating colors.
2. Orient: Stockfish reviews CVS plies with the configured review depth.
3. Decide: disagreements above `minCpLoss` are converted into training rows, and
   Stockfish playouts add corrected continuations.
4. Act: policy training runs against the accumulated dataset, then fixed
   holdout top-1 performance decides whether weights improve.

Stockfish review depth now defaults to 24 through
`DEFAULT_STOCKFISH_REVIEW_DEPTH`.

## Existing Infrastructure

- `arena/review.ts` scores played moves against Stockfish before/after evals.
- `arena/disagree.ts` filters meaningful disagreements and plays out Stockfish
  continuations.
- `arena/relabel_orchestrator.py` and `arena/sf-relabel-worker.py` run resumable
  parallel Stockfish relabeling.
- `arena/forensic-blunder.ts` and `arena/forensic-loss.ts` produce failure
  reports for engine/value/search investigations.
- `arena/train-cvs-nnue.py` trains piece-square plus CVS-registry NNUE inputs.

## Registry Contract

CVS feature registry compatibility is mandatory:

- Rust defines `CVS_REGISTRY_VERSION` and `registry_hash()` in
  `src/eval/cvs_features.rs`.
- `analyze --serve` exposes `registryVersion`, `registryHash`, and `inputDim`.
- `arena/train-cvs-nnue.py` embeds registry version/hash in model JSON.
- Rust `Nnue::load` rejects mismatched registry hashes.

Any geometry-feature change must bump the registry contract, relabel rows,
retrain, and pass holdout validation before adoption.

## Lazy Review Policy

Lazy reviewing is enabled by default. Every selected CVS ply receives a shallow
depth-8 review. Unavailable labels and divergent moves whose shallow loss reaches
half the configured disagreement threshold are then confirmed at the full
depth-24 oracle setting.

Round reports record `deepReviews/cvsPlies`, making the runtime/coverage tradeoff
visible. Set `lazyReview: false` to restore full-depth review on every selected
ply.
