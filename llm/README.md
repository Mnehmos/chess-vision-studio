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
cp .env.example .env        # then edit .env
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-5.5       # the requested model; override if your id differs
```

`.env` is git-ignored. `process.env` overrides the file.

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
| `batch.ts` | `batchNarrate` — bounded-concurrency per-ply narration |

## Note on GPT-5.x

The client uses `/chat/completions` with a minimal `{ model, messages }` body for
broad compatibility. If your model id only serves the Responses API or requires
different params, adjust `openai.ts` / `OPENAI_BASE_URL`.
