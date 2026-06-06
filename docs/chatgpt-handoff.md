# Handoff prompt for ChatGPT — independent tactical-motif regression dataset

> Paste everything in the fenced block below into ChatGPT (GPT-4-class). It is
> self-contained. The goal is a **second, independently-authored** dataset that
> we triangulate against our engine + Stockfish: agreement builds confidence,
> disagreement surfaces a bug in one side. Different training data → different
> blind spots → that's the point.
>
> When ChatGPT replies, save the JSON to `fixtures/chatgpt-cases.json` and run
> `npx vitest run engine/__tests__/external-dataset.test.ts`.

---

```text
You are generating a RIGOROUS, ADVERSARIAL regression dataset for a chess
tactics-detection engine. The engine names tactical motifs (fork, pin, skewer,
…) and must NEVER label a motif that isn't actually there. Your dataset will be
used to try to BREAK it, then cross-checked move-by-move with Stockfish — so a
case whose stated solution does not actually work will be discarded, and counts
against you. Accuracy and trickiness both matter.

Produce ~100 positions as a single JSON object with this exact schema:

{
  "cases": [
    {
      "id": "kebab-case-unique",
      "fen": "<full FEN; the side to move is the one executing/refuting the tactic>",
      "motif": "fork | pin_absolute | pin_relative | skewer | discovered_check |
                discovered_attack | back_rank | removal_of_guard | mating_net |
                overload | deflection | decoy | interference | zwischenzug |
                trapped_piece | none",
      "isPositive": true|false,        // true: the motif is really present & wins;
                                       // false: an adversarial LOOK-ALIKE that does NOT
      "lookAlikeOf": "fork|pin_…|null",// for negatives, the motif it superficially resembles
      "solution": ["e2g3", "g8h8", "g3f5"], // UCI moves: solver's move(s) + forced replies;
                                             // for negatives, the line showing WHY it fails
      "expectedOutcome": "winsQueen|winsRook|winsMinor|winsExchange|winsPawn|mateInN|nothing",
      "rationale": "one sentence: why it works, or why the look-alike fails",
      "themes": ["fork","short","middlegame"]  // Lichess-style tags
    }
  ]
}

HARD REQUIREMENTS
1. Every FEN must be LEGAL (valid placement, exactly one king per side, the side
   NOT to move is not in check, ≤8 pawns/side, etc.). Vary squares and material —
   do NOT reuse textbook diagrams.
2. The "solution" must be the genuine best/forcing line, in UCI (from..to[promo]),
   alternating solver move / opponent's forced reply. We WILL replay it.
3. Balance ~50% positives / ~50% adversarial negatives.
4. Cover EVERY motif above, and for each include at least one POSITIVE and one
   NEGATIVE look-alike. The negatives are the most valuable cases.

THE FAILURE MODES TO TARGET (these are where detectors break — emphasize them):
- fork: a "fork" where the forking piece is itself hanging (capture defuses it) →
  isPositive:false. AND the inverse — a POISONED-defender fork where capturing the
  forker loses (e.g. …Nc2+ Qxc2?? …Bxc2 wins the queen) → isPositive:true.
- pin: a piece that LOOKS pinned to the king but a second piece blocks between it
  and the king (so it can legally move) → isPositive:false.
- skewer: a "skewer" whose back piece is only a pawn (winning nothing real) →
  isPositive:false; a real skewer winning a rook/queen behind → true.
- discovered check: a DIRECT check by the moved piece (not discovered) →
  isPositive:false; a true discovery where a DIFFERENT piece gives check → true.
- removal of guard: capturing a defender that has a BACKUP defender (piece still
  safe) → isPositive:false; sole-defender removal → true.
- back rank: a back-rank "mate" where the king has luft (an escape square) →
  isPositive:false; a real walled-in back-rank mate → true.
- mating net / deep mate: include a few mateIn2 and mateIn3 with the full forcing
  line.
- Tier-2 (overload, deflection, decoy, interference, zwischenzug, trapped_piece):
  include several POSITIVES with the precise forcing line that proves the payoff.

OUTPUT
- Output ONLY the JSON object. No prose, no markdown fences.
- Prefer being WRONG-LOOKING-BUT-RIGHT and RIGHT-LOOKING-BUT-WRONG cases over
  obvious ones. The harder to label, the more useful.
```
