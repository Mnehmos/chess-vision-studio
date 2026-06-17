# Chess Vision Studio Responsibilities

This document maps what each app layer owns, how data moves through the system,
which schemas are source-of-truth, how validation works, and which code files are
responsible for each part of the product.

## Apps Covered

The local workspace is a three-repo app constellation:

| Repo | Responsibility |
|---|---|
| `chess-vision-studio` | React/Vite app, UI/UX, local browser state, Stockfish grading orchestration, app-side teaching compiler, datasets, arena scripts, and optional LLM narration. |
| `../chess-vision-studio-engine` | TypeScript baseline engine package, exported as `@cvs/engine`; policy, value, search, benchmarks, and training-data helpers. |
| `../chess-vision-studio-rust-engine` | Native engine and deterministic chess-facts layer; bitboards, movegen, SEE, search, UCI, `analyze --serve`, and `TeachingFactBundleV1`. |

## Responsibility Contract

The core product rule is separation of claims:

| Layer | Owns | Must Not Own |
|---|---|---|
| React UI | User workflows, layout, panels, board interaction, visual overlays, local progress, and rendering already-validated facts. | New chess truth, hidden grading rules, or tactics that are not in a committed analysis object. |
| App pure engine (`engine/`) | PGN/FEN parsing, Stockfish-backed `MoveAnalysis`, feature summaries, saliency ranking, relation maps, app-side teaching topic classification, exports, and aggregation. | DOM, browser storage, network/process I/O, or raw Rust fact validation. |
| Vite dev server (`vite.config.ts`) | Local-only process bridges for Rust, native Stockfish, OpenAI proxy, and training jobs. | UI state or chess explanation policy. |
| Native Stockfish | Move grading: eval, depth, principal variation, best move, forced-move checks, and centipawn loss oracle. | Teaching language or deterministic board facts beyond its engine result. |
| Rust engine | Legal board truth, move legality, SEE, piece safety, captures, motifs, pins, pawn structure, king safety, hazards, deltas, provenance, and native search. | Prose, lesson topics, player-facing causal claims, or Stockfish grading. |
| Optional LLM | Rephrase committed `ExplanationPlan` or validated move/game facts. | Invent tactics, alter conclusions, or read unrestricted raw board state for teaching claims. |

If a layer cannot prove a claim, the UI should display "unavailable",
"uncomputed", or no committed topic. It should not silently treat missing data as
zero, equal, safe, or best.

## Runtime Flow

Analyze mode:

```text
PGN/FEN import
  -> engine/position.ts builds ParsedGame and PlyRecord[]
  -> Stockfish evaluates before/after positions
  -> engine/analyze.ts calls engine/saliency.ts to build MoveAnalysis
  -> app/cvs-engine-client.ts requests Rust TeachingFactBundleV1
  -> engine/teaching/compile.ts builds TeachingAnalysis and TeachingEvent[]
  -> engine/teaching/record.ts optionally packs TeachingRecordV1
  -> React renders board overlays, facts, teaching log, puzzles, review, export
```

Play mode:

```text
User move
  -> chess.js legality in PlayMode
  -> Stockfish/CVS opponent move if enabled
  -> same MoveAnalysis + TeachingFactBundleV1 + TeachingEvent path
  -> live TeachingLog, EngineComparisonPanel, review moments, and board overlays
```

Insights mode:

```text
Multi-game PGN
  -> ParsedGame[]
  -> analysis cache and feature extraction
  -> dataset / pattern / teaching profile aggregation
  -> DatasetPanel, DatasetAnalysisViz, AnalyticsPanel
```

Exports:

```text
Current screen state + all ply analyses + features + teaching records
  -> app/exportState.ts
  -> local JSON download
```

## Schemas

