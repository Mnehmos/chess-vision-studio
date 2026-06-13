# Teaching Facts Protocol V1

`TeachingFactBundleV1` is the versioned boundary between the Rust chess core and
Chess Vision Studio's teaching compiler. Rust emits deterministic chess facts.
The application combines those facts with Stockfish grades, classifies teaching
topics, and renders committed explanation plans.

The current additive contract is schema version 1, facts registry version 5.

## Request

Send one JSON line to `analyze --serve`:

```json
{
  "cmd": "facts",
  "schemaVersion": 1,
  "fenBefore": "...",
  "playedMoveUci": "e2e4",
  "bestMoveUci": "g1f3",
  "refutationUci": "d8h4",
  "principalVariationUci": ["g1f3", "d7d5"],
  "options": {
    "includeMotifOpportunities": true,
    "includeCounterfactual": true
  }
}
```

Required fields are `schemaVersion`, `fenBefore`, and `playedMoveUci`. The played
move must be legal from `fenBefore`. `bestMoveUci`, when present, is validated from
the same position. `refutationUci` is validated after the played move. A principal
variation is replayed from `fenBefore` and stops at the first illegal move.

## Response Shape

```ts
interface TeachingFactBundleV1 {
  schemaVersion: 1;
  fenBefore: string;
  before: PositionFacts;
  played: MoveStateFacts;
  best?: MoveStateFacts;
  refutation?: MoveStateFacts;
  provenance: {
    engine: 'cvs-bitboard-core';
    engineCommit?: string;
    factsRegistryVersion: 5;
    validators: string[];
  };
  errors: FactError[];
}
```

Optional branch failures are reported in `errors` and omit that branch. An invalid
required played move or unsupported schema returns a top-level protocol error.

## Position Facts

```ts
interface PositionFacts {
  sideToMove: 'white' | 'black';
  pieces: PieceFact[];
  pawnStructure: PawnStructureFacts;
  kingSafety: FactCollection<KingSafetyFact>;
  availableCaptures: FactCollection<CaptureOpportunity>;
  opponentAvailableCaptures: FactCollection<CaptureOpportunity>;
  availableMotifs: FactCollection<MotifOpportunity>;
  availablePins: FactCollection<PinOpportunity>;
  opponentAvailableMotifs: FactCollection<MotifOpportunity>;
  opponentAvailablePins: FactCollection<PinOpportunity>;
  hazards: FactCollection<HazardFact>;
}
```

`available*` collections describe legal opportunities for `sideToMove`.
`opponentAvailable*` collections are symmetric analysis probes for the other side.
An opposite-side probe is `unavailable` when the real side to move is in check,
because granting the checking side another turn would create an illegal state.
En-passant is cleared for opposite-side probes.

Each piece includes its stable reference, square, geometric attackers and
defenders, counts, loose/attacked flags, only-defender relationships, and SEE
status. SEE is computed only for a legal capture; unavailable states are never
guessed by flipping the turn.

Pawn structure includes doubled, isolated, passed, island, open-file,
semi-open-file, king-shield, and pawn-chain facts. Move branches include computed
created and removed structure deltas.

## Captures and King Safety

Registry v5 exposes structured legal captures and king-safety facts:

```ts
interface CaptureOpportunity {
  moveUci: string;
  attacker: PieceRef;
  victim: PieceRef;
  victimSquare: string;
  seeCp: number;
  givesCheck: boolean;
  capturingPieceSurvives: boolean;
  highestValueSafeCapture: boolean;
}

interface KingSafetyFact {
  side: 'white' | 'black';
  kingSquare: string;
  inCheck: boolean;
  attackers: PieceRef[];
  pressuredSquares: string[];
  legalEscapeSquares: FactCollection<string>;
}
```

Capture ordering and flags are deterministic. Legal escape squares are computed
symmetrically when the requested side can be probed legally.

## Motifs and Pins

When `options.includeMotifOpportunities` is true, each position view includes
validated fork and pin opportunities for both sides. When false or absent, those
collections are `uncomputed` with reason `not_requested`.

