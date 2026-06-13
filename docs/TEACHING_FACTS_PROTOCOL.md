# Teaching Facts Protocol V1

`TeachingFactBundleV1` is the versioned boundary between the Rust chess core and
Chess Vision Studio's teaching compiler. Rust emits deterministic chess facts.
The application decides which facts form a teaching topic and how to present them.

Milestone 1 implements pieces, geometric attackers and defenders, legal SEE
capture status, doubled/isolated/passed pawns, pawn islands, move validation, and
played/best/refutation branches. It does not emit topic names or coaching prose.

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
    "includeMotifOpportunities": false,
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
    factsRegistryVersion: 1;
    validators: ValidatorType[];
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
  availableMotifs: FactCollection<MotifOpportunity>;
}
```

Each piece includes its stable reference, square, geometric attackers and
defenders, counts, loose/attacked flags, only-defender relationships, and SEE
status. SEE is computed only when the piece can legally be captured by the side to
move. Otherwise it is `unavailable`; it is never guessed by flipping the turn.

Pawn structure contains named squares for doubled, isolated, and passed pawns and
for pawn islands. Future structure families are present as explicit uncomputed
collections.

## Computed, Uncomputed, and Unavailable

Every optional fact collection is a tagged union:

```ts
type FactCollection<T> =
  | { status: 'computed'; items: T[] }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };
```

`computed` with an empty list means the validator ran and found none. `uncomputed`
means that validator is outside the current registry/version. `unavailable` means
the validator exists but cannot answer for this state. These states must not be
collapsed into zero, `false`, or an empty list.

A scalar fact uses the equivalent `FactValue<T>` union. A boolean inside a
`computed` value is a real deterministic result.

## Identity and Conventions

- Squares use lowercase algebraic coordinates: `a1` through `h8`.
- Moves use legal long UCI: `e2e4`, `e7e8q`.
- Sides are `white` and `black`.
- Piece types are lowercase names.
- Piece IDs are stable within a position and use
  `<side>-<piece>-<square>`, for example `white-knight-f3`.
- Fact IDs describe their complete current identity. They are not array indexes.
- Arrays are serialized in stable lexical order where identity matters.

## Proof and Validators

V1 validator names are:

- `legal_move_generation`: branch and PV move legality.
- `attack_map`: attackers, defenders, loose pieces, and only defenders.
- `see`: legal capture material consequence, in centipawns.
- `pawn_structure`: doubled, isolated, passed, and island facts.

The engine returns validator provenance but no causal attribution. Future teaching
events may reference these facts as evidence; they may not claim a named tactic
unless the corresponding Rust validator exists.

## Responsibility Boundary

Rust owns legal board truth, relationships, SEE, structural facts, and fact
provenance. Stockfish grades moves and supplies best lines. The application owns
topic classification, causal gates, teaching vocabulary, UI, aggregation, and
optional narration. An LLM receives committed teaching plans only.

## Golden Fixtures

`fixtures/teaching-facts/v1` contains five byte-stable response fixtures:

- `allowed-fork.json`
- `allowed-pin.json`
- `missed-hanging-piece.json`
- `failed-defense.json`
- `pawn-structure-damage.json`

The filenames identify future vertical-slice scenarios. V1 fixtures contain facts,
not committed topic classifications. Rust regenerates and byte-compares them in
`tests/facts_protocol.rs`; the application consumes mirrored copies in its contract
tests.

## Versioning Policy

- Additive optional fields may be introduced without changing `schemaVersion`.
- Renaming fields, changing side/square conventions, changing tagged-union
  semantics, or changing required fields requires a new schema version.
- Changes to fact meaning or validator behavior increment `factsRegistryVersion`.
- Consumers must reject unknown schema versions and must not load cached teaching
  output generated under an incompatible schema or registry version.