| Schema | File | Responsibility |
|---|---|---|
| `PositionState` | `engine/types.ts` | Current FEN, side to move, move number, and SAN legal moves. |
| `PlyRecord` / `ParsedGame` | `engine/position.ts` | PGN-derived half-move records, FEN before/after each move, headers, labels, and initial FEN. |
| `Eval` | `engine/types.ts` | Stockfish-style eval from side-to-move POV; explicit `status` prevents unavailable evals from becoming real zeroes. |
| `MoveAnalysis` | `engine/types.ts` | Central app seam for a reviewed ply: positions, SAN label, classification, evals, cp loss, ranked insights, headline, mate proof, confidence, and optional deep check. |
| `PlyFeatures` / `FeatureEntry` | `engine/features.ts` | Aggregatable per-ply feature summaries for mobility, threats, defense, SEE, pawn structure, motifs, patterns, and badges. |
| `TeachingFactsRequestV1` | `engine/teaching/types.ts` | App request to Rust facts engine; schema version, FEN before, played move, optional best/refutation/PV, and options. |
| `TeachingFactBundleV1` | `engine/teaching/types.ts`; Rust mirror in `../chess-vision-studio-rust-engine/src/facts/types.rs` | Deterministic Rust facts for `before`, `played`, optional `best`, optional `refutation`, provenance, and errors. |
| `FactCollection<T>` / `FactValue<T>` | `engine/teaching/types.ts` | Tagged computed/uncomputed/unavailable contract. Consumers must preserve the tag. |
| `TeachingAnalysis` / `TeachingEvent` | `engine/teaching/types.ts` | App-side committed lesson topics derived from Rust facts plus Stockfish grade. |
| `ExplanationPlan` | `engine/teaching/types.ts` | Evidence-gated deterministic lesson plan passed to UI and optional LLM narration. |
| `TeachingRecordV1` | `engine/teaching/record.ts` | Reproducible training row: analysis, facts, committed teaching, puzzle, outcome placeholder, and provenance. |
| `TeachingPuzzle` / `PuzzleStage` | `engine/teaching/puzzle.ts` | Puzzle stages generated from a committed event or best-move request. |
| `BoardExport` | `app/exportState.ts` | Complete local JSON snapshot of current board state plus every ply's analysis/features/teaching/commentary. |
| `CvsEngineAnalysis` | `app/cvs-engine-client.ts` | Native CVS engine search result: best UCI, score, mate, PV, depth, nodes, qnodes, telemetry, and errors. |
| `StockfishResult` | `app/stockfish-client.ts` | Native Stockfish result: best move, score, mate, UCI PV, and depth. |
| Dataset schemas | `engine/dataset.ts`, `engine/dataset-analytics.ts` | Multi-game record, openings, score splits, time buckets, coverage, worst moves, and aggregate analysis. |

## Validation Standards

- PGN and FEN parsing is fail-soft at import boundaries. Malformed games are
  skipped; one bad game must not block a multi-game import.
- `MoveAnalysis` is the object downstream UI consumes. UI should not recompute
  classifications, cp loss, or explanation headlines.
- UCI access is serialized per engine instance. Overlapping `go` commands corrupt
  a UCI stream, so `UciEngine` and the native server pools queue work.
- `Eval.status === 'unavailable'` must render as unknown/unclassified, not as
  `0.00`, `best`, or "solid".
- Rust facts must pass `isTeachingFactBundleV1` before the app consumes them.
- `FactCollection.status` must be checked before reading `items`. Empty
  `computed.items` means "validator ran and found none"; `uncomputed` and
  `unavailable` mean the question was not answered.
- Teaching topics are whitelist-based in `engine/teaching/registry.ts`. New
  action/mechanism combinations do not become UI lessons unless explicitly
  registered.
- Teaching compiler logic must fail closed. If a required fact collection is
  missing, uncomputed, unavailable, stale, or not causally supported by the
  Stockfish grade, no committed topic is emitted.
- Cache validity is provenance-based. Teaching records include teaching schema,
  facts registry, compiler version, engine identity, and Stockfish depths.
- Exports preserve unknown values. `app/exportState.ts` serializes uncomputed
  features/teaching explicitly instead of omitting them or replacing them with
  false data.
- Browser secrets never ship. `OPENAI_API_KEY` is read server-side by the Vite
  proxy; browser-side key entry is development-only.

## UI/UX Responsibilities

### Main Screens

| Screen | Primary files | Responsibility |
|---|---|---|
| Analyze | `app/App.tsx`, `app/Board2D.tsx`, `app/FactsPanel.tsx`, `app/TeachingLog.tsx`, `app/TeachingPanel.tsx` | Step through imported games, show board overlays, square facts, move grades, teaching cards, engine comparison, commentary, and export. |
| Insights | `app/DatasetPanel.tsx`, `app/DatasetAnalysisViz.tsx`, `app/AnalyticsPanel.tsx` | Aggregate many games into records, openings, accuracy, time buckets, patterns, teaching themes, and review moments. |
| Play | `app/PlayMode.tsx`, `app/TeachingLog.tsx`, `app/EngineComparisonPanel.tsx` | Local play against no engine, CVS Engine, or Stockfish with live teaching and review moments. |
| Training monitor | `app/TrainingMonitor.tsx`, `vite.config.ts` training supervisor | Start/stop local import/train jobs and stream status/logs through SSE. |
| Commentary | `app/CommentaryPanel.tsx`, `llm/*`, Vite OpenAI proxy | Optional narration over validated facts or explanation plans. |

