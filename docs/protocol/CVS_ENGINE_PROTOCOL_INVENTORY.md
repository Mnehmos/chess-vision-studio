# CVS Engine Protocol Inventory (AnalysisFrameV2 PR-00)

**Purpose.** A checked-in, machine-verifiable record of the CVS Rust `analyze`
binary's wire protocol as it exists today, plus a field-by-field audit against the
TypeScript types that consume it. This freezes the V1 contract so later
AnalysisFrameV2 PRs can detect drift. **PR-00 changes no engine/app behavior** — it
adds only documentation, golden fixtures, a capture script, and contract tests.
(The one repository-management action — consolidating `master` to `develop` — is
recorded in §0.2.)

This document is the authority for *what the protocol is*. The golden fixtures in
[`fixtures/cvs-engine/`](../../fixtures/cvs-engine/) are the authority for *what
the bytes look like*. The contract test
[`app/__tests__/cvs-engine-contract.test.ts`](../../app/__tests__/cvs-engine-contract.test.ts)
makes both enforceable.

---

## 0. Provenance, baseline, and the master ↔ develop consolidation

### 0.1 Commit SHAs at capture time (plan §15.3)

| Repo | Branch | SHA | Role |
|---|---|---|---|
| `chess-vision-studio` (app) | `master` | `6e552c2` | **PR-00 branch base** (`cvs/frame-00-protocol-fixtures` forks from here) |
| `chess-vision-studio` (app) | `checkpoint/visual-redesign-and-rsi-tooling` | `637b4c0` | In-flight UI + arena RSI tooling |
| `chess-vision-studio-rust-engine` | `master` (after consolidation) | `f90a588` | **Fixture capture baseline** (was `f25c7b1`; fast-forwarded to `develop` — see §0.2) |
| `chess-vision-studio-rust-engine` | `develop` | `f90a588` | Now identical to `master` |
| `chess-vision-studio-rust-engine` | `engine/iid-ordering-bug2` | `287b3b0` | Source of the **running Lichess-bot binary**; = `master` + experimental `iidSearches`/`iidFound` telemetry only |

### 0.2 Baseline consolidation (master ← develop)

At handoff, the Rust repo's `master` (`f25c7b1`) was **23 commits behind
`develop`** (`f90a588`); `master` was a strict ancestor (`master...develop` =
`0 23`). Per operator instruction, `master` was **fast-forwarded to `develop`**
(`git merge --ff-only develop`) so the golden contract reflects the *current*
engine, not a stale subset. This was a clean fast-forward (no merge commit, no
conflicts) and preserves all of `develop`'s work.

- **Local only.** `origin/master` was **not** pushed (publishing the default
  branch is left as an explicit operator step). Locally, `master == develop ==
  f90a588`.
- **Reversible.** `git branch -f master f25c7b1` restores the prior `master`.
- **iid telemetry stays excluded.** `iidSearches`/`iidFound` live only on
  `engine/iid-ordering-bug2`, not on `develop`/`master`. The running bot binary is
  `master + iid`; the golden contract is `master` alone. The contract test asserts
  the iid fields are **absent** so they can never silently enter the frozen V1
  contract.
- **Facts unaffected.** `src/facts/types.rs` and `src/facts/move_bundle.rs` were
  byte-identical on the old `master` and `develop`; facts registry version is `5`
  on both.

### 0.3 Capture method

Captured by [`arena/capture-cvs-protocol.ts`](../../arena/capture-cvs-protocol.ts)
driving a freshly built `master` (`f90a588`) binary in `--serve --depth 12` mode
with the **default evaluator** (no `--base`/`--rung2`/`--nnue`), so the capture is
reproducible from a clean checkout with no trained-model files. Production loads
trained weights, which change numeric values but **not** the schema.

Only `timeMs` (top-level mirror, `telemetry.timeMs`, and each `iterations[].timeMs`)
is sanitized to `0`; it is the sole wall-clock-nondeterministic field. At fixed
depth on a single thread all other fields are deterministic for a given binary
build. Exception: `search-fixedtime-v1.json` comes from a time-budgeted `go`
request, so its `depth`/`nodes`/telemetry counters vary by machine — that fixture
is **schema-authoritative, not value-stable**, and the contract test asserts only
its shape.

---

## 1. CLI flags (consolidated `analyze` binary)

