# Chess Vision Studio

**See the forces on the board, not just the engine number — and learn from every move you make.**

Chess Vision Studio is a local-first chess teacher and analysis studio. It turns a
position into visible structure — attackers, defenders, loose pieces, SEE trades,
pawn shape, king pressure, tactical motifs, and the one relationship that changed
enough to matter — and then explains *why* a move was good or bad in plain
language that is backed by a deterministic engine, never invented.

![Analyze a game — board overlay, rich teaching cards, square facts, engine analysis, and a full game review](screens/CVS%20Analysis%20Screenshot%206-13-26.png)

This is a public work-in-progress launch. It is meant to be cloned, built, and run
on your own machine — there is no hosted account system yet. The
[Local Install](#local-install--quickstart) section below gets you to a running app
in three commands.

> **The one idea that makes it different.** Most analysis tools hand you a number
> and a best move. Chess Vision Studio teaches *hazard management*: every move is a
> control action over a graph of threats, defenses, and structural commitments. The
> facts come from a deterministic Rust engine, Stockfish grades the move, and only
> then is a sentence written — so the explanation is always something the board can
> prove.

---

# Part 1 · For players

## Three ways to use it

| Mode | What it's for |
|---|---|
| **Analyze** | Step through one game. See the board light up, get every move graded and explained, drill the mistakes as puzzles, and read a full game review. |
| **Play** | Play a full game against the **CVS Engine** or **native Stockfish** (or against no engine, for solo study). Every one of your moves — and the engine's reply — is taught live, as it happens. |
| **Insights** | Load your whole Chess.com / Lichess history and see your record, openings, accuracy over time, when you play your best, and your biggest recurring teaching moments across hundreds of games. |

Paste a PGN export (one game or your entire archive) with **Import PGN**. Everything
is cached locally in your browser — nothing is uploaded.

## Analyze — read one game deeply

- **Perception lenses.** Switch the board between *Legal Move*, *Threat Map*,
  *Defense Map*, *Hanging (SEE)*, *What Changed*, *Pawn Structure*, and *Tactics
  (Motif)*. Arrows distinguish attacks, defenses, tactical lines, the played move,
  and threat cascades. A board-control bar shows who owns the center.
- **Teaching cards.** At board level, a running log explains every move: the
  opening and its plan while you're in book, then for each move its quality grade
  (`best · 0.00`), a White-perspective eval bar, and — when something happened — a
  named topic card (*Allowed Fork*, *Allowed Pin*, *Missed Hanging Piece*, *Failed
  Defense*, *Pawn Structure Damage*) with **why**, **consequence**, and **better
  move**.
- **Every claim is engine-checked.** When a card says "this move allows a fork,"
  the punishing move is re-graded by the engine and the result is shown in green
  (**confirmed** — it really wins material) or red (**refuted** — it doesn't). A
  graded blunder never reads as a winning idea, and a hanging piece your move left
  behind is surfaced even when no named pattern matched.
- **Square Facts.** Click any square to see its attackers, defenders, SEE outcome,
  status (hanging / loose / defended target), the tactics it's part of, and the
  ranked insights for that move.
- **Puzzle / Practice.** Turn any teaching moment into a multi-stage drill — find
  the move that avoids the fork, then the move that punishes it.
- **Engine Analysis.** Stockfish and the CVS Engine side by side, both judging the
  position — eval, depth, node counts, and principal variation, with strength
  disagreements made visible.
- **Game review.** Per-side accuracy, a best→blunder histogram, your mistake list,
  recurring patterns, motifs created and suffered, average loss by phase, and a
  move-by-move timeline of the game's turning points.
- **Coach commentary (optional).** A GPT-class narrator can rephrase the validated
  analysis into prose — for one move or the whole game. It only ever receives the
  facts the engine already proved; it is not allowed to invent a tactic.

## Play — learn while you play

![Play against the CVS Engine or Stockfish, with live counterfactual teaching](screens/CVS%20Play%20Screenshot%206-13-26.png)

Pick your opponent (CVS Engine, Stockfish, or none), pick your color, and play. The
same teaching log runs live: *"your move did this — now my reply responds this
way."* Because the coach is the engine you're playing, its callouts are
counterfactual and honest — if it flags that your move "allows a pin" but the engine
check refutes it, you'll see it marked refuted rather than oversold.

## Insights — see your whole game

![Insights — record, accuracy over time, openings, move explorer, time-of-day performance, and biggest teaching moments](screens/CVS%20Insights%20Screenshot.png)

Load your full archive and Insights aggregates it: win/draw/loss and score split by
color, accuracy over time as a sparkline and a per-game heatmap, your openings from
your own perspective, a move explorer of what you actually play, when in the day you
score best, overall accuracy by side, and a ranked list of your biggest teaching
moments across every analyzed game.

## The perception lenses

| Threat Map | Defense Map |
|---|---|
| ![Threat map overlay](screens/CVS%20Threat%20Map%20Overlay.png) | ![Defense map overlay](screens/CVS%20Defense%20Overlay.png) |

| Hanging / SEE | Tactics (Motif) |
|---|---|
| ![Hanging / SEE overlay](screens/CVS%20Haning%20SEE%20Overlay.png) | ![Tactics and motifs overlay](screens/CVS%20Tactics%20and%20Motifs%20Overlay.png) |

Coach commentary, from validated facts only:

![Coach commentary — summary, best line, and threats drawn from the committed explanation plan](screens/coach-commentary.png)

## Local Install / Quickstart

Clone both sibling repositories (the app and the native engine):

```bash
git clone https://github.com/Mnehmos/chess-vision-studio.git
git clone https://github.com/Mnehmos/chess-vision-studio-rust-engine.git
```

> **Known WIP gap — the `@cvs/engine` dependency.** The app also imports a local
> TypeScript package, `@cvs/engine`, via `file:../chess-vision-studio-engine`. That
> package is not published to npm yet, so a *clean* public `npm install` will not
> fully resolve until it is published or vendored into this repo. This is a rough
> edge of the WIP launch; the full local workspace builds with all three sibling
> folders present. (`@cvs/engine` powers the trainer/arena scripts and the CVS
> policy/value/search experiments.)

Build the native CVS Engine:

```bash
cd chess-vision-studio-rust-engine
cargo build --release
```

Install and run the app:

```bash
cd ../chess-vision-studio
npm install
npm run dev
```

Open <http://localhost:5173>.

**Chess Vision Studio runs even without the Rust engine built.** The CVS Engine
badge will read `not found`, but Stockfish grading, the teaching cards, and all of
the perception overlays keep working. Build the engine to unlock the CVS-vs-you Play
mode and the side-by-side engine comparison.

Optional configuration lives in `.env` (`cp .env.example .env`). The most useful
knobs are the engine bridge path, native runtime budget, and the coach key:

```text
CVS_RUST_EXE=../chess-vision-studio-rust-engine/target/release/analyze.exe
CVS_RUST_THREADS=1        # keep 1 for normal app/dataset analysis
CVS_RUST_CVS_HELPERS=0    # specialist SMP helpers; benchmark before enabling
CVS_SF_EXE=                 # native Stockfish; bundled avx2 build is used if unset
OPENAI_API_KEY=             # optional coach; read server-side, never bundled
```

The coach reads `OPENAI_API_KEY` **server-side** through the Vite dev server, so the
key is never bundled into the browser or committed — this is the recommended setup. A
browser-side fallback (pasting a key into the in-app panel, stored in `localStorage`)
exists for quick local experiments only; it is **development-only** and not
recommended for anything you care about.

Restart `npm run dev` after editing `.env`. On macOS/Linux the engine path drops the
`.exe` suffix.

---

# Part 2 · For engine & chess-programming developers

This half is the architecture, the contract that keeps the teaching honest, the repo
map, and the training/labeling pipeline. If you build chess engines or analysis
tooling, this is where the interesting decisions are.

## The Control Lens contract

The product invariant is a strict separation of concerns. Each layer is only allowed
to make the kind of claim it can actually back up:

| Layer | Owns | May NOT do |
|---|---|---|
| **Rust facts engine** | Deterministic chess truth: legality, SEE, attackers/defenders, pins/forks, pawn structure, king safety, position hazards. | Grade a move or write prose. |
| **Teaching compiler** (app, TypeScript) | Classify facts into named topics, attribute cause by joining facts with the Stockfish grade, render an evidence-gated explanation plan. | Invent a tactic the validators didn't prove. |
| **Stockfish** (native, oracle) | Grade moves: eval, centipawn loss, classification (best…blunder), PV, and the engine-check that confirms/refutes an exposed tactic. | Write the explanation. |
| **LLM narrator** (optional) | Rephrase a *committed* explanation plan into prose. | Create a conclusion; it never sees raw board state. |

Consequences that fall out of this contract, and that the codebase enforces:

- A structural fact (a doubled pawn, a loose piece) is **not automatically the
  cause** of an eval loss — cause requires the grade to agree.
- Classification is **loss-vs-best**, not a heuristic guess.
- "This move allows a fork" is only ever shown with the engine's re-grade of the
  punishing move attached, colored green (confirmed) or red (refuted).
- **New chess-truth belongs in Rust**, behind a validator and a fact — not in the
  legacy TypeScript perception layer.

## Data flow

```text
PGN/FEN ─▶ position ─▶ POST /api/cvs-engine/facts ─▶ Rust validators
                                                       (TeachingFactBundleV1)
        ─▶ native Stockfish grade (eval, cpLoss, PV)
        ─▶ teaching compiler: facts × grade ─▶ TeachingEvent + ExplanationPlan
        ─▶ engine-check exposed tactics ─▶ confirmed / refuted
        ─▶ React board overlays · teaching log · square facts · puzzles
        ─▶ (optional) LLM narrator ◀─ committed ExplanationPlan only

Selected ply pre-move FEN ─▶ /api/cvs-engine/analyze ─▶ Rust `analyze --serve`
                          ─▶ CVS Engine best move, eval, PV, search telemetry
```

The Vite dev server is the bridge: it pools `analyze --serve` children for facts and
search, and pools a native Stockfish UCI subprocess for grading. On Windows the
running `analyze.exe` is file-locked while served — kill the pool before rebuilding
the engine; the dev server re-spawns it on the next request. When
`CVS_RUST_THREADS` is greater than 1, the bridge scales its Rust process pool down
so process fan-out and per-process SMP do not multiply into accidental CPU
oversubscription.

## The two engines

| In the app | Role | Runtime |
|---|---|---|
| **Stockfish** | The oracle. Grades every move and powers dataset analysis. Native pooled UCI subprocess (`CVS_SF_EXE`, bundled avx2 default), `Threads=1`/`pool=1` so it never fights the engine's own labeling jobs. WASM auto-fallback when no binary is present. | Native subprocess / WASM fallback |
| **CVS Engine** | The engine under development. Searches the same pre-move position so its choice can be compared against the played move and against Stockfish. | Rust `analyze --serve`, bridged by Vite |

The CVS Engine lives in the sibling repo,
[`chess-vision-studio-rust-engine`](https://github.com/Mnehmos/chess-vision-studio-rust-engine)
— bitboard core, SEE, NNUE eval, alpha-beta with a validated pruning stack,
measured against native Stockfish rungs. Its README is the engine-strength source of
truth. For the current app-side runtime review and probe queue, see
[docs/ENGINE_OPTIMIZATION_REVIEW.md](docs/ENGINE_OPTIMIZATION_REVIEW.md) and
[docs/ELO_PROBE_BACKLOG.md](docs/ELO_PROBE_BACKLOG.md).

## Repo map

```text
chess-vision-studio/
  engine/        Pure TypeScript: chess perception, the teaching compiler,
                 the TeachingFactBundleV1 client/types, Stockfish transport.
  app/           React UI — board overlays, the unified TeachingLog, square
                 facts, Analyze / Play / Insights, puzzles, game review.
  arena/         Engine harnesses: gauntlets, gates, the Lichess bot, the
                 SF labeling pipeline, dataset + training scripts.
  llm/           Optional narrator client and prompts.
  docs/          Documentation index, responsibilities, engine/runtime review,
                 Elo probe backlog, protocols, and audit notes.

chess-vision-studio-rust-engine/   The native CVS Engine + facts validators.
```

## Teaching Facts protocol (registry v5)

The dev server exposes `POST /api/cvs-engine/facts`, backed by the Rust engine's
versioned `TeachingFactBundleV1`. A bundle carries `before` / `played` / `best` /
`refutation` move states, each with full `PositionFacts`: per-piece attackers,
defenders, and SEE; pawn-structure facts; king safety; available and
opponent-available motifs and pins; and deterministic position **hazards**
(losing-material, fork-threat, pin-constraint, king-pressure, mate-threat) with
move-to-move deltas. The engine emits facts only — no topic classification, no prose.
The teaching compiler in `engine/teaching/` is what turns those into the cards you
see. See [docs/TEACHING_FACTS_PROTOCOL.md](docs/TEACHING_FACTS_PROTOCOL.md).

## Dev setup

```bash
npm test          # vitest
npm run build     # tsc -b && vite build
npm run dev       # the app + engine/Stockfish bridge
```

Focused checks:

```bash
npx vitest run app/App.test.tsx
npx vitest run engine
npx vitest run arena
```

Engine bridge smoke test (with the dev server running):

```bash
curl http://localhost:5173/api/cvs-engine/health
curl -X POST http://localhost:5173/api/cvs-engine/analyze \
  -H "Content-Type: application/json" \
  -d "{\"fen\":\"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\",\"depth\":4}"
```

## Training & labeling pipeline

The CVS Engine's eval is trained from Stockfish-labeled positions. The pipeline lives
in `arena/`:

- **`arena/relabel-fleet.py`** — shards a FEN corpus and launches N detached,
  resumable `sf-relabel-worker.py` processes (one Stockfish each, `Threads=1`,
  configurable `Hash`, below-normal priority) to label at a fixed depth. Tuned for
  an 8c/16t box: ~14–16 workers at depth 20 / Hash 256 saturate the cores while
  yielding to the dev server, the analyze pool, and the Lichess bot.
- **`arena/relabel-evals.ts`** (`npm run dataset:relabel`) — single-process
  multipv relabel that adds `evalBefore` + ranked `topMoves`, the sibling-ranking
  signal the value head trains on.
- **`arena/train-*.ts`** — value-head and NNUE trainers (mixed
  regression + sibling-ranking).
- **`arena/gauntlet-*.ts`**, **`arena/eval-*.ts`** — the gate ladder that promotes
  a candidate only after a measured win, one variable at a time.
- **`arena/teaching-audit.ts`**, **`arena/teaching-replay.ts`** — replay games
  through the facts contract and audit the teaching corpus.

Corpus discipline: split train/validation/test by game and source (not random
positions), keep final evaluation slices locked out of training, and make the broad
corpus match the engine's own position distribution.

## Claim discipline

Strength claims must name the binary type, opponent, time control, game count,
weights, and search flags. Native Stockfish via cutechess (in the engine repo) is the
external anchor; the in-app Stockfish is a useful grader, not a transferable Elo
claim; Lichess bot games are real-world evidence, not controlled ratings. New
search ideas start in [docs/ELO_PROBE_BACKLOG.md](docs/ELO_PROBE_BACKLOG.md) and
become defaults only after a same-budget native-engine benchmark promotes them.

## License

[MIT](LICENSE)