### Board Interaction

- `Board2D` owns square rendering, orientation, click/drag move gestures, legal
  move dots, promotion prompt, LED coloring, and overlay arrows.
- `BoardArrows` owns the SVG arrow layer. Do not draw ad-hoc arrows inside board
  components.
- `modes.ts` is the display registry for mode labels and color meanings.
- `engine/led.ts` is the data registry for mode-specific 64-square `LedMap`
  generation. Each mode owns one color language.
- `annotate.ts` owns selection arrows and cascade behavior for direct and
  second-hop relationships.
- `FactsPanel` owns human-readable square facts. It should render facts and
  status, not invent missing facts.

### Visual Standards

- The board is the first-class object. Panels support inspection; they should not
  compete with the board for primary meaning.
- Every overlay color must be explainable through `MODES` and `LED_CSS`.
- A square color has one meaning inside a given mode. If a new mode needs a
  different meaning, add a mode rather than overloading an existing one.
- Teaching cards must use `TeachingEvent.plan` or `MoveAnalysis.topExplanation`.
  New prose should be derived from committed facts, not from raw board guesses.
- A refuted or unconfirmed tactic must be visually and verbally weaker than a
  confirmed one.
- Compact panels should use concise headings and stable row/card dimensions so
  grades, eval bars, and move labels do not jump during analysis.
- Empty, loading, unavailable, uncomputed, and computed-empty states should be
  visually distinct.
- Local-first behavior matters: imported games, cache, exports, and optional
  API keys stay on the user's machine unless explicitly sent through a configured
  local proxy.

## Dev Server APIs

These endpoints are mounted by custom Vite plugins in `vite.config.ts`.

| Endpoint | Method | Responsibility |
|---|---|---|
| `/api/openai/health` | GET | Reports whether the server-side OpenAI key is configured. |
| `/api/openai/chat/completions` | POST | Same-origin proxy to OpenAI; attaches `OPENAI_API_KEY` server-side. |
| `/api/cvs-engine/health` | GET | Checks native Rust engine path, depth, flags, and required weight files. |
| `/api/cvs-engine/analyze` | POST | Sends FEN, optional depth/movetime/forced move to `analyze --serve`. |
| `/api/cvs-engine/facts` | POST | Sends `TeachingFactsRequestV1` as a `cmd:"facts"` JSON line to Rust. |
| `/api/stockfish/health` | GET | Checks native Stockfish availability and default depth. |
| `/api/stockfish/analyze` | POST | Sends FEN, optional depth/movetime/forced move to pooled native Stockfish. |
| `/api/training/events` | GET | Server-sent event stream for training progress. |
| `/api/training/status` | GET | Current training supervisor status. |
| `/api/training/start` | POST | Starts import/train or train-only local job. |
| `/api/training/stop` | POST | Stops the current training process tree. |

Important environment variables:

| Variable | Responsibility |
|---|---|
| `CVS_RUST_EXE` | Native `analyze` binary for CVS search. |
| `CVS_RUST_FACTS_EXE` | Optional separate native binary for facts protocol. |
| `CVS_RUST_DEPTH` | Default CVS engine depth. |
| `CVS_RUST_BASE`, `CVS_RUST_RUNG2`, `CVS_RUST_NNUE`, `CVS_RUST_HELPER_NNUE` | Search/eval weight and NNUE inputs. |
| `CVS_RUST_*` feature flags | Search experiment flags passed to Rust. |
| `CVS_SF_EXE`, `CVS_SF_DEPTH`, `CVS_SF_POOL`, `CVS_SF_THREADS`, `CVS_SF_HASH` | Native Stockfish bridge settings. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | Server-side optional narrator configuration. |

## Web App File Map

### App Shell and UI

