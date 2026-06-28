# PR-00 — Protocol capture and golden inventory (summary)

Per the AnalysisFrameV2 plan's per-PR checklist (§1).

## Single behavior changed
**None** in app or engine code. This PR adds only documentation, golden fixtures,
a capture script, and contract tests. (One repo-management action: rust `master`
was fast-forwarded to `develop` — see the inventory §0.2.)

## Source / target contracts
- **Source of truth:** the consolidated CVS Rust `analyze` binary
  (`chess-vision-studio-rust-engine` `master` == `develop` == `f90a588`), serve
  mode, default evaluator.
- **Captured contracts:** search (two shapes), eval, CVS feature dump, identity,
  and `TeachingFactBundleV1` (with counterfactual branches).
- **Audited against:** `CvsEngineAnalysis`, `CvsEngineTelemetry`
  (`app/cvs-engine-client.ts`) and `TeachingFactBundleV1` /
  `isTeachingFactBundleV1` (`engine/teaching/types.ts`).
- Full inventory + field-by-field audit tables:
  [`docs/protocol/CVS_ENGINE_PROTOCOL_INVENTORY.md`](./CVS_ENGINE_PROTOCOL_INVENTORY.md).

## Files added (docs / fixtures / scripts / tests only)
- `docs/protocol/CVS_ENGINE_PROTOCOL_INVENTORY.md`
- `docs/protocol/PR00-SUMMARY.md`
- `arena/capture-cvs-protocol.ts`
- `fixtures/cvs-engine/{search,search-fixedtime,search-forced,search-history,eval,cvs-features,identity,facts}-v1.json`
- `app/__tests__/cvs-engine-contract.test.ts`

## Tests added
`app/__tests__/cvs-engine-contract.test.ts` (29 cases): parses every fixture
through the TS types/guards and fails on field loss or type change; asserts the
full 61-key telemetry set; guards that experimental `iidSearches`/`iidFound`
remain **absent** from the frozen V1 contract.

## Cache / schema invalidation
None. No schema or cache version changed. `TeachingFactBundleV1` is unchanged
(facts registry version 5). The frozen wire contract is additive-only going
forward.

## Baseline results (recorded; PR-00 adds none)
| Check | Result |
|---|---|
| app `npm test` | 650 pass + 29 new; **5 fail** in pre-existing `arena/__tests__/engine-backend.test.ts` (spawns the engine with `--base` weights absent in a fresh worktree — environment, not a regression); 2 skip |
| app `npm run build` | pass |
| app `npm run lint` | **37 pre-existing errors** (no-explicit-any / prefer-const / no-var in existing files); **0 in PR-00 files** |
| rust `cargo test --release` | pass |
| rust `cargo build --release` | pass |
| rust `cargo fmt --check` | **fail — 52 hunks / 9 files, pre-existing on `develop`**; PR-00 changes no rust source |

## Rollback
- Revert this branch (deletes the added files); no runtime impact.
- Undo the rust consolidation if desired: `git -C ../chess-vision-studio-rust-engine branch -f master f25c7b1` (the prior `master`). `origin/master` was not pushed.

## Deferred work
- Push consolidated `master` to `origin` — operator decision (not done here).
- Type the full telemetry object (`CvsSearchTelemetryV2`) — PR-11.
- Type eval / CVS / identity responses; combined `inspect` command — PR-12.
- History-aware client/proxy fields (`initialFen`/`moves`) — PR-04.
- Pre-existing rustfmt non-compliance on `develop` (separate engine-side cleanup,
  out of scope for the protocol freeze).
