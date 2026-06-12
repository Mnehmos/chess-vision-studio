# Rung 3 Design — CVS Value Head, Capacity Step 3

Status: DESIGN (2026-06-12). Owner: value-training lane. Deployment target is
the ANALYSIS side — lanes' Level-2 eval profiles, arbiter sibling-ranking,
Control Lens explanations. The hot path stays raw NNUE (gen7/gen8); the hard
rule from GEN8_TRAINING_PLAN.md applies unchanged.

## Why a Rung 3, and why these features

The ladder so far, with verdicts:

- **Rung 1** (9 scalars): trainable but marginal. Lesson: capacity, not
  objective, was the wall.
- **Phase B** (9 scalars + sibling-ranking objective): FAILED its gate —
  right objective, no capacity.
- **Rung 2** (26-dim base + rung2 features, mixed regression+ranking): first
  head to improve the searched move AND generalize on an independent slice.
  `hangingPiece` was the top term. Capacity confirmed as the binding
  constraint.

Rung 3 adds capacity exactly where this week's measured failures point:

1. **Exchange precision** — Rung 2's best term was the crudest hanging-piece
   feature; give it a real basis.
2. **King attack** — both sides of our SPRT games die by tactical collapse
   from near-equal positions (16/17 and 29/29 collapse-profile losses).
3. **Conversion/drawishness** — gen7 reads a +0.2 fortress as +3.6 (measured
   vs SF-d22) and the engine drained wins from +9 to draws. Eval-side search
   patches were rejected twice; the *model* needs the basis instead.
4. **Safe mobility** — the reference-engine research found threat-aware
   mobility (escaping/entering lesser-piece attacks) in every strong engine's
   ordering; the same signal belongs in the value basis.

## Feature families (≈34 new dims; Rung 3 vector ≈ 60 with base+rung2)

### R3-A Exchange precision (8)
- SEE value of the best capture available, per side (2)
- Total en-prise material (SEE-losing pieces), per side (2)
- Overloaded defenders: pieces defending ≥2 attacked targets, per side (2)
- Pinned piece value, per side (2)

### R3-B King attack basis (8)
- King-zone attackers: count and value-weighted power, per side (4)
- Escape squares for the king, per side (2)
- Safe checks available (checks landing on non-defended squares), per side (2)

### R3-C Conversion / drawishness basis (12)
- Material-signature one-hots: opposite-colored bishops, rook-vs-minor,
  pawnless-low-material, single-rook ending (4)
- Most advanced passed pawn rank, per side (2)
- Connected/protected passer flags, per side (2)
- King-to-nearest-passer distance differential (1)
- 50-move counter bucket (0-13 / 14-39 / 40+) (1)
- Fortress proxies: locked-pawn-chain fraction; entry squares available to
  the stronger side's pieces behind the pawn wall (2)

### R3-D Safe mobility (6)
- Mobility to squares NOT attacked by a lesser piece, aggregated for
  minors / rooks / queen, per side (6)

## Training protocol (the Rung-2 recipe, unchanged where it worked)

- **Objective**: mixed regression (White-POV cp) + sibling-ranking margin —
  the only combination that has passed gates.
- **Labels**: current SF-d12 corpus now; switch to gen8 Tier-A labels when
  the relabel lands (one pipeline, two consumers).
- **Gates**: the Rung-2 four-gate protocol verbatim, including the
  independent-slice generalization gate (non-negotiable per the Rung-1
  lesson: never trust weights not verified on an independent slice).
- **Comparisons**: Rung 3 must beat Rung 2 mixed on (a) sibling-ranking
  accuracy, (b) searched-move improvement at fixed depth, (c) the fortress
  set specifically — assemble the eval-fiction positions found 2026-06-11/12
  into a held-out probe suite.

## Implementation notes

- Extract features in Rust next to the rung2 extractor; cost is secondary
  (analysis mode), but keep everything bitboard-native — SEE and attack maps
  already exist in `cvs-bitboard-core` (`see.rs`, `attacks.rs`).
- R3-C doubles as the gen8 Tier-B mining heuristic: the same detectors that
  feed the value head select fortress/conversion positions for the hard
  booster. Build once, use twice.
- Lanes get Rung-3-derived eval profiles only after the head passes gates;
  until then lanes keep rung2 profiles.

## Explicit non-goals

- No Rung 3 in the hot-path NNUE input. That experiment (CVS-NNUE) already
  lost to raw+incremental on same-budget play and the verdict stands.
- No new objective types until the mixed objective is beaten by something on
  an independent slice.