```ts
interface MotifOpportunity {
  kind: 'fork';
  validator: 'fork_validation';
  moveUci: string;
  forkingPiece: PieceRef;
  targets: PieceRef[];
  givesCheck: boolean;
  kingTarget: boolean;
  materialGain: number;
}

interface PinOpportunity {
  kind: 'absolute' | 'relative';
  validator: 'pin_validation';
  moveUci: string;
  pinner: PieceRef;
  pinned: PieceRef;
  anchor: PieceRef;
  ray: string[];
  givesCheck: boolean;
  pinnedImmobile: boolean;
}
```

Fork validation was introduced in registry v2, pin validation in v3, and
opponent-side motif/pin probes in v4.

## Hazards and Move Deltas

When motif opportunities are requested and symmetric probes are available,
registry v5 derives stable hazards from validated lower-level facts:

```ts
interface HazardFact {
  id: string;
  kind:
    | 'losing_material'
    | 'fork_threat'
    | 'pin_constraint'
    | 'king_pressure'
    | 'mate_threat';
  side: 'white' | 'black';
  squares: string[];
  magnitudeCp?: number;
  moveUci?: string;
}

interface MoveFactDeltas {
  createdHazards: FactCollection<HazardFact>;
  removedHazards: FactCollection<HazardFact>;
  worsenedHazards: FactCollection<HazardFact>;
  createdStructures: FactCollection<StructureDelta>;
  removedStructures: FactCollection<StructureDelta>;
}
```

Hazards summarize facts; they do not grade a move or claim causation. If the
symmetric position probe cannot be performed, hazards and hazard deltas are
explicitly unavailable.

## Computed, Uncomputed, and Unavailable

Every optional fact collection is a tagged union:

```ts
type FactCollection<T> =
  | { status: 'computed'; items: T[] }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };
```

`computed` with an empty list means the validator ran and found none. `uncomputed`
means the validator was not requested or is outside the current registry.
`unavailable` means the validator exists but cannot answer for this state. These
states must not be collapsed into zero, `false`, or an empty list.

A scalar fact uses the equivalent `FactValue<T>` union. A boolean inside a
`computed` value is a deterministic result.

## Identity and Conventions

- Squares use lowercase algebraic coordinates: `a1` through `h8`.
- Moves use legal long UCI: `e2e4`, `e7e8q`.
- Sides are `white` and `black`.
- Piece types are lowercase names.
- Piece IDs use `<side>-<piece>-<square>`, such as `white-knight-f3`.
- Fact IDs describe their complete current identity. They are not array indexes.
- Arrays are serialized in stable lexical order where identity matters.

## Proof and Validators

Registry v5 provenance may list:

- `legal_move_generation`: branch, PV, capture, and reply legality.
- `attack_map`: attackers, defenders, loose pieces, and only defenders.
- `see`: legal capture material consequence in centipawns.
- `capture_opportunities`: structured legal capture candidates.
- `king_safety`: check state, king-zone pressure, and legal escapes.
- `pawn_structure`: pawn and king-shield structure facts and deltas.
- `fork_validation`: validated fork opportunities.
- `pin_validation`: validated pin opportunities.

The engine returns validator provenance but no causal attribution. Application
teaching events must cite the validators that support their evidence and must fail
closed when a required collection is missing, uncomputed, or unavailable.

## Responsibility Boundary

Rust owns legal board truth, relationships, SEE, captures, motifs, pins, king
safety, structural facts, hazards, deltas, and provenance. Stockfish grades moves
and supplies best lines. The application owns topic classification, causal gates,
teaching vocabulary, UI, aggregation, and optional narration. An LLM teaching
narrator receives only a committed `ExplanationPlan`.

## Golden Fixtures

`fixtures/teaching-facts/v1` contains five byte-stable response fixtures:

- `allowed-fork.json`
- `allowed-pin.json`
- `missed-hanging-piece.json`
- `failed-defense.json`
- `pawn-structure-damage.json`

Rust regenerates and byte-compares them in `tests/facts_protocol.rs`. The
application consumes mirrored copies in contract and compiler tests.

## Versioning Policy

- Additive fields may retain `schemaVersion` and increment `factsRegistryVersion`.
- Renaming fields, changing conventions or tagged-union semantics, or changing
  required fields requires a new schema version.
- Changes to fact meaning or validator behavior increment `factsRegistryVersion`.
- Consumers reject unknown schema versions and incomplete current-registry shapes.
- Cached teaching output is valid only for its schema, facts registry, compiler,
  and engine settings provenance.
