export const TEACHING_FACTS_SCHEMA_VERSION = 1 as const;

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
  availableMotifs: FactCollection<MotifOpportunity>;
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
}

export interface CaptureOpportunity {
  moveUci: string;
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

export interface HazardFact {
  id: string;
  kind: string;
  side: Side;
  squares: string[];
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
    !!bundle.before &&
    !!bundle.played &&
    !!bundle.provenance &&
    Array.isArray(bundle.errors)
  );
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
