# Lichess bot — live game diversity for the OODA loop

CvsEngine plays real opponents on Lichess. The deterministic self-play loop
(`npm run arena:ooda`) replays the *same* CvsEngine-vs-Stockfish game every round
and plateaus; live Lichess games are an open-ended stream of genuinely diverse
positions to review → disagree → train on.

Two ways to drive the engine (the "Both" build):

| Path | What it is | Use it for |
|------|-----------|-----------|
| **Pure-Node client** (`arena/lichess/`) | A TypeScript Bot-API client that imports `@cvs/engine` directly and feeds finished games into the OODA pipeline. | The primary loop. `npm run lichess:bot`. |
| **UCI shim** (`@cvs/engine`'s `cvs-engine uci`) | CVS-Policy-0 as a standard UCI engine. | The official Python `lichess-bot`, `cutechess-cli` tournaments, or any UCI GUI. |

## Account setup (you do this — it uses your credentials)

The runner **never** creates accounts, issues tokens, or upgrades the account.
The account-to-BOT upgrade is **irreversible** and only works on an account with
**zero games played**.

1. Create a **fresh** Lichess account for the bot. Play **no** games on it.
2. Generate a personal token at `lichess.org/account/oauth/token/create` with the
   **`bot:play`** scope **only** (least privilege — uncheck everything else).
3. Upgrade the account (irreversible, gameless only):
   ```bash
   curl -d "" https://lichess.org/api/bot/account/upgrade -H "Authorization: Bearer <TOKEN>"
   ```
4. Put the token in `chess-vision-studio/.env` (gitignored, server-side only):
   ```
   LICHESS_BOT_TOKEN=...
   LICHESS_BOT_USERNAME=ChessVisionStudioEng
   ```
   The token is **never** `VITE_`-prefixed, so it is never bundled into the browser.

## Run

```bash
npm run lichess:account   # read-only: verify the token + whether it's a BOT yet
npm run lichess:bot       # connect, accept challenges per policy, play games
```

`lichess:bot` streams `/api/stream/event`, accepts/declines challenges by the
policy in `.env`, plays each game with `CvsEngine` (clock-budgeted), and — when
`LICHESS_REVIEW=1` — harvests finished games into `arena/out/lichess-dataset.jsonl`
(Stockfish reviews each CVS ply; disagreements are played out). Set
`LICHESS_SEED_AI=1` to also challenge Lichess's Stockfish (levels 1–8) at startup
for on-demand diversity without waiting for human challengers.

All policy knobs live in `.env` (see `.env.example`): casual/rated, min clock,
correspondence, bots-only, concurrency, AI-seed levels, review depth.

The live Rust bot does not inherit `CVS_RUST_HELPER_NNUE`, which is reserved
for analysis UI experiments. Raw play is the default. A helper must pass its
same-budget gate and then be opted in explicitly with
`CVS_LICHESS_RUST_HELPER_NNUE`.

## Pre-live training from public Lichess games

Before the bot plays rated/casual games, use the Lichess open database offline:

```bash
# Download a monthly .pgn.zst from https://database.lichess.org/standard/
# Then stream-decompress it into the importer.
zstd -dc lichess_db_standard_rated_2026-05.pgn.zst | npm run lichess:import -- - --limit 200 --min-elo 2400

# Train policy weights from the imported master-game rows.
npm run dataset:train -- arena/out/lichess-master-dataset.jsonl --out arena/out/weights.json
```

`lichess:import` reviews selected public PGN games with local Stockfish and writes
`source: "master_game"` rows. It keeps low/no-cp-loss positions; master games are
mostly good moves, so those rows teach the policy what strong play chooses rather
than only what blunders avoid. `lichess:bot` loads `LICHESS_WEIGHTS`
(`arena/out/weights.json` by default) when that file exists.

For official broadcast PGNs, use `--min-elo 0` if the file has no Elo tags. For
huge standard dumps, keep `--limit`, `--sample-every`, and `--max-plies` modest
until the import throughput is known on the local machine.

### Supervised training UI

Start the local monitor:

```bash
npm run training:ui
```

Open `http://127.0.0.1:5174`, then use the **Training** tab. The tab starts and
stops the same importer/trainer commands, streams stdout/stderr live, tracks
import rows, holdout accuracy, and writes the configured dataset, weights, and
report artifacts. This is a dev-server tool; production preview does not expose
the local process-control endpoints.

## UCI shim (cutechess / lichess-bot)

Build the engine, then point any UCI host at `cvs-engine uci`:

```bash
cd ../chess-vision-studio-engine && npm run build
node dist/bin/cvs-engine.js uci      # or: npm run engine -- uci
```

It speaks the minimal UCI subset (`uci`/`isready`/`ucinewgame`/`position
[startpos|fen …] moves …`/`go depth|movetime|wtime/btime`/`quit`) and answers
`bestmove <uci>`. For the official Python lichess-bot, set its `config.yml`
engine command to `cvs-engine` with arg `uci`.

## How a finished game becomes training signal

`playSession` returns the same `GameRecord` shape `arena/match.ts` produces, so
`harvestGame` runs it straight through the existing
`reviewGame → findDisagreements → playOutBest → reviewedToTraining` pipeline and
appends `source: "bot_game"` rows the trainer folds in next round.

## Files

- `client.ts` — mockable Bot-API client (injectable `fetchLike`; token via Bearer).
- `ndjson.ts` — buffering NDJSON stream parser (handles partial chunks + keep-alives).
- `policy.ts` — challenge-accept policy.
- `session.ts` — one game: stream → our-turn detection → move → `GameRecord`. `cvsPicker`.
- `run.ts` — orchestrator (`npm run lichess:bot`).
- `account.ts` — read-only token check (`npm run lichess:account`).
- `harvest.ts` — finished game → OODA dataset.
- `env.ts` — no-dependency `.env` loader.