`analyze (--fens <file> | --serve) --depth N [...]`. One of `--fens` or `--serve`
is required; `--depth` is required (the binary panics without it). Search-feature
toggles are parsed by `SearchOptions::with_cli_flags` and accept **both polarities**
(positive opt-in and `--no-*` opt-out), which reconciles the proxy's flag
vocabulary (§9.2).

### 1.1 Mode / configuration

| Flag | Arg | Meaning |
|---|---|---|
| `--serve` | — | Serial stdin→stdout loop: one request line → one JSON response line |
| `--fens <file>` | path | Batch: search every FEN in the file, one JSON line each |
| `--depth <N>` | u32 | **Required.** Search depth (also the cap for time-budgeted searches) |
| `--base <w.json>` | path | Value-head weights (defaults to built-in `ValueWeights`) |
| `--rung2 <r.json>` | path | Rung-2 weights (optional) |
| `--nnue <path>` | path | NNUE model; enables `nnueStmCp`/`nnue` identity fields |
| `--helper-nnue <path>` | path | Helper/ranker NNUE for root move ordering |
| `--allow-unverified-net` | — | Permit loading an unverified NNUE (skips hash check) |
| `--syzygy <path>` / `--no-syzygy` | path | Tablebase path / disable |
| `--book <path>` / `--no-book` / `--book-enabled` | path | Opening book / disable / enable |
| `--movetime <ms>` | u64 | Global wall-clock cap (equal-clock matches) |
| `--danger` | — | Danger-triggered root depth extension (gated) |
| `--threads <N>` | usize | SMP thread count (default 1) |
| `--lane <king\|see\|tactics\|defender\|quietdef\|pawn>` | enum | Run as a specialist lane |
| `--cvs-helpers <N>` | u32 | CVS helper count |
| `--cvs-trace` / `--cvs-core-trace` | — | Enable CVS / CVS-core trace feature counting |

### 1.2 Batch-only extraction modes

| Flag | Meaning |
|---|---|
| `--features` | Emit eval + Rung-2 feature vector per FEN |
| `--cvs-ids` | Emit comma-separated active CVS feature IDs per FEN |
| `--cvs-core-ids` | Emit comma-separated active CVS-core feature IDs per FEN |
| `--cvs-deltas` | Per-FEN quiet-move delta/anchor feature extraction (requires `--nnue`) |

### 1.3 Search feature toggles (`with_cli_flags`, both polarities)

Positive opt-in: `--quiet-checks`, `--null`, `--lmr`, `--pvs`, `--rfp`,
`--futility`, `--lmp`, `--seeprune`, `--delta`, `--countermove`, `--conthist`,
`--tt-prune-store`, `--qtt`, `--histmalus`, `--histlmr`, `--caphist`, `--tt2`,
`--improving`, `--king-activity`, `--rule50`, `--singular`, `--cvs-bonus`,
`--shuffled-geometry`, `--root-diagnostics`. Each has a `--no-*` opt-out form.
Also `--no-tt`. (Effective defaults are recorded in the `identity` fixture's
`options` object — §8.3.) The PR-00 fixtures were captured with **no feature
flags** (defaults).

---

## 2. Serve mode — text commands

Each line is one request; the binary replies with exactly one JSON line and
flushes. A blank line is skipped; `quit` exits.

| Text line | Response schema | Fixture |
|---|---|---|
| `<fen>` | Search (`analyze_one` shape) | `search-v1.json` |
| `go <ms> <fen>` | Search (`search_pos` shape), wall-clock budget `<ms>` | `search-fixedtime-v1.json` |
| `eval <fen>` | Eval | `eval-v1.json` |
| `cvs <fen>` | CVS feature dump | `cvs-features-v1.json` |
| `quit` | — (exits loop) | — |

`startpos` is **not** special-cased on the bare-FEN text path (only inside JSON
requests); pass a full FEN.

## 3. Serve mode — JSON commands

A line beginning with `{` is parsed as a `ServeJsonRequest`. The `cmd` field
selects behavior; absent/unknown `cmd` defaults to `analyze`.

| `cmd` | Behavior | Response schema | Fixture |
|---|---|---|---|
| `"analyze"` (or absent) | Fixed-depth search of the request position | Search (`search_pos` shape) | `search-forced-v1.json`, `search-history-v1.json` |
| `"go"` | Time-budgeted search (`budgetMs`, default 500) | Search (`search_pos` shape) | — (same shape as `search-fixedtime`) |
| `"eval"` | Static eval | Eval | — (same shape as `eval-v1.json`) |
| `"facts"` | Teaching fact bundle | `TeachingFactBundleV1` | `facts-v1.json` |
| `"identity"` | Engine identity + resolved search options + NNUE hashes | Identity | `identity-v1.json` |

