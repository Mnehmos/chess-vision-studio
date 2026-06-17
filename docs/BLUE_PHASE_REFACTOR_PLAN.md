# Blue Phase Refactor Plan

## Summary

Blue Phase is a conservative refactor milestone. The goal is to reduce large UI,
engine, server, and Rust modules while preserving existing behavior. The only
intentional policy change in this pass is that Stockfish oracle/review defaults
now use depth 24.

The implementation is staged so each extraction is covered by tests before code
moves. Engine/domain contracts stay owned by `engine/*`, `@cvs/engine`, and the
Rust engine. App-local types should describe UI state and view models only.

## Pass 1: Interfaces, Docs, And Review Depth

- Use `arena/review-config.ts` as the TypeScript source of truth for Stockfish
  review/oracle depth.
- Keep CLI and environment overrides intact.
- Do not change CVS play depth, Rust feature extraction depth, or non-oracle
  engine benchmarks.
- Keep facts, teaching, and NNUE registry contracts in domain layers, not in
  React components.

## Pass 2: TDD And Boundary Coverage

- Add characterization tests before large extractions.
- Guard production `engine/` from app imports and browser side effects.
- Keep unavailable evals/facts distinct from zero, equal, safe, or best.
- Require Rust search tests before splitting `src/search.rs`.

## Pass 3: UI De-Bloat And CSS System

- Global CSS lives in `app/styles/index.css` and is imported once from
  `src/main.tsx`.
- `App.tsx` and `PlayMode.tsx` should become orchestration shells backed by
  hooks and smaller components.
- Play tab layout should use bounded CSS grid columns and internally scrolling
  panels so the board remains primary and side panels do not collapse the page.

## Pass 4: Domain/UI Separation

- Browser fetches belong in app clients.
- Pure engine and teaching modules must receive facts/eval dependencies through
  inputs or injected clients.
- Variation preview, export payloads, teaching arrows/LEDs, SAN/UCI conversion,
  and record/profile construction should move into pure helpers.
- Vite server bridges should be split out of `vite.config.ts` into testable
  proxy/process modules.

## Pass 5: Optimization And Modernization

- Promote modern engine features only after benchmark and correctness gates.
- Existing gated move-ordering features are validation work, not greenfield
  implementation work.
- Add lazy OODA reviewing as a follow-up optimization: cheap prefilter first,
  depth-24 Stockfish review only for likely meaningful disagreements.
- Any CVS feature registry change must bump version/hash, relabel datasets,
  retrain NNUE, and pass holdout validation.

## Verification

- Web: `npm test`, `npm run build`, and responsive manual smoke.
- Arena: mock/unit tests for depth defaults. Depth-24 Stockfish loops are too
  expensive for routine CI.
- Rust: `cargo fmt --check`, `cargo test`, and focused release tests where
  supported.

