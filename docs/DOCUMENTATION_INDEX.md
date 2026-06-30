# Documentation Index

Last standardized: 2026-06-29.

This repo is the app, analysis, arena, and local orchestration layer for Chess
Vision Studio. The native search engine lives in
`../chess-vision-studio-rust-engine`. Engine-strength claims and benchmark
decisions should stay tied to the native engine's benchmark reports; app docs
should describe how the app calls and validates those capabilities.

## Primary Documents

| Document | Owns |
|---|---|
| `README.md` | Product overview, local install, top-level architecture, and common commands. |
| `docs/RESPONSIBILITIES.md` | Source-of-truth ownership map for app, engine, arena, LLM, server APIs, schemas, and tests. |
| `docs/ENGINE_OPTIMIZATION_REVIEW.md` | Current engine/runtime review: resource budgets, specialist SMP contract, findings, and verification commands. |
| `docs/ELO_PROBE_BACKLOG.md` | Research-backed ELO probe backlog and promotion gates. |
| `docs/MODERN_ENGINE_CHECKLIST.md` | Implemented modern search features and gated follow-up work. |
| `docs/RSI_OODA_PIPELINE.md` | OODA loop, relabeling, forensic review, and improvement pipeline. |
| `docs/TEACHING_FACTS_PROTOCOL.md` | Facts schema and teaching compiler contract. |
| `docs/UI_AESTHETICS_AUDIT.md` | UI design/code health audit and CSS direction. |
| `docs/protocol/CVS_ENGINE_PROTOCOL_INVENTORY.md` | Captured native engine wire protocol shapes and fixture contract. |

## Native Engine Documents

These live in `../chess-vision-studio-rust-engine` and should be treated as the
engine-strength source of truth:

| Document | Owns |
|---|---|
| `README.md` | Native engine overview and build/run notes. |
| `CVS_HETEROGENEOUS_SMP.md` | Specialist-lane design and Channel-A/Channel-B authority model. This file lives at the native repo root. |
| `SEARCH_PATCHES.md` | Search-feature implementation notes. |
| `benchmarks/README.md` | Benchmark gate ladder and current baseline. |
| `benchmarks/SPECIALIST_AUTHORITY_STANDARD.md` | Specialist authority rules and live-promotion gates. |
| `benchmarks/ENGINE_STRENGTH_AUDIT.md` | Engine-strength audit and benchmark conclusions. |

## Documentation Standard

- Put stable ownership and schema rules in `docs/RESPONSIBILITIES.md`.
- Put current review findings, risk, and verification commands in
  `docs/ENGINE_OPTIMIZATION_REVIEW.md`.
- Put new strength ideas in `docs/ELO_PROBE_BACKLOG.md` until a benchmark report
  promotes or rejects them.
- Every strength claim must name binary, commit, weights, flags, threads,
  budget/time control, opponent/oracle, game/position count, and result label.
- Avoid duplicate configuration examples. If an env var appears in
  `.env.example`, document its purpose once and call out whether it is app,
  arena, or Lichess-only.
- Unknown, uncomputed, unavailable, and intentionally disabled are different
  states. Do not document a disabled experiment as a default feature.
