# Chess Vision Studio

A 2D **chess perception engine** that turns hidden board relationships — attacks,
defenses, loose pieces, SEE trades, what-changed diffs, and validated tactical
motifs — into mode-scoped visual layers and plain-language coaching.

The moat is **structured perception + saliency ranking**: detect every
relationship that changed on a move, surface the one that matters, stay silent
about the eleven that don't — with **proven evidence** under every claim, no LLM
required.

## Status — MVP complete (M0–M7)

96 tests green. The headless analysis core is finished through the crown jewel
(saliency), the hardest puzzle (validated motifs), deterministic explanations,
and the mode→LED layer; the React app renders it.

| Milestone | What it proves |
|---|---|
| **M0** Scaffold | Stockfish WASM (mockable transport) + chess.js + Vitest |
| **M1** Relations | per-square attacker/defender maps (g4 knight: attacked only by wQd1) |
| **M2** SEE | static exchange eval — free / too-expensive / x-ray battery |
| **M3** cpLoss | side-to-move sign flip; blunder vs only-move (live Stockfish) |
| **M4** Saliency | eval-gated, PV-attributed ranking — quiet / silence / refutation |
| **M5** Motifs | Tier-1 PROPOSE→VALIDATE→LOG; every type has a proven-negative fixture |
| **M6** Explain | deterministic templates keyed by ChangeType / MotifType |
| **M7** UI | 7 mode-scoped LED maps + 2D board; Hanging flags g4, Tactics draws R1e7# |

## Architecture

A one-directional pipeline. Everything downstream consumes one validated seam,
`MoveAnalysis` (Invariant 2). The engine core is **pure and headless** — no
React, no DOM (Invariant 1); Stockfish is the only async dependency and it sits
behind a mockable `EngineTransport`.

```
PGN/FEN → position → relations → evaluation(Stockfish) → SEE
        → diff → motif (PROPOSE→VALIDATE→LOG) → saliency → explain
        → led (mode → 64-square map) → React board + LED twin
```

- `engine/` — the headless library (pure; runs in Node tests, no browser).
- `app/` — React UI that imports the engine and renders its LedMaps + facts.

### Non-negotiable invariants honored

3. **Hanging = SEE, never naive counting** — `see.ts`, with x-ray reveal.
4. **Saliency gates on eval-delta, then attributes via the PV** — no magic score;
   weights sum to 1 and only attribute the swing the gate already measured.
5. **Blunders live in the refutation** — `diffRefutation` walks the opponent's PV.
7. **No motif reaches the player unvalidated** — forks proven by enumerating
   every reply; mates by `isCheckmate`; pins by ray geometry. Every type ships a
   proven-negative fixture and the **rejection is the test of record**.

## Run

```bash
npm install
npm test          # 96 tests (headless engine + jsdom render)
npm run dev       # the app at http://localhost:5173
npm run build     # production build
```

6 of the 7 modes are engine-free; only **What Changed** needs Stockfish. If the
in-browser engine fails to load, the app degrades gracefully to the pure modes.

## Next wave (not started — needs sign-off)

- **M8** — LLM as a *proposer* of Tier-2 motif candidates and a *narrator* over
  validated `MoveAnalysis` (same contract). The LLM proposes; the engine
  adjudicates (Invariant 8). Adds a paid API dependency.
- **Tier-2 motifs** — overload, deflection, decoy, interference, zwischenzug,
  trapped piece — proposed then PV-shape-validated.
- **M9 (hard-out)** — 3D board, LED hardware, accounts, opening book.