### 3.1 `ServeJsonRequest` fields (the wire request shape)

`#[serde(rename_all = "camelCase")]`. All fields optional at the serde layer;
requirements are per-`cmd`.

| Wire field | Type | Used by | Notes |
|---|---|---|---|
| `cmd` | string | all | selector |
| `fen` | string | analyze/go/eval | bare position; `"startpos"`/absent → standard start |
| `initialFen` | string | analyze/go | history root; `"startpos"`/absent → standard start |
| `moves` | string[] | analyze/go | **UCI** history replayed from `initialFen` (wire name is `moves`, **not** `moveHistory`) |
| `budgetMs` | u64 | go | wall-clock budget (default 500) |
| `forcedMoveUci` | string | analyze/go | restrict search root to this one legal move |
| `schemaVersion` | u32 | facts | **required for facts** (must be `1`) |
| `fenBefore` | string | facts | **required for facts** |
| `playedMoveUci` | string | facts | **required for facts** |
| `bestMoveUci` | string | facts | optional counterfactual branch |
| `refutationUci` | string | facts | optional counterfactual branch |
| `principalVariationUci` | string[] | facts | optional; validated, errors recorded |
| `options` | `{includeMotifOpportunities, includeCounterfactual}` | facts | `includeCounterfactual` defaults **true** |

### 3.2 Request-field requirements by command

- **Search (analyze/go, text or JSON):** a position — either `fen`, or
  `initialFen` + `moves`. History is validated by replay inside the engine
  (`Position::from_fen_with_uci_history`); an illegal move yields an `error`
  response.
- **`forcedMoveUci`:** must be legal in the (post-history) position, else
  `{"fen":..., "error":"forced move ... is illegal ..."}`.
- **`facts`:** `schemaVersion` (=1), `fenBefore`, `playedMoveUci` required; rest
  optional.

### 3.3 Echo-FEN quirk (document, do not "fix")

For history requests the response `fen` echoes the **requested `fen` (or
`initialFen`)**, *not* the derived current position. `search-history-v1.json` was
requested with `initialFen:"startpos"` + `["e2e4","e7e5","g1f3","b8c6"]`; the
response `fen` is the **start position**, while `uci`/`pv`/`scoreCp` reflect the
position *after* those moves. Identity consumers (PR-01/PR-04) must derive the
analyzed FEN from `initialFen`+`moves`, not from the echoed `fen`.

---

## 4. Response schemas

| Schema name | Emitted by | TS consumer type | Fixture |
|---|---|---|---|
| Search `analyze_one` shape | bare-FEN text, `--fens` batch | `CvsEngineAnalysis` (subset) | `search-v1.json` |
| Search `search_pos`/`go` shape | `go <ms>` text, JSON analyze/go | `CvsEngineAnalysis` (subset) | `search-fixedtime/forced/history-v1.json` |
| Eval | `eval` text, `cmd:eval` | *(none yet — PR-12)* | `eval-v1.json` |
| CVS feature dump | `cvs` text | *(none yet — PR-12)* | `cvs-features-v1.json` |
| Identity | `cmd:identity` | *(none yet — PR-12)* | `identity-v1.json` |
| `TeachingFactBundleV1` | `cmd:facts` | `TeachingFactBundleV1` + `isTeachingFactBundleV1` | `facts-v1.json` |
| Error | any failure | inline `{error}` handling | — |

Both search shapes carry the full `telemetry` object plus the shared fields
`iterations, rootOrder, attemptedDepth, termination, resultSource,
partialIteration`, and satisfy `CvsEngineAnalysis`. They differ only in which
**top-level mirror counters** they include:

- `analyze_one` adds: `qCaptures, quietExt, cutoffs, killerCutoffs, historyCutoffs, nullCutoffs`
- `search_pos`/`go` add: `foreignHints, foreignCutoffs`

The proxy selects the shape by request form: bare FEN → `analyze_one`; `go <ms>`
or any JSON request → `search_pos`.

**Search-result metadata field semantics:**