| File | Responsibility |
|---|---|
| `src/main.tsx` | React entry point; mounts `App`. |
| `src/vite-env.d.ts` | Vite type declarations. |
| `vite.config.ts` | Vite config plus local process/API bridges for OpenAI, Rust CVS Engine, native Stockfish, and training supervisor. |
| `app/App.tsx` | Main Analyze/Insights/Play shell, PGN import, selected game/ply state, caches, engine health, teaching facts, commentary, export, mode state, and board layout. |
| `app/PlayMode.tsx` | Standalone play workflow, opponent selection, move application, engine replies, live analysis, teaching facts, review moments, and play-mode board controls. |
| `app/Board2D.tsx` | Chessboard rendering, pieces, coordinates, click/drag moves, legal dots, promotions, LED map, and arrow overlay placement. |
| `app/BoardArrows.tsx` | Reusable SVG arrow layer for attacks, defenses, played moves, tactical lines, labels, and dashed arrows. |
| `app/modes.ts` | UI mode registry: labels, legend entries, and color CSS values for every board mode. |
| `app/AnnotationLegend.tsx` | Overlay legend for arrow/color semantics. |
| `app/AnnotationCommandList.tsx` | Compact list of annotation commands/actions. |
| `app/annotate.ts` | Selection and line arrow generation for occupied and empty squares. |
| `app/FactsPanel.tsx` | Square facts, attackers, defenders, SEE status, insight labels, and Rust facts surface. |
| `app/TeachingLog.tsx` | Chronological coach log, quality badges, eval bars, hanging notes, and per-turn teaching summary. |
| `app/TeachingPanel.tsx` | Per-move teaching card body, move idea display, mistake note, and opening card. |
| `app/TeachingNodeCard.tsx` | Card renderer for a compiled teaching node. |
| `app/PreviewTeachingCard.tsx` | Preview card for alternative line playback. |
| `app/TeachingPuzzle.tsx` | Interactive puzzle stages, UCI grading, board state, and feedback for punishment/prevention drills. |
| `app/TeachingFactsDebugPanel.tsx` | Developer/debug view of Rust teaching facts and schema output. |
| `app/MateCard.tsx` | Forced-mate proof card with line and obligation details. |
| `app/EngineComparisonPanel.tsx` | Stockfish vs CVS Engine comparison, eval formatting, agreement, nodes, and telemetry summary. |
| `app/AlternativeLinesPanel.tsx` | Alternative line list, PV formatting, quality labels, and hover/preview controls. |
| `app/AnalyticsPanel.tsx` | Game review UI: coach view, recurring themes, moments, data view, timelines, side splits, and teaching themes. |
| `app/DatasetPanel.tsx` | Insights shell for multi-game imports: records, openings, move explorer, games list, and analyzed marks. |
| `app/DatasetAnalysisViz.tsx` | Dataset analysis visualizations: coverage, time of day, side stats, teaching moments, and meters. |
| `app/CommentaryPanel.tsx` | Optional narration controls, API key/proxy status, and commentary job state. |
| `app/TrainingMonitor.tsx` | Training job controls and status/log rendering from the training supervisor endpoints. |
| `app/LedPreview.tsx` | LED map preview/debug rendering. |

### App Clients, State, and Export

| File | Responsibility |
|---|---|
| `app/cvs-engine-client.ts` | Browser client for `/api/cvs-engine/*`; validates facts schema before returning it. |
| `app/stockfish-client.ts` | Browser client for `/api/stockfish/*`; adapts native Stockfish HTTP results to `UciEngine.evaluate`. |
| `app/engine-browser.ts` | Browser Stockfish worker transport fallback. |
| `app/engine-pool.ts` | Fixed browser Stockfish worker pool for parallel analysis when native Stockfish is not used. |
| `app/analysis-store.ts` | IndexedDB persistence for analysis and teaching caches. |
| `app/arrow-analysis-store.ts` | Alternative-line and arrow-analysis state/helpers. |
| `app/exportState.ts` | Pure JSON snapshot builder plus browser download sinks. |
| `app/gif-export.ts` | GIF/image export workflow for board or line previews. |
| `app/gifenc.d.ts` | Local TypeScript declaration for `gifenc`. |

### Pure Analysis Engine

