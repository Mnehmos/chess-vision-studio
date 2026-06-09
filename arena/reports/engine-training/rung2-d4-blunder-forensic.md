# Rung-2 d4 blunder — forensic (de-risking before promote/expand)

The mixed base+Rung-2 head won 3/4 SF gates but had **one** blunder at depth 4
(holdout, 1/95 positions). Per the de-risk plan, we chased it before expanding.

## The position (dataset index 549)
`5r2/pp5R/1kp3p1/6b1/4P1b1/1BNP2P1/PPP4P/1K6 w - - 1 22` — White to move, White ~+2.2.

| | move (d4) | cpLoss |
|---|---|---:|
| Stockfish best (d10) | a3 | — |
| default engine | Rf7 | 0.23 (fine) |
| Rung-2 mixed engine | **Bf7** | **2.18 (blunder)** |

## Depth sweep (the key signal)
| depth | mixed move | cpLoss |
|---:|---|---:|
| 4 | Bf7 | 2.18 (blunder) |
| 5 | Bf7 | 2.18 (blunder) |
| 6 | **Rf7** | 0.23 (recovers) |

Deeper search fixes it → horizon effect, but the refutation is ~6 plies deep.

## PV-leaf attribution (Rf7 vs Bf7 @ d4)
| engine | move | search score | leaf CVS | leaf SF | err (CVS−SF) |
|---|---|---:|---:|---:|---:|
| mixed | Rf7 | +303 | +303 | +255 | +48 |
| mixed | **Bf7** | **+315** | +315 | **+300** | **+15** |
| default | Rf7 | +327 | +327 | +264 | +63 |
| default | Bf7 | +323 | −25 | −186 | +161 |

## Conclusion: search-horizon / capture-only quiescence — NOT a Rung-2 eval flaw
- **Leaves are evaluated correctly.** Every PV leaf is within ~15–63cp of Stockfish; the move the mixed engine *prefers* (Bf7) has only a **+15cp** leaf error. No Rung-2 term over-values any leaf (the immediate-child ordering even prefers the *good* move Rf7; at the PV tip Rung-2 pulls the eval *toward* SF truth, Δ −18cp).
- **The path loses, not the leaf.** Default and mixed search *different* lines in the Bf7 subtree; the depth-4 search after Bf7 never finds Black's refutation (SF, deeper, drops White to ~0). This is the "SF agrees the leaf is okay, but the path loses earlier" case → a search issue.
- **Why the search misses it:** the Bf7 refutation is quiet (`a3 Be3 Rg7 Bh5 e5 Rf1+ … Bd4`), so the **capture-only quiescence** never extends into it, and depth 4–5 is below the horizon. Resolved at d6.
- **Guardrails clean:** SEE(Bf7)=0, no hanging material, no opponent mate-in-1, king safety unchanged.

## Disposition
- **Do NOT patch the Rung-2 weights or add a feature pack for this** — the eval is sound; this is not a capacity gap. The win stands (the eval evaluates leaves close to SF and improves the searched move on 3/4 gates incl. the independent slice).
- **The lever for this class of blunder is SEARCH, not eval:** non-capture quiescence extensions (checks, mate threats, high-SEE / hanging-threat replies) and/or greater default depth. The user's note stands: "chess danger is not only captures" — current quiescence is capture-heavy.
- Documented as motivation for a future **search** improvement (quiescence extension), tracked separately from the Rung-2 eval roadmap.