| Field | Type | Notes |
|---|---|---|
| `attemptedDepth` | number | deepest iteration attempted (≥ `depth`) |
| `termination` | string | e.g. `depth-limit`, `hard-time` |
| `resultSource` | string | e.g. `completed-iteration`, `partial-iteration` |
| `rootOrder` | string[] | final root move ordering (UCI) |
| `iterations` | `{depth,uci,scoreCp,nodes,timeMs,pv}[]` | per-depth iteration log |
| `partialIteration` | object \| null | non-null only when the last iteration was interrupted; carries `alpha/beta/rootOrder/completedCandidates/provisionalBest/...` |

---

## 5. Audit table A — Search JSON vs `CvsEngineAnalysis`

`CvsEngineAnalysis` ([`app/cvs-engine-client.ts`](../../app/cvs-engine-client.ts)).
✅ = present in **both** shapes.

| `CvsEngineAnalysis` field | TS type | Rust JSON key | Present | Notes |
|---|---|---|---|---|
| `fen` | string | `fen` | ✅ | echoed request FEN (see §3.3) |
| `uci` | string \| null | `uci` | ✅ | `null` if no legal move (terminal) |
| `scoreCp` | number | `scoreCp` | ✅ | side-to-move POV centipawns |
| `mate` | number \| null | `mate` | ✅ | `null` when not mate |
| `pv` | string[] | `pv` | ✅ | UCI |
| `depth` | number | `depth` | ✅ | reached depth |
| `nodes` | number | `nodes` | ✅ | |
| `qNodes` | number | `qNodes` | ✅ | |
| `ttHits` | number | `ttHits` | ✅ | |
| `timeMs` | number | `timeMs` | ✅ | sanitized to 0 in fixtures |
| `telemetry?` | `CvsEngineTelemetry` | `telemetry` | ✅ | full 61-key object (Table C) |
| `error?` | string | `error` | (error path only) | present only on failures |

**Rust fields emitted but NOT yet in `CvsEngineAnalysis`** (ignored by the current
TS client; candidates for PR-11/PR-15 typing):
- Both shapes: `iterations, rootOrder, attemptedDepth, termination, resultSource, partialIteration`
- `analyze_one` only: `qCaptures, quietExt, cutoffs, killerCutoffs, historyCutoffs, nullCutoffs`
- `search_pos`/`go` only: `foreignHints, foreignCutoffs`

No required `CvsEngineAnalysis` field is missing from the binary output. ✔

---

## 6. Audit table B — Facts JSON vs `TeachingFactBundleV1`

Rust `src/facts/types.rs` (`#[serde(rename_all="camelCase")]`) vs
[`engine/teaching/types.ts`](../../engine/teaching/types.ts). The two are
**field-for-field aligned**; spot-checked against `facts-v1.json`.

| Bundle field | TS type | Rust source | Notes |
|---|---|---|---|
| `schemaVersion` | `1` | `schema_version: u32` | =1 |
| `fenBefore` | string | `fen_before` | |
| `before` | `PositionFacts` | `before` | |
| `played` | `MoveStateFacts` | `played` | |
| `best?` | `MoveStateFacts` | `best: Option` | `skip_serializing_if None` → optional in TS |
| `refutation?` | `MoveStateFacts` | `refutation: Option` | optional |
| `provenance` | `FactsProvenance` | `provenance` | `factsRegistryVersion = 5` (== TS `TEACHING_FACTS_REGISTRY_VERSION`) |
| `errors` | `FactError[]` | `errors: Vec` | `[]` on success |

Nested-shape confirmations from the fixture:
- **`FactCollection<T>`** → tagged union on `status`:
  `{status:"computed",items:[…]}` / `{status:"uncomputed",reason}` /
  `{status:"unavailable",reason}` — matches the TS union and `isFactCollection`.
- **`FactValue<T>`** (e.g. `PieceFact.see`): `{status:"computed",value:{…}}` —
  matches.
- **`PieceFact`** flattens `PieceRef` (`#[serde(flatten)]`): `id, side, pieceType,
  square` appear alongside `attackers, defenders, attackerCount, defenderCount,
  attacked, loose, see, onlyDefenderOf` — matches.
- **`MoveStateFacts.move`**: Rust `r#move` → wire `move` → TS `move`.
- **`deltas`**: `createdHazards, removedHazards, worsenedHazards,
  createdStructures, removedStructures` — matches.
- Optional-when-absent (serde `skip_serializing_if`): `promotion`,
  `magnitudeCp`, `moveUci`, `see.bestCaptureUci`, `see.scoreCp`,
  `provenance.engineCommit` — all optional in TS. `engineCommit` is omitted here
  because `CVS_ENGINE_COMMIT` was unset at build time.

