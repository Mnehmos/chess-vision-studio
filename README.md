# Chess Vision Studio

**See the forces on the board, not just the evaluation.**

Chess engines tell you a move is a *−2.4 blunder*. They don't tell you **why**.
Chess Vision Studio is a 2D chess *perception* engine for improving players
(~300–1400) that makes the hidden structure of a position visible — every attack,
defender, loose piece, winning trade (SEE), mate net, and who controls which
territory — rendered as color-coded board overlays with plain-language coaching.

The moat is **structured perception + saliency, with proven evidence under every
claim**: detect every relationship that changed on a move, surface the one that
matters, stay silent about the eleven that don't — and never assert a tactic the
engine hasn't already validated. The optional AI coach only *narrates facts the
engine confirmed*; it never even sees the position, so it can't make things up.

> **Status: 0.01 MVP.** Runs locally in the browser. 230+ tests green, typecheck
> clean. This is an early public preview — feedback welcome.

---

## What it does

### 🔍 Analyze — one game

Step through any game and the board lights up with its hidden structure, with a
facts panel that spells out every piece in plain English.

![Analyze a game — board overlay, per-piece facts, ranked insights, and a full game review](screens/analyze-board-facts.png)

- **Seven mode-scoped overlays:** Legal Move · Threat Map · Defense Map ·
  Hanging (SEE) · What Changed · Pawn Structure · Tactics (Motif).
- **Per-piece facts:** *"f7 bishop — attacked by Ke7, defended by Qg7, SEE: safe,
  part of: mating net."* Tied to specific squares, never hand-wavy.
- **Ranked insights + board-control %** — who owns which territory, and the one
  relationship that actually mattered this move.
- **Game review** — accuracy by side, recurring patterns, motifs created vs
  suffered, loss by phase, and a move-by-move "what happened".
- **Optional AI coach** — narrates only engine-validated facts (clamped; the key
  stays server-side, never bundled in the browser).

Each overlay is a different lens on the same position:

| Threat Map | Defense Map | Hanging (SEE) |
|---|---|---|
| ![Threat map overlay](screens/overlay-threat-map.png) | ![Defense map overlay](screens/overlay-defense-map.png) | ![Hanging / SEE overlay](screens/overlay-hanging-see.png) |

![Coach commentary — Summary, best line, and major threats, all from validated facts](screens/coach-commentary.png)

### 📊 Insights — all your games

Paste your full Chess.com / Lichess export and it analyzes every game **locally**
with Stockfish (a parallel engine pool), caches results in the browser, and shows
your real patterns.

![Dataset insights — record, openings, move explorer, time-of-day performance, accuracy by side, and biggest teaching moments](screens/dataset-insights.png)

- **Opening tree & move explorer** across your whole history.
- **Accuracy by color** + recurring mistake patterns (motifs created vs suffered).
- **Loss by phase** — opening / middlegame / endgame.
- **When you play your best** — win rate *and* accuracy bucketed by your local
  time of day (it really does surface "you score highest in the morning").
- **Biggest teaching moments** — your worst moves across all games, one click to
  open the position.
- **Durable + incremental** — analysis is cached (IndexedDB) with a per-game ✓,
  so it survives reloads and only analyzes what's new.

### 🎮 Play — a board you can actually use, with the same coaching live

A real game (hot-seat) with the *whole perception suite* applied live:

- **Drag-and-drop or click-to-move**, full legality via chess.js — captures,
  castling, en passant, promotion, and check / checkmate / stalemate / draw.
- **Every overlay, on the live position** — Threat / Defense / Hanging (SEE) /
  Pawn Structure / Tactics, plus What-Changed once a move is analyzed.
- **Full annotation layer** — attack / defend / tactical-line arrows with the
  selection cascade and the *follow move · threat line · all threats · cascade*
  toggles, the same as the analysis board.
- **Facts inspect card** — click any square for its attackers / defenders / SEE /
  status, mid-game.
- **Live coaching** — the engine analyzes each move you play (classification +
  what changed), and the validated **Control Lens** names what the move
  controlled, created, or left unanswered. Add an OpenAI key for written
  "explain this move" commentary.

---

## The wedge

Evaluation says *how bad*. Chess Vision Studio says *what safety rule you broke*.
The **Control Lens** (engine core shipped in this release) frames a position as a
constraint graph and a move as a control action over hazards — it names what each
move *eliminated, defended, created, walked into, or left unanswered*, and which
threats **must be answered** vs can be **safely ignored** (e.g. a loose piece you
can ignore *because a forced mate ends the game first*). Every hazard is
engine-validated — SEE, king-pressure, or a proven mate — never invented.

---

## Architecture

A one-directional pipeline. Everything downstream consumes one validated seam,
`MoveAnalysis`. The engine core is **pure and headless** — no React, no DOM;
Stockfish is the only async dependency and sits behind a mockable transport.

```
PGN/FEN → position → relations → evaluation (Stockfish) → SEE
        → diff → motif (PROPOSE→VALIDATE→LOG) → saliency → explain
        → features → control-lens → led (mode → 64-square map)
        → React board + LED twin   ·   dataset analytics (parallel pool)
```

- `engine/` — the headless library (pure; runs in Node tests, no browser).
- `app/` — the React UI: board, overlays, facts, game review, dataset insights.
- `llm/` — the optional, clamped narrator (server-side key via a dev proxy).

### Non-negotiable invariants

- **Validated facts only.** No motif reaches the player unvalidated — forks proven
  by enumerating every reply, mates by `isCheckmate`, pins by ray geometry. Every
  motif type ships a **proven-negative fixture**, and the rejection is the test of
  record.
- **Hanging = SEE, never naive counting** (with x-ray reveal).
- **Saliency gates on eval-delta, then attributes via the PV** — no magic score.
- **The LLM is a narrator, not an oracle.** It explains validated `MoveAnalysis`;
  it never asserts a tactic that isn't already proven.

---

## Run

```bash
npm install
npm test          # 230+ tests (headless engine + jsdom render)
npm run dev       # the app at http://localhost:5173
npm run build     # production build
```

6 of the 7 overlays are engine-free; the in-browser Stockfish powers What
Changed and the dataset analysis. If the engine fails to load, the app degrades
gracefully to the pure modes.

**Optional AI coach:** copy `.env.example` → `.env` and add an OpenAI key. The key
is read server-side by the Vite dev proxy and never bundled into the browser; you
can also paste a key into the in-app panel (kept in `localStorage`, never
committed). The app is fully usable without it.

---

## Roadmap

- **Control Lens UI** — surface the engine core (shipped here) in the facts panel,
  move history tags, and a dataset "most common failed controls" aggregate.
- **Tier-2 motifs** — overload, deflection, decoy, interference, zwischenzug,
  trapped piece — proposed then PV-shape-validated.
- **Further out** — 3D board, opening book, accounts.

## License

[MIT](LICENSE)
