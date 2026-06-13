export const TEACHING_FACTS_SCHEMA_VERSION = 1 as const;
export const TEACHING_FACTS_REGISTRY_VERSION = 5 as const;

export interface TeachingFactsRequestV1 {
  schemaVersion: 1;
  fenBefore: string;
  playedMoveUci: string;
  bestMoveUci?: string;
  refutationUci?: string;
  principalVariationUci?: string[];
  options?: {
    includeMotifOpportunities: boolean;
    includeCounterfactual: boolean;
  };
}

export interface TeachingFactBundleV1 {
  schemaVersion: 1;
  fenBefore: string;
  before: PositionFacts;
  played: MoveStateFacts;
  best?: MoveStateFacts;
  refutation?: MoveStateFacts;
  provenance: FactsProvenance;
  errors: FactError[];
}

export interface PositionFacts {
  sideToMove: Side;
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

export interface MoveStateFacts {
  move: MoveFact;
  fenAfter: string;
  position: PositionFacts;
  deltas: {
    createdHazards: FactCollection<HazardFact>;
    removedHazards: FactCollection<HazardFact>;
    worsenedHazards: FactCollection<HazardFact>;
    createdStructures: FactCollection<StructureDelta>;
    removedStructures: FactCollection<StructureDelta>;
  };
}

export interface MoveFact {
  uci: string;
  from: string;
  to: string;
  promotion?: string;
}

export type FactCollection<T> =
  | { status: 'computed'; items: T[] }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };

export type FactValue<T> =
  | { status: 'computed'; value: T }
  | { status: 'uncomputed'; reason: string }
  | { status: 'unavailable'; reason: string };

export type Side = 'white' | 'black';
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';

export interface PieceRef {
  id: string;
  side: Side;
  pieceType: PieceType;
  square: string;
}

export interface PieceFact extends PieceRef {
  attackers: PieceRef[];
  defenders: PieceRef[];
  attackerCount: number;
  defenderCount: number;
  attacked: boolean;
  loose: boolean;
  see: FactValue<SeeLosingFact>;
  onlyDefenderOf: PieceRef[];
}

export interface SeeLosingFact {
  losing: boolean;
  bestCaptureUci?: string;
  scoreCp?: number;
}

export interface PawnStructureFacts {
  doubled: DoubledPawnFact[];
  isolated: PieceRef[];
  passed: PieceRef[];
  islands: PawnIslandFact[];
  backward: FactCollection<PieceRef>;
  connectedPassed: FactCollection<PieceRef>;
  openFiles: FactCollection<string>;
  semiOpenFiles: FactCollection<SideFileFact>;
  kingShieldMissing: FactCollection<KingShieldFact>;
  pawnChains: FactCollection<PawnChainFact>;
}

export interface DoubledPawnFact {
  id: string;
  side: Side;
  file: string;
  squares: string[];
}

export interface PawnIslandFact {
  id: string;
  side: Side;
  files: string[];
  squares: string[];
}

export interface StructureDelta {
  factId: string;
  kind: string;
  side: Side;
  squares: string[];
}

export interface SideFileFact {
  side: Side;
  file: string;
}

export interface KingShieldFact {
  side: Side;
  kingSquare: string;
  missingSquares: string[];
}

export interface PawnChainFact {
  side: Side;
  squares: string[];
}

export interface KingSafetyFact {
  side: Side;
  kingSquare: string;
  inCheck: boolean;
  attackers: PieceRef[];
  pressuredSquares: string[];
  legalEscapeSquares: FactCollection<string>;
}

export interface CaptureOpportunity {
  moveUci: string;
  attacker: PieceRef;
  victim: PieceRef;
  victimSquare: string;
  seeCp: number;
  givesCheck: boolean;
  capturingPieceSurvives: boolean;
  highestValueSafeCapture: boolean;
}

export interface MotifOpportunity {
  kind: string; // 'fork'
  validator: string; // 'fork_validation'
  moveUci: string;
  forkingPiece: PieceRef; // referenced at its post-move square
  targets: PieceRef[]; // sorted by id
  givesCheck: boolean;
  kingTarget: boolean;
  materialGain: number; // estimated forced consequence, centipawns
}

export interface PinOpportunity {
  kind: string; // 'absolute' | 'relative'
  validator: string; // 'pin_validation'
  moveUci: string;
  pinner: PieceRef;
  pinned: PieceRef;
  anchor: PieceRef; // king for an absolute pin
  ray: string[]; // squares between pinner and anchor, incl. the pinned square
  givesCheck: boolean;
  pinnedImmobile: boolean; // true for an absolute pin
}

export interface HazardFact {
  id: string;
  kind: string;
  side: Side;
  squares: string[];
  magnitudeCp?: number;
  moveUci?: string;
}

export interface FactsProvenance {
  engine: string;
  engineCommit?: string;
  factsRegistryVersion: number;
  validators: string[];
}

export interface FactError {
  code: string;
  message: string;
  field?: string;
}

export function isTeachingFactBundleV1(value: unknown): value is TeachingFactBundleV1 {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<TeachingFactBundleV1>;
  return (
    bundle.schemaVersion === TEACHING_FACTS_SCHEMA_VERSION &&
    typeof bundle.fenBefore === 'string' &&
    isPositionFactsShape(bundle.before) &&
    isMoveStateFactsShape(bundle.played) &&
    (!bundle.best || isMoveStateFactsShape(bundle.best)) &&
    (!bundle.refutation || isMoveStateFactsShape(bundle.refutation)) &&
    !!bundle.provenance &&
    Array.isArray(bundle.errors)
  );
}