`isTeachingFactBundleV1(facts-v1.json)` returns **true** (asserted by the contract
test). ✔ Protocol is additive-only (invariant §3.5); **do not rename `best`**.

> **Two distinct "registry version" numbers — do not conflate:**
> `provenance.factsRegistryVersion = 5` (teaching-facts registry) vs the `cvs`
> dump's `registryVersion = 1` (CVS-NNUE feature registry, §8.1).

---

## 7. Audit table C — Telemetry JSON vs `CvsEngineTelemetry`

The `telemetry` object emits **61 keys**. `CvsEngineTelemetry`
([`app/cvs-engine-client.ts`](../../app/cvs-engine-client.ts)) types only **7**
(derived percentages/averages). The remaining 54 are emitted but untyped — the
contract gap PR-11 will close.

**Typed by `CvsEngineTelemetry` (7):** `qNodePct`, `ttHitPct`, `rfpCutoffPct`,
`futilitySkipPct`, `firstMoveCutoffPct`, `avgCutoffMoveIndex`,
`searchedEffectiveBranching`. All present with `number` type. ✔

**Emitted but untyped (54):** `aspirationResearches, avgLegalMoves,
branchingByPly, cutoffMoveIndexCount, cutoffMoveIndexSum, cutoffs,
dangerExtensionPlies, deltaAttempts, deltaSkipPct, deltaSkips, firstMoveCutoffs,
foreignCutoffs, foreignHints, futilityAttempts, futilitySkips, hashMoveCutoffPct,
hashMoveCutoffs, historyCutoffs, killerCutoffs, legalMoveNodes, legalMoveSum,
lmpAttempts, lmpSkipPct, lmpSkips, lmrReductions, lmrResearchPct, lmrResearches,
mainNodes, maxQDepth, nodes, nullAttempts, nullCutoffPct, nullCutoffs,
prunedMoves, pvsResearches, qCaptures, qNodes, qSeeSkips, quietExt, rfpAttempts,
rfpCutoffs, searchedMoves, seePruneAttempts, seePruneSkipPct, seePruneSkips,
timeMs, ttCutoffPct, ttCutoffs, ttEntries, ttEntryPct, ttHits, ttMissCold,
ttMissContended, ttProbes`.

`branchingByPly` is an array of `{ply, nodes, childSearches, effectiveBranching}`
(only non-empty plies; ascending `ply`).

> **Not present on `master`/`develop`:** `iidSearches`, `iidFound` (only on
> `engine/iid-ordering-bug2`). The contract test asserts they are **absent** so the
> experimental fields can never silently enter the frozen V1 telemetry contract.

### 8.1 CVS feature dump (`cvs <fen>`)

| Key | Type | Notes |
|---|---|---|
| `fen` | string | |
| `registryVersion` | number | CVS-NNUE feature registry (=1); **≠** facts registry |
| `registryHash` | string | 16-hex registry hash |
| `inputDim` | number | model input dimension (=168) |
| `activeIds` | number[] | active CVS feature IDs (fixture uses Kiwipete → non-empty) |
| `activeNames` | string[] | human-readable names, index-aligned with `activeIds` |

### 8.2 Eval (`eval <fen>` / `cmd:eval`)

| Key | Type | Notes |
|---|---|---|
| `fen` | string | |
| `evalWhiteCp` | number | White-POV classical eval |
| `nnueStmCp` | number | **only present when `--nnue` is loaded** (absent in fixture) |

### 8.3 Identity (`cmd:identity`)

| Key | Type | Notes |
|---|---|---|
| `engine` | string | `cvs-bitboard-core` |
| `depth` | number | configured `--depth` |
| `options` | object | 30 resolved `SearchOptions` (booleans/numbers): `quietChecks, useTt, dangerExtension, nullMove, lmr, pvs, rfp, futility, lmp, seePrune, deltaPrune, countermove, continuationHistory, ttPruneStore, rule50Scale, qsearchTt, historyMalus, historyLmr, captureHistory, tt2, improving, kingActivity, threads, cvsBonus, shuffledGeometry, cvsHelpers, singular, syzygy, book, rootDiagnostics` |
| `nnue` | object \| null | `{modelHash, registryHash, ranker}` when `--nnue` set, else `null` |
| `helperNnue` | object \| null | as above for the helper net |
| `helperPolicy` | object \| null | ordering-policy descriptor when a helper net is loaded |