| File | Responsibility |
|---|---|
| `engine/types.ts` | Core app contracts: positions, relations, evals, insights, move analysis, mate proof, LED maps. |
| `engine/position.ts` | chess.js wrapper for FEN/PGN parsing, multi-game PGN splitting, `PlyRecord`, and `ParsedGame`. |
| `engine/evaluation.ts` | UCI transport abstraction, serialized UCI engine, fixed-depth evals, MultiPV, PV conversion, and info-line parsing. |
| `engine/analyze.ts` | Async orchestrator: Stockfish before/after evals, terminal handling, selective deep check, and game analysis loop. |
| `engine/classify.ts` | Eval-to-pawns, cp-loss computation, move classification, and grade helpers. |
| `engine/saliency.ts` | Pure `MoveAnalysis` producer; ranks validated candidate insights against the eval-loss budget. |
| `engine/deepcheck.ts` | Selective deeper re-search trigger and result reconciliation for forcing/sacrificial moves. |
| `engine/board.ts` | Lightweight FEN board parser, square math, piece lookup, and attack geometry. |
| `engine/relations.ts` | Attacker/defender maps and square control for one position. |
| `engine/relationship.ts` | Human-readable per-square report for the facts panel. |
| `engine/diff.ts` | Move-to-move relation changes and refutation/PV relationship candidates. |
| `engine/see.ts` | Static exchange evaluation, capture SEE, poisoned capture helpers, and material values. |
| `engine/motif.ts` | Validated available motif detection used by overlays and saliency. |
| `engine/tier2.ts` | Tier-2 tactical motif helpers/experiments. |
| `engine/detectall.ts` | Broad motif detection wrapper. |
| `engine/tacticmoves.ts` | Tactical move enumeration helpers. |
| `engine/tacticsearch.ts` | Tactical line search helpers. |
| `engine/threats.ts` | Threat-oriented feature/detection helpers. |
| `engine/proof.ts` | Proof helpers for validated tactical claims. |
| `engine/matesolver.ts` | Mate search helpers. |
| `engine/mateproof.ts` | Converts oracle mate line into a `MateProof`. |
| `engine/explain.ts` | Deterministic rendering of `InsightCandidate` objects to text. |
| `engine/features.ts` | Per-ply feature extraction, summaries, pattern detection, profiles, and quarantine behavior. |
| `engine/control-lens.ts` | Control-lens hazard/obligation model and teaching line synthesis. |
| `engine/led.ts` | Mode-scoped `LedMap` generation for legal, threat, defense, hanging, what-changed, pawn, and tactics modes. |
| `engine/analytics.ts` | Single-game stats, accuracy, worst moves, and side aggregates. |
| `engine/dataset.ts` | Multi-game dataset summaries, hero detection, opening records, and interesting games. |
| `engine/dataset-analytics.ts` | Dataset-wide coverage, time buckets, side accuracy, and worst moves from analysis cache. |
| `engine/repertoire.ts` | Opening tree and move explorer statistics. |
| `engine/repetition.ts` | Repetition/conversion warning helpers. |
| `engine/stockfish-node.ts` | Node-side Stockfish process transport. |
| `engine/adapters/uci-line.ts` | UCI-line adapter utilities. |
| `engine/benchmark/seed.ts` | Benchmark seed cases. |
| `engine/benchmark/puzzles.ts` | Benchmark puzzle cases. |

### Teaching Compiler

| File | Responsibility |
|---|---|
| `engine/teaching/types.ts` | Teaching facts schema mirror, type guards, event schema, topic/action/mechanism types, and `ExplanationPlan`. |
| `engine/teaching/registry.ts` | Topic metadata and action/mechanism whitelist. |
| `engine/teaching/compile.ts` | Compiles Rust facts plus Stockfish grade into committed teaching events. |
| `engine/teaching/counterfactual.ts` | Compares played-vs-best fact deltas for causal support. |
| `engine/teaching/evidence.ts` | Fact refs, stable event IDs, and evidence identity helpers. |
| `engine/teaching/render.ts` | Deterministic, evidence-gated `ExplanationPlan` rendering. |
| `engine/teaching/saliency.ts` | Teaching-event saliency scoring per topic. |
| `engine/teaching/record.ts` | Builds `TeachingRecordV1`, cache signatures, provenance, and freshness checks. |
| `engine/teaching/puzzle.ts` | Builds and grades teaching puzzles and alternative prevention solutions. |
| `engine/teaching/profile.ts` | Aggregates committed teaching events into player/dataset profiles. |
| `engine/teaching/node.ts` | Teaching-node abstraction and node construction helpers. |
| `engine/teaching/moveIdea.ts` | Move-idea descriptions used by teaching cards. |
| `engine/teaching/openings.ts` | Opening detection and opening-plan copy. |
| `engine/teaching/audit.ts` | Teaching corpus audit helpers. |

### LLM Narration

| File | Responsibility |
|---|---|
| `llm/env.ts` | Local `.env` loading for LLM scripts. |
| `llm/openai.ts` | Minimal chat client abstraction and OpenAI implementation. |
| `llm/narrate.ts` | Per-move and teaching-plan prompt construction plus narration calls. |
| `llm/game.ts` | Whole-game narration prompt construction and deterministic draft fallback. |
| `llm/batch.ts` | Batch narration over plies. |
| `llm/run.ts` | CLI runner for commentary generation. |
| `llm/README.md` | Narration usage notes. |