function isMoveStateFactsShape(value: unknown): value is MoveStateFacts {
  if (!value || typeof value !== 'object') return false;
  const moveState = value as Partial<MoveStateFacts>;
  return !!moveState.move && typeof moveState.fenAfter === 'string' && isPositionFactsShape(moveState.position);
}

function isPositionFactsShape(value: unknown): value is PositionFacts {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<PositionFacts>;
  return (
    (position.sideToMove === 'white' || position.sideToMove === 'black') &&
    Array.isArray(position.pieces) &&
    isFactCollection(position.kingSafety) &&
    isFactCollection(position.availableCaptures) &&
    isFactCollection(position.opponentAvailableCaptures) &&
    isFactCollection(position.availableMotifs) &&
    isFactCollection(position.availablePins) &&
    isFactCollection(position.opponentAvailableMotifs) &&
    isFactCollection(position.opponentAvailablePins) &&
    isFactCollection(position.hazards)
  );
}

function isFactCollection(value: unknown): value is FactCollection<unknown> {
  if (!value || typeof value !== 'object') return false;
  const collection = value as Partial<FactCollection<unknown>>;
  if (collection.status === 'computed') return Array.isArray(collection.items);
  return collection.status === 'uncomputed' || collection.status === 'unavailable';
}

// ────────────────────────────────────────────────────────────────────────────
// Teaching events — the application-side classification of Rust facts.
//
// Boundary discipline (plan §2): Rust emits deterministic facts; THIS layer (the
// teaching compiler) decides which facts form a named topic, attributes cause
// using the Stockfish grade, and renders a deterministic ExplanationPlan. No new
// chess truth lives here — only classification, vocabulary, and presentation.
// Causal attribution is necessarily app-side because it joins Rust facts with the
// Stockfish grade, which the engine never sees.
// ────────────────────────────────────────────────────────────────────────────

export const TEACHING_EVENTS_SCHEMA_VERSION = 1 as const;

export type TeachingFamily =
  | 'tactics'
  | 'piece_safety'
  | 'defense'
  | 'king_safety'
  | 'pawn_structure'
  | 'development'
  | 'positional'
  | 'endgame'
  | 'conversion';

export type TeachingAction =
  | 'allowed'
  | 'missed'
  | 'failed_to_answer'
  | 'created'
  | 'worsened'
  | 'improved'
  | 'accepted_tradeoff';

export type TeachingMechanism =
  | 'fork'
  | 'pin'
  | 'hanging_piece'
  | 'defense'
  | 'only_defender'
  | 'king_attack'
  | 'doubled_pawn'
  | 'isolated_pawn'
  | 'king_shield'
  | 'passed_pawn'
  | 'development'
  | 'simplification'
  | 'repetition';

export type TeachingTopicId =
  | 'allowed_fork'
  | 'allowed_pin'
  | 'missed_hanging_piece'
  | 'failed_defense'
  | 'pawn_structure_damage';

// How strongly the engine/oracle backs the event's causal claim (plan §4).
export type ProofAttribution =
  | 'proven_direct' // a Rust validator proves the mechanism on the played board
  | 'proven_refutation' // the opponent's refutation line proves it
  | 'counterfactual_supported' // played-vs-best fact difference + a worse grade
  | 'descriptive_only'; // the fact is real but not attributed as the cost's cause

export type ProofBadge =
  | 'proven_tactic'
  | 'engine_line'
  | 'counterfactual_supported'
  | 'structural_fact'
  | 'descriptive_only';

export interface FactRef {
  factId: string;
  kind: string;
  squares: string[];
  side?: Side;
}

export interface TeachingConsequence {
  cpLoss: number;
  materialLoss?: number;
  mateIn?: number;
  structuralChanges?: StructureDelta[];
}

// The deterministic, evidence-gated explanation. Every optional clause is present
// ONLY when its evidence exists (plan §11 rendering rule). The optional LLM
// narrator receives THIS object, never raw board state.
export interface ExplanationPlan {
  topic: string;
  headline: string;
  cause?: string;
  consequence?: string;
  correction?: string;
  caveat?: string;
}

export interface TeachingEvent {
  id: string;
  topicId: TeachingTopicId;
  family: TeachingFamily;
  action: TeachingAction;
  mechanism: TeachingMechanism;
  side: Side;
  playedMove: string; // UCI of the move under review
  actors: PieceRef[];
  targets: PieceRef[];
  squares: string[];
  consequence: TeachingConsequence;
  punishment?: { move: string; line: string[] };
  correction?: { move: string; avoidedFacts: FactRef[]; createdFacts: FactRef[] };
  // App-side engine re-grade of the exposed tactic's own punishing move: attackerCp
  // is the tactic-player's score after it (centipawns). Lets the UI confirm (winning)
  // or refute (not winning) a fork/pin/defense callout the engine doesn't endorse.
  engineCheck?: { attackerCp: number; depth: number };
  proof: {
    validators: string[];
    evidence: FactRef[];
    attribution: ProofAttribution;
    badge: ProofBadge;
  };
  saliency: number;
  plan: ExplanationPlan;
}

export type TeachingUncomputedReason =
  | 'rust_engine_unavailable'
  | 'facts_request_failed'
  | 'schema_mismatch'
  | 'move_conversion_failed'
  | 'no_committed_topic';

export type TeachingAnalysis =
  | {
      computed: true;
      schemaVersion: typeof TEACHING_EVENTS_SCHEMA_VERSION;
      events: TeachingEvent[];
      primaryEvent?: TeachingEvent;
    }
  | { computed: false; reason: TeachingUncomputedReason };
