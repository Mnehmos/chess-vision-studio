# LLM narrator / eval (OpenAI)

The LLM sits **beside** the engine, never on the trust path (Invariant 8): it
receives only the engine-**validated** `MoveAnalysis` facts and narrates them. It
never sees the raw board and is instructed never to assert a tactic that isn't
already in the facts.

```
engine (Stockfish + detectors)  →  MoveAnalysis (validated facts)
                                        │  factsBlock()  (no FEN, no board)
                                        ▼
                              clamped prompt → OpenAI → plain-English coaching
```

## Setup

```bash
cp .env.example .env.local  # then edit .env.local
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-5.5       # the requested model; override if your id differs
```

`.env` and `.env.local` are git-ignored. `process.env` overrides file values. Keep the key Node-side; do not expose it as a `VITE_` variable.

## Run commentary

```bash
# One OpenAI call for a whole-game review
npm run llm:commentary -- --mode game --pgn fixtures/sample-game.pgn --game 0

# One clamped call per analyzed ply, bounded by LLM_CONCURRENCY
npm run llm:commentary -- --mode batch --pgn fixtures/sample-game.pgn --game 0

# One on-demand turn call
npm run llm:commentary -- --mode turn --pgn fixtures/sample-game.pgn --game 0 --ply 24

# Inspect the exact prompt/facts without calling OpenAI
npm run llm:commentary -- --mode game --dry-run
```

## Run the batch eval (one clamped call per ply)

```bash
npm run llm:eval
```

Analyzes the sample game with Stockfish, then narrates **every ply** as a batched,
clamped LLM call (`LLM_CONCURRENCY` at a time), and writes
`fixtures/llm-eval-output.json` (`{ model, plies: [{ ply, move, classification,
cpLoss, topExplanation, narration }] }`). Set `LLM_MAX_PLIES` to limit scope while
testing.

If `OPENAI_API_KEY` is unset/placeholder the eval is **skipped** (the clamp unit
tests still run, no key needed).

## Modules

| file | role |
|---|---|
| `env.ts` | `.env` loader + `LlmConfig` |
| `openai.ts` | minimal fetch-based Chat Completions client (model/baseUrl configurable) |
| `narrate.ts` | `factsBlock` / `buildNarrationMessages` — the **clamp** (facts only, no FEN) |
| `batch.ts` | `batchNarrate` - bounded-concurrency per-ply narration |
| `game.ts` | whole-game prompt builder plus deterministic local drafts |
| `run.ts` | Node-only runner for game, batch, and turn commentary |

## Note on GPT-5.x

The client uses `/chat/completions` with a minimal `{ model, messages }` body for
broad compatibility. If your model id only serves the Responses API or requires
different params, adjust `openai.ts` / `OPENAI_BASE_URL`.