---

## 9. Discrepancies, stop-condition notes, and deferred work

### 9.1 master vs develop wire-schema delta — RESOLVED

`master` was fast-forwarded to `develop` (§0.2); they are now identical
(`f90a588`). The previously-flagged subset gap (master lacked `iterations`,
`rootOrder`, `attemptedDepth`, `termination`, `resultSource`, `partialIteration`,
`cmd:identity`, `--cvs-deltas`, `--cvs-core-ids`) no longer exists — those fields
are now in the baseline and captured here.

### 9.2 CLI flag-polarity drift — RESOLVED

The consolidated binary parses feature toggles via
`SearchOptions::with_cli_flags`, which accepts **both** the proxy's positive
opt-in flags (`--futility`, `--rfp`, …, `--allow-unverified-net`) and the `--no-*`
opt-out forms. The proxy
([`arena/dev-server/cvs-engine-proxy.ts`](../../arena/dev-server/cvs-engine-proxy.ts))
is therefore compatible with this baseline.

### 9.3 Two search response shapes (unchanged)

Documented in §4. Both satisfy `CvsEngineAnalysis`. A consumer must not assume the
`analyze_one` mirror counters exist on the JSON/`go` path, nor that
`foreignHints`/`foreignCutoffs` exist top-level on the bare-FEN path. Both shapes
always carry the full `telemetry` object and the shared metadata fields.

### 9.4 Remaining delta vs the running bot binary

The deployed Lichess-bot binary is `engine/iid-ordering-bug2` =
`master` + the experimental telemetry fields `iidSearches`/`iidFound` **only**.
The golden contract intentionally excludes them; the contract test guards their
absence. No other wire difference exists.

### 9.5 Confirmations requested by the handoff (verified, unchanged)

- History wire fields are **`initialFen`** + **`moves`** (not `moveHistory`). ✔
- Serve forms: text **`go <ms> <fen>`** and JSON
  **`{"cmd":"go","budgetMs":N,"fen":...,"initialFen":...,"moves":[...]}`**. ✔
- Review depths are context-specific and **must not be conflated**:
  `engine/analyze.ts` default **14**, selective deep **22**, arena **24**. These
  are app-side review settings, independent of this binary's `--depth` (the
  fixtures use depth 12 purely for capture).

### 9.6 No stop-condition triggered

The binary output matches the documented V1 protocol in shape. The branch
staleness precondition was resolved by consolidation (§0.2), recorded here.

### 9.7 Deferred to later PRs

- Type the full 61-key telemetry object (`CvsSearchTelemetryV2`) — **PR-11**.
- Type eval / CVS feature dump / identity; decide on a combined `inspect` JSON
  command — **PR-12**.
- History-aware client/proxy request fields (`initialFen`/`moves`) — **PR-04**
  (today's `analyzeWithCvsEngine` posts only `{fen, depth, forcedMove}`).
- Type the new search metadata fields (`iterations`, `partialIteration`, …) into
  the frame search result — **PR-11/PR-15**.
- Push consolidated `master` to `origin` (operator decision).

---

## 10. Golden fixtures index & regeneration

| Fixture | Command captured | Shape |
|---|---|---|
| `search-v1.json` | bare FEN (`analyze_one`) | Search (analyze_one) |
| `search-fixedtime-v1.json` | `go 200 <fen>` | Search (search_pos) — **schema-only** |
| `search-forced-v1.json` | `{cmd:analyze, forcedMoveUci:e2e4}` | Search (search_pos) |
| `search-history-v1.json` | `{cmd:analyze, initialFen:startpos, moves:[…]}` | Search (search_pos) |
| `eval-v1.json` | `eval <fen>` | Eval |
| `cvs-features-v1.json` | `cvs <Kiwipete>` | CVS feature dump |
| `identity-v1.json` | `{cmd:identity}` | Identity |
| `facts-v1.json` | `{cmd:facts, …, options:{motifs,counterfactual}}` | `TeachingFactBundleV1` |

**Regenerate** (requires a built binary):

```bash
npx vite-node arena/capture-cvs-protocol.ts -- \
  --exe ../chess-vision-studio-rust-engine/target/release/analyze.exe \
  --depth 12 --out fixtures/cvs-engine
```

Then run `npm test` — the contract test fails if any required field changed type
or disappeared.