### Arena, Training, and Bot Scripts

| File or folder | Responsibility |
|---|---|
| `arena/engine-backend/*` | Shared engine-backend abstraction for TS legacy engine and Rust backend. |
| `arena/gauntlet/*` | Stockfish opponent, Rust engine wrappers, gauntlet play/score/analyze/digest scripts, and run reports. |
| `arena/lichess/*` | Lichess account/client/session/import/harvest/bot run policy, picker, ponder, and upgrade flow. |
| `arena/chessbench-import.ts` | Import ChessBench-style data. |
| `arena/bench-search.ts` | Search benchmark runner. |
| `arena/dataset.ts` | Dataset helpers for arena scripts. |
| `arena/disagree.ts` | Disagreement inspection between engines/labels. |
| `arena/eval-*.ts` | Eval matrix/value/r4 gate scripts. |
| `arena/export-eval-fixtures.ts` | Fixture export for eval parity. |
| `arena/forensic-*.ts` | Loss/blunder forensic analysis scripts. |
| `arena/match.ts`, `arena/players.ts`, `arena/review.ts` | Match play, player adapters, and game review helpers. |
| `arena/ooda.ts` | OODA-style improvement loop runner. |
| `arena/perft-chessjs.ts` | chess.js perft reference runner. |
| `arena/pv-attribution.ts` | Principal-variation attribution analysis. |
| `arena/quality.ts` | Quality report utilities. |
| `arena/relabel-evals.ts` | Stockfish relabeling and top-move dataset enrichment. |
| `arena/rung2-dump.ts` | Rung-2 feature dump for a FEN. |
| `arena/sf-cache.ts` | Stockfish cache pool. |
| `arena/teaching-audit.ts`, `arena/teaching-replay.ts` | Teaching corpus audit and replay scripts. |
| `arena/train-*.ts` | Dataset, policy/value/ranking/mixed/Rung-3/2B training loops. |

### Tests

Tests are colocated by surface:

| Pattern | Responsibility |
|---|---|
| `app/*.test.tsx`, `app/*.test.ts` | React behavior, export structure, app clients, panels, puzzles, and UI helpers. |
| `engine/__tests__/*.test.ts` | Pure analysis, relationships, saliency, tactics, SEE, datasets, and benchmark behavior. |
| `engine/teaching/__tests__/*.test.ts` | Topic detectors, fixtures, records, puzzles, profiles, and hard negatives. |
| `arena/__tests__/*.test.ts` | Arena backend, Lichess import, and integration coverage. |
| `llm/__tests__/*.test.ts` | Prompt/narration behavior. |

## Change Standards

When adding a new board mode:

1. Add the data behavior in `engine/led.ts`.
2. Add the label and legend in `app/modes.ts`.
3. Ensure `Board2D` can render the resulting `LedMap` without layout changes.
4. Add tests for the pure `LedMap` behavior.

When adding a new teaching topic:

1. Add deterministic facts in Rust first if the topic needs new chess truth.
2. Mirror any schema additions in `engine/teaching/types.ts`.
3. Add topic metadata and whitelist entry in `engine/teaching/registry.ts`.
4. Add compiler detection in `engine/teaching/compile.ts`.
5. Add evidence helpers/rendering/saliency as needed.
6. Add golden fixtures and hard-negative tests.
7. Bump `TEACHING_COMPILER_VERSION` if cached records become stale.

When changing schemas:

1. Prefer additive fields when possible.
2. Increment facts registry when fact meaning or validator behavior changes.
3. Increment schema version for required-field, rename, or tagged-union changes.
4. Update Rust and TypeScript mirrors together.
5. Update fixtures and freshness/provenance checks.

When adding UI copy:

1. Derive the copy from `MoveAnalysis`, `TeachingEvent.plan`, or a named schema.
2. Keep unknown/unavailable states explicit.
3. Avoid phrases that imply certainty unless proof attribution supports it.

## Local Verification

Use focused checks while editing:

```bash
npm test
npm run build
npx vitest run app
npx vitest run engine
npx vitest run engine/teaching
npx vitest run arena
```

Rust engine checks live in the sibling repo:

```bash
cd ../chess-vision-studio-rust-engine
cargo fmt
cargo test
cargo test --release
```

